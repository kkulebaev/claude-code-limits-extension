import GObject from 'gi://GObject'
import St from 'gi://St'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import Clutter from 'gi://Clutter'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js'

function homePath(rel) {
  return GLib.build_filenamev([GLib.get_home_dir(), rel])
}

const CCUSAGE_CANDIDATES = [
  () => homePath('.local/share/pnpm/ccusage'),
  () => homePath('.bun/bin/ccusage'),
  () => homePath('.npm-global/bin/ccusage'),
  () => '/usr/local/bin/ccusage',
  () => '/usr/bin/ccusage',
]

const NODE_DIR_CANDIDATES = [
  () => homePath('.local/bin'),
  () => homePath('.bun/bin'),
  () => '/usr/local/bin',
  () => '/usr/bin',
]

function logError(msg) {
  console.error(`[claude-code-limits] ${msg}`)
}

function formatTokens(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function pickState(percent, warnPct, dangerPct) {
  if (percent >= dangerPct) return 'danger'
  if (percent >= warnPct) return 'warning'
  return 'ok'
}

const ProgressBar = GObject.registerClass(
  class ProgressBar extends St.DrawingArea {
    _init(params) {
      super._init({ height: 8, x_expand: true, ...params })
      this._percent = 0
      this._state = 'ok'
      this.connect('repaint', this._onRepaint.bind(this))
    }

    setProgress(percent, state) {
      this._percent = Math.max(0, Math.min(100, percent))
      this._state = state
      this.queue_repaint()
    }

    _onRepaint() {
      const [w, h] = this.get_surface_size()
      if (w <= 0 || h <= 0) return
      const cr = this.get_context()
      const radius = h / 2

      cr.setSourceRGBA(1, 1, 1, 0.08)
      this._roundedRect(cr, 0, 0, w, h, radius)
      cr.fill()

      const fw = (w * this._percent) / 100
      if (fw > 0) {
        cr.setSourceRGBA(1, 1, 1, 1)
        this._roundedRect(cr, 0, 0, fw, h, Math.min(radius, fw / 2))
        cr.fill()
      }
      cr.$dispose()
    }

    _roundedRect(cr, x, y, w, h, r) {
      if (r <= 0) {
        cr.rectangle(x, y, w, h)
        return
      }
      const halfPi = Math.PI / 2
      cr.newSubPath()
      cr.arc(x + w - r, y + r, r, -halfPi, 0)
      cr.arc(x + w - r, y + h - r, r, 0, halfPi)
      cr.arc(x + r, y + h - r, r, halfPi, Math.PI)
      cr.arc(x + r, y + r, r, Math.PI, 3 * halfPi)
      cr.closePath()
    }
  },
)

const Indicator = GObject.registerClass(
  class ClaudeLimitsIndicator extends PanelMenu.Button {
    _init(extension) {
      super._init(0.0, 'Claude Code Limits')
      this._extension = extension
      this._settings = extension.getSettings()
      this.add_style_class_name('cc-panel-button')

      const box = new St.BoxLayout({
        style_class: 'cc-panel-box',
        y_align: Clutter.ActorAlign.CENTER,
      })

      this._panelContent = new St.BoxLayout({
        style_class: 'cc-panel-content',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._fivehMiniBar = new ProgressBar({
        style_class: 'cc-panel-mini-bar',
        x_expand: false,
        width: 40,
        height: 6,
      })
      this._fivehMiniBar.y_align = Clutter.ActorAlign.CENTER
      this._fivehPctLabel = new St.Label({
        text: '0%',
        style_class: 'cc-panel-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._weekMiniBar = new ProgressBar({
        style_class: 'cc-panel-mini-bar',
        x_expand: false,
        width: 40,
        height: 6,
      })
      this._weekMiniBar.y_align = Clutter.ActorAlign.CENTER
      this._weekPctLabel = new St.Label({
        text: '0%',
        style_class: 'cc-panel-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._panelContent.add_child(this._fivehMiniBar)
      this._panelContent.add_child(this._fivehPctLabel)
      this._panelContent.add_child(this._weekMiniBar)
      this._panelContent.add_child(this._weekPctLabel)

      this._errorLabel = new St.Label({
        text: '',
        style_class: 'cc-panel-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._errorLabel.visible = false

      box.add_child(this._panelContent)
      box.add_child(this._errorLabel)
      this.add_child(box)

      this._buildMenu()

      this._timeoutId = 0
      this._cancellable = null
      this._ccusagePath = null
      this._extraPath = null
      this._lastData = null

      this._settingsHandlerIds = [
        this._settings.connect('changed::refresh-seconds', () => this._restartTimer()),
        this._settings.connect('changed::five-hour-token-limit', () => this._reRender()),
        this._settings.connect('changed::weekly-token-limit', () => this._reRender()),
        this._settings.connect('changed::warning-percent', () => this._reRender()),
        this._settings.connect('changed::danger-percent', () => this._reRender()),
      ]
    }

    _buildMenu() {
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('5-hour billing block')))
      this._fivehBar = this._addProgressRow()
      this._fivehCaption = this._addCaptionRow()
      this._fivehResets = this._addRow(_('Resets'))

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Last 7 days')))
      this._weekBar = this._addProgressRow()
      this._weekCaption = this._addCaptionRow()

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())

      this._errorRow = new PopupMenu.PopupMenuItem('', { reactive: false })
      this._errorRow.label.add_style_class_name('cc-popup-error')
      this._errorRow.visible = false
      this.menu.addMenuItem(this._errorRow)

      const refresh = new PopupMenu.PopupMenuItem(_('Refresh now'))
      refresh.connect('activate', () => this._refresh())
      this.menu.addMenuItem(refresh)

      const prefs = new PopupMenu.PopupMenuItem(_('Preferences…'))
      prefs.connect('activate', () => this._extension.openPreferences())
      this.menu.addMenuItem(prefs)
    }

    _addProgressRow() {
      const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'cc-progress-row' })
      const bar = new ProgressBar()
      item.add_child(bar)
      this.menu.addMenuItem(item)
      return bar
    }

    _addCaptionRow() {
      const item = new PopupMenu.PopupBaseMenuItem({ reactive: false })
      const label = new St.Label({
        text: '—',
        style_class: 'cc-progress-caption',
        x_expand: true,
      })
      item.add_child(label)
      this.menu.addMenuItem(item)
      return label
    }

    _addRow(labelText) {
      const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'cc-popup-row' })
      const label = new St.Label({ text: labelText, style_class: 'cc-popup-row-label' })
      const value = new St.Label({ text: '—', style_class: 'cc-popup-row-value' })
      value.x_expand = true
      value.set_x_align(Clutter.ActorAlign.END)
      item.add_child(label)
      item.add_child(value)
      this.menu.addMenuItem(item)
      return value
    }

    start() {
      this._refresh()
      this._startTimer()
    }

    stop() {
      this._stopTimer()
      if (this._cancellable) {
        this._cancellable.cancel()
        this._cancellable = null
      }
      for (const id of this._settingsHandlerIds) this._settings.disconnect(id)
      this._settingsHandlerIds = []
    }

    _startTimer() {
      const seconds = Math.max(10, this._settings.get_uint('refresh-seconds'))
      this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
        this._refresh()
        return GLib.SOURCE_CONTINUE
      })
    }

    _stopTimer() {
      if (this._timeoutId) {
        GLib.Source.remove(this._timeoutId)
        this._timeoutId = 0
      }
    }

    _restartTimer() {
      this._stopTimer()
      this._startTimer()
    }

    _refresh() {
      const cancellable = new Gio.Cancellable()
      if (this._cancellable) this._cancellable.cancel()
      this._cancellable = cancellable

      try {
        this._resolveCmd()
      } catch (err) {
        logError(err.message)
        this._renderError(err.message)
        return
      }

      Promise.all([
        this._exec([this._ccusagePath, 'blocks', '--active', '--json'], cancellable),
        this._exec([this._ccusagePath, 'daily', '--since', this._sinceDate(), '--json'], cancellable),
      ])
        .then(([blocksOut, dailyOut]) => {
          if (cancellable.is_cancelled()) return
          let parsed
          try {
            parsed = {
              blocks: JSON.parse(blocksOut),
              daily: JSON.parse(dailyOut),
            }
          } catch (e) {
            logError(e.message)
            this._renderError(`parse error: ${e.message}`)
            return
          }
          this._lastData = parsed
          this._reRender()
        })
        .catch(err => {
          if (cancellable.is_cancelled()) return
          if (err instanceof GLib.Error && err.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED)) return
          const msg = err?.message ?? String(err)
          logError(msg)
          this._renderError(msg)
        })
    }

    _sinceDate() {
      const dt = GLib.DateTime.new_now_local().add_days(-6)
      return dt.format('%Y%m%d')
    }

    _resolveCmd() {
      if (!this._ccusagePath) {
        const found = CCUSAGE_CANDIDATES
          .map(fn => fn())
          .find(p => GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE))
        if (!found) {
          throw new Error('ccusage не найден на диске. Установите: pnpm add -g ccusage')
        }
        this._ccusagePath = found
      }
      if (!this._extraPath) {
        const dirs = NODE_DIR_CANDIDATES
          .map(fn => fn())
          .filter(d => GLib.file_test(d, GLib.FileTest.IS_DIR))
        const ccusageDir = GLib.path_get_dirname(this._ccusagePath)
        const set = new Set([ccusageDir, ...dirs])
        this._extraPath = [...set].join(':')
      }
    }

    _exec(argv, cancellable) {
      return new Promise((resolve, reject) => {
        try {
          const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
          })
          launcher.setenv('PATH', this._extraPath, true)
          launcher.setenv('HOME', GLib.get_home_dir(), true)
          launcher.setenv('NO_COLOR', '1', true)
          const proc = launcher.spawnv(argv)
          proc.communicate_utf8_async(null, cancellable, (p, res) => {
            try {
              const [, stdout, stderr] = p.communicate_utf8_finish(res)
              if (p.get_successful()) {
                resolve(stdout)
              } else {
                const errMsg = (stderr || '').trim() || `command failed: ${argv.join(' ')}`
                reject(new Error(errMsg))
              }
            } catch (e) {
              reject(e)
            }
          })
        } catch (e) {
          reject(e)
        }
      })
    }

    _reRender() {
      if (this._cancellable && this._cancellable.is_cancelled()) return
      if (!this._lastData) return
      this._render(this._lastData.blocks, this._lastData.daily)
    }

    _render(blocksData, dailyData) {
      this._errorRow.visible = false

      const fivehLimit = Math.max(1, Number(this._settings.get_int64('five-hour-token-limit')))
      const weeklyLimit = Math.max(1, Number(this._settings.get_int64('weekly-token-limit')))
      const warnPct = this._settings.get_uint('warning-percent')
      const dangerPct = this._settings.get_uint('danger-percent')

      const block = blocksData?.blocks?.find(b => b.isActive && !b.isGap) ?? null
      const fivehTokens = block ? (block.totalTokens || 0) : 0
      const fivehPct = (fivehTokens / fivehLimit) * 100
      const fivehState = pickState(fivehPct, warnPct, dangerPct)

      this._fivehBar.setProgress(fivehPct, fivehState)
      this._fivehCaption.set_text(
        `${Math.round(fivehPct)}% · ${formatTokens(fivehTokens)} / ${formatTokens(fivehLimit)}`,
      )

      if (block) {
        const end = GLib.DateTime.new_from_iso8601(block.endTime, null)?.to_local()
        const now = GLib.DateTime.new_now_local()
        let resets = end ? end.format('%H:%M') : '—'
        if (end) {
          const diffSec = Math.max(0, Number(end.difference(now)) / 1_000_000)
          if (diffSec > 0) {
            const h = Math.floor(diffSec / 3600)
            const m = Math.floor((diffSec % 3600) / 60)
            resets += ` (${h}h ${m}m)`
          }
        }
        this._fivehResets.set_text(resets)
      } else {
        this._fivehResets.set_text('—')
      }

      const days = dailyData?.daily ?? []
      const weeklyTokens = days.reduce((s, d) => s + (d.totalTokens || 0), 0)
      const weeklyPct = (weeklyTokens / weeklyLimit) * 100
      const weeklyState = pickState(weeklyPct, warnPct, dangerPct)

      this._weekBar.setProgress(weeklyPct, weeklyState)
      this._weekCaption.set_text(
        `${Math.round(weeklyPct)}% · ${formatTokens(weeklyTokens)} / ${formatTokens(weeklyLimit)}`,
      )

      this._panelContent.visible = true
      this._errorLabel.visible = false

      this._fivehMiniBar.setProgress(fivehPct, fivehState)
      this._weekMiniBar.setProgress(weeklyPct, weeklyState)
      this._setPctLabel(this._fivehPctLabel, fivehPct, fivehState)
      this._setPctLabel(this._weekPctLabel, weeklyPct, weeklyState)
    }

    _setPctLabel(label, percent, state) {
      label.set_text(`${Math.round(percent)}%`)
      label.remove_style_class_name('cc-panel-label-warning')
      label.remove_style_class_name('cc-panel-label-danger')
      if (state === 'warning') label.add_style_class_name('cc-panel-label-warning')
      if (state === 'danger') label.add_style_class_name('cc-panel-label-danger')
    }

    _renderError(msg) {
      this._panelContent.visible = false
      this._errorLabel.visible = true
      this._errorLabel.set_text('Claude: ⚠')
      this._errorRow.label.set_text(msg)
      this._errorRow.visible = true
    }
  },
)

export default class ClaudeCodeLimitsExtension extends Extension {
  enable() {
    this._indicator = new Indicator(this)
    Main.panel.addToStatusArea(this.uuid, this._indicator)
    this._indicator.start()
  }

  disable() {
    if (this._indicator) {
      this._indicator.stop()
      this._indicator.destroy()
      this._indicator = null
    }
  }
}
