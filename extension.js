import GObject from 'gi://GObject'
import St from 'gi://St'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import Soup from 'gi://Soup'
import Clutter from 'gi://Clutter'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const ANTHROPIC_BETA = 'oauth-2025-04-20'
const USER_AGENT = 'gnome-claude-code-limits/0.5.0'

function credentialsPath() {
  return GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json'])
}

function logError(msg) {
  console.error(`[claude-code-limits] ${msg}`)
}

function readAccessToken() {
  const path = credentialsPath()
  const file = Gio.File.new_for_path(path)
  let text
  try {
    const [ok, data] = file.load_contents(null)
    if (!ok) throw new Error('load_contents returned false')
    text = new TextDecoder().decode(data)
  } catch (e) {
    throw new Error(`не удалось прочитать ${path}: ${e.message}. Запустите \`claude\` для входа.`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new Error(`credentials.json не парсится: ${e.message}`)
  }
  const token = parsed?.claudeAiOauth?.accessToken
  if (!token) {
    throw new Error('claudeAiOauth.accessToken отсутствует — нужен вход через подписку Claude (не API key)')
  }
  return token
}

function pickState(percent, warnPct, dangerPct) {
  if (percent >= dangerPct) return 'danger'
  if (percent >= warnPct) return 'warning'
  return 'ok'
}

function formatResets(isoString) {
  if (!isoString) return '—'
  const end = GLib.DateTime.new_from_iso8601(isoString, null)?.to_local()
  if (!end) return '—'
  const now = GLib.DateTime.new_now_local()
  const diffSec = Math.max(0, Number(end.difference(now)) / 1_000_000)
  const sameDay =
    end.get_year() === now.get_year() &&
    end.get_month() === now.get_month() &&
    end.get_day_of_month() === now.get_day_of_month()
  let when = sameDay ? end.format('%H:%M') : end.format('%a %H:%M')
  if (diffSec > 0) {
    const h = Math.floor(diffSec / 3600)
    const m = Math.floor((diffSec % 3600) / 60)
    when += h >= 24 ? ` (${Math.floor(h / 24)}d ${h % 24}h)` : ` (${h}h ${m}m)`
  }
  return when
}

function makeProgressBar({ height = 8, miniBar = false } = {}) {
  const trackClass = miniBar ? 'cc-panel-mini-bar-track' : 'cc-progress-track'
  const fillClass = miniBar ? 'cc-panel-mini-bar-fill' : 'cc-progress-fill'
  const track = new St.Widget({
    style_class: trackClass,
    x_expand: !miniBar,
    y_align: Clutter.ActorAlign.CENTER,
    height,
    ...(miniBar ? { width: 40 } : {}),
  })
  const fill = new St.Widget({
    style_class: fillClass,
    height,
  })
  fill.set_position(0, 0)
  track.add_child(fill)

  let lastPct = 0
  const recompute = () => {
    const box = track.get_allocation_box()
    const w = box ? box.get_width() : track.get_width()
    if (!w || w <= 0) return
    fill.set_width(Math.round((w * lastPct) / 100))
    fill.set_height(height)
  }

  const setProgress = (percent, state) => {
    lastPct = Math.max(0, Math.min(100, percent))
    fill.remove_style_class_name('cc-progress-fill-warning')
    fill.remove_style_class_name('cc-progress-fill-danger')
    if (state === 'warning') fill.add_style_class_name('cc-progress-fill-warning')
    if (state === 'danger') fill.add_style_class_name('cc-progress-fill-danger')
    if (lastPct === 0) {
      fill.hide()
    } else {
      fill.show()
      recompute()
    }
  }

  const allocId = track.connect('notify::allocation', recompute)

  return { track, fill, setProgress, allocId }
}

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
      this._fivehMiniBar = makeProgressBar({ height: 6, miniBar: true })
      this._fivehPctLabel = new St.Label({
        text: '0%',
        style_class: 'cc-panel-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._weekMiniBar = makeProgressBar({ height: 6, miniBar: true })
      this._weekPctLabel = new St.Label({
        text: '0%',
        style_class: 'cc-panel-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._panelContent.add_child(this._fivehMiniBar.track)
      this._panelContent.add_child(this._fivehPctLabel)
      this._panelContent.add_child(this._weekMiniBar.track)
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
      this._lastData = null
      this._lastError = null
      this._errorPaused = false
      this._session = new Soup.Session({ timeout: 15, user_agent: USER_AGENT })

      this._settingsHandlerIds = [
        this._settings.connect('changed::refresh-seconds', () => this._restartTimer()),
        this._settings.connect('changed::warning-percent', () => this._reRender()),
        this._settings.connect('changed::danger-percent', () => this._reRender()),
        this._settings.connect('changed::api-enabled', () => this._onApiEnabledChanged()),
      ]
    }

    _isPollingAllowed() {
      return this._settings.get_boolean('api-enabled') && !this._errorPaused
    }

    _buildMenu() {
      this._apiSwitch = new PopupMenu.PopupSwitchMenuItem(
        'API requests',
        this._settings.get_boolean('api-enabled'),
      )
      this._apiSwitch.connect('toggled', (_item, state) => {
        if (this._settings.get_boolean('api-enabled') !== state) {
          this._settings.set_boolean('api-enabled', state)
        }
      })
      this.menu.addMenuItem(this._apiSwitch)

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('5-hour window'))
      this._fivehBar = this._addProgressRow()
      this._fivehCaption = this._addCaptionRow()
      this._fivehResets = this._addRow('Resets')

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Last 7 days'))
      this._weekBar = this._addProgressRow()
      this._weekCaption = this._addCaptionRow()
      this._weekResets = this._addRow('Resets')

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())

      this._statusRow = new PopupMenu.PopupMenuItem('', { reactive: false })
      this._statusRow.label.add_style_class_name('cc-popup-status')
      this._statusRow.visible = false
      this.menu.addMenuItem(this._statusRow)

      this._errorRow = new PopupMenu.PopupMenuItem('', { reactive: false })
      this._errorRow.label.add_style_class_name('cc-popup-error')
      this._errorRow.visible = false
      this.menu.addMenuItem(this._errorRow)

      const refresh = new PopupMenu.PopupMenuItem('Refresh now')
      refresh.connect('activate', () => this._refresh())
      this.menu.addMenuItem(refresh)

      const prefs = new PopupMenu.PopupMenuItem('Preferences…')
      prefs.connect('activate', () => this._extension.openPreferences())
      this.menu.addMenuItem(prefs)
    }

    _addProgressRow() {
      const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'cc-progress-row' })
      const bar = makeProgressBar({ height: 8, miniBar: false })
      item.add_child(bar.track)
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
      this._updateStatusRow()
      if (this._isPollingAllowed()) {
        this._refresh()
        this._startTimer()
      }
    }

    stop() {
      this._stopTimer()
      if (this._cancellable) {
        this._cancellable.cancel()
        this._cancellable = null
      }
      this._session = null
      for (const id of this._settingsHandlerIds) this._settings.disconnect(id)
      this._settingsHandlerIds = []
      for (const bar of [this._fivehBar, this._weekBar, this._fivehMiniBar, this._weekMiniBar]) {
        if (bar && bar.allocId) bar.track.disconnect(bar.allocId)
      }
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
      if (this._isPollingAllowed()) this._startTimer()
    }

    _onApiEnabledChanged() {
      const enabled = this._settings.get_boolean('api-enabled')
      if (this._apiSwitch && this._apiSwitch.state !== enabled) {
        this._apiSwitch.setToggleState(enabled)
      }
      if (enabled) {
        this._errorPaused = false
        this._lastError = null
        this._refresh()
        if (!this._timeoutId) this._startTimer()
      } else {
        this._stopTimer()
        if (this._cancellable) {
          this._cancellable.cancel()
          this._cancellable = null
        }
        this._lastError = null
        this._errorPaused = false
        if (this._lastData) {
          this._render(this._lastData)
        } else {
          this._renderEmpty()
        }
      }
      this._updateStatusRow()
    }

    _refresh() {
      const cancellable = new Gio.Cancellable()
      if (this._cancellable) this._cancellable.cancel()
      this._cancellable = cancellable

      this._fetchUsage(cancellable)
        .then(data => {
          if (cancellable.is_cancelled()) return
          this._lastData = data
          this._lastError = null
          const wasErrorPaused = this._errorPaused
          this._errorPaused = false
          this._reRender()
          this._updateStatusRow()
          if (wasErrorPaused && this._settings.get_boolean('api-enabled') && !this._timeoutId) {
            this._startTimer()
          }
        })
        .catch(err => {
          if (cancellable.is_cancelled()) return
          if (err instanceof GLib.Error && err.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED)) return
          const msg = err?.message ?? String(err)
          logError(msg)
          this._lastError = msg
          this._errorPaused = true
          this._stopTimer()
          this._renderError(msg)
          this._updateStatusRow()
        })
    }

    _fetchUsage(cancellable) {
      return new Promise((resolve, reject) => {
        let token
        try {
          token = readAccessToken()
        } catch (e) {
          reject(e)
          return
        }
        const session = this._session
        if (!session) {
          reject(new Error('session destroyed'))
          return
        }
        const message = Soup.Message.new('GET', USAGE_URL)
        message.request_headers.append('Authorization', `Bearer ${token}`)
        message.request_headers.append('anthropic-beta', ANTHROPIC_BETA)
        message.request_headers.append('Accept', 'application/json')
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (sess, res) => {
          try {
            const bytes = sess.send_and_read_finish(res)
            const status = message.get_status()
            const raw = bytes?.get_data()
            const body = raw ? new TextDecoder().decode(raw) : ''
            if (status === Soup.Status.UNAUTHORIZED) {
              reject(new Error('401 Unauthorized — OAuth-токен просрочен, запустите `claude` для обновления'))
              return
            }
            if (status < 200 || status >= 300) {
              reject(new Error(`HTTP ${status}: ${body.slice(0, 160)}`))
              return
            }
            let parsed
            try {
              parsed = JSON.parse(body)
            } catch (e) {
              reject(new Error(`parse error: ${e.message}`))
              return
            }
            resolve(parsed)
          } catch (e) {
            reject(e)
          }
        })
      })
    }

    formatPct(pct) {
      return pct > 100 ? '100%+' : `${Math.round(pct)}%`
    }

    _reRender() {
      if (this._cancellable && this._cancellable.is_cancelled()) return
      if (!this._lastData) return
      this._render(this._lastData)
    }

    _render(data) {
      if (!this._lastError) this._errorRow.visible = false
      const warnPct = this._settings.get_uint('warning-percent')
      const dangerPct = this._settings.get_uint('danger-percent')

      const fiveh = data?.five_hour ?? null
      const sevd = data?.seven_day ?? null
      const fivehPct = Number(fiveh?.utilization ?? 0)
      const sevdPct = Number(sevd?.utilization ?? 0)
      const fivehState = pickState(fivehPct, warnPct, dangerPct)
      const sevdState = pickState(sevdPct, warnPct, dangerPct)

      this._fivehBar.setProgress(fivehPct, fivehState)
      this._fivehCaption.set_text(`${this.formatPct(fivehPct)} used`)
      this._fivehResets.set_text(formatResets(fiveh?.resets_at))

      this._weekBar.setProgress(sevdPct, sevdState)
      this._weekCaption.set_text(`${this.formatPct(sevdPct)} used`)
      this._weekResets.set_text(formatResets(sevd?.resets_at))

      this._panelContent.visible = true
      this._errorLabel.visible = false

      this._fivehMiniBar.setProgress(fivehPct, fivehState)
      this._weekMiniBar.setProgress(sevdPct, sevdState)
      this._setPctLabel(this._fivehPctLabel, fivehPct, fivehState)
      this._setPctLabel(this._weekPctLabel, sevdPct, sevdState)
    }

    _setPctLabel(label, percent, state) {
      label.set_text(this.formatPct(percent))
      label.remove_style_class_name('cc-panel-label-warning')
      label.remove_style_class_name('cc-panel-label-danger')
      if (state === 'warning') label.add_style_class_name('cc-panel-label-warning')
      if (state === 'danger') label.add_style_class_name('cc-panel-label-danger')
    }

    _renderError(msg) {
      if (this._lastData) {
        this._render(this._lastData)
      } else {
        this._panelContent.visible = false
        this._errorLabel.visible = true
        this._errorLabel.set_text('Claude: ⚠')
      }
      this._errorRow.label.set_text(msg)
      this._errorRow.visible = true
    }

    _renderEmpty() {
      this._lastError = null
      this._errorRow.visible = false
      this._panelContent.visible = true
      this._errorLabel.visible = false
      this._fivehMiniBar.setProgress(0, 'ok')
      this._weekMiniBar.setProgress(0, 'ok')
      this._setPctLabel(this._fivehPctLabel, 0, 'ok')
      this._setPctLabel(this._weekPctLabel, 0, 'ok')
      this._fivehBar.setProgress(0, 'ok')
      this._weekBar.setProgress(0, 'ok')
      this._fivehCaption.set_text('—')
      this._weekCaption.set_text('—')
      this._fivehResets.set_text('—')
      this._weekResets.set_text('—')
    }

    _updateStatusRow() {
      if (!this._statusRow) return
      const enabled = this._settings.get_boolean('api-enabled')
      if (!enabled) {
        this._statusRow.label.set_text('Auto-refresh disabled — manual only')
        this._statusRow.visible = true
        return
      }
      if (this._errorPaused) {
        this._statusRow.label.set_text('Auto-refresh paused after API error — press Refresh to retry')
        this._statusRow.visible = true
        return
      }
      this._statusRow.visible = false
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
