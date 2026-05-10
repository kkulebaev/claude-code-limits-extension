import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import Gio from 'gi://Gio'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

export default class ClaudeCodeLimitsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings()

    const page = new Adw.PreferencesPage({ title: 'General', icon_name: 'preferences-system-symbolic' })
    window.add(page)

    const budgets = new Adw.PreferencesGroup({
      title: 'Token budgets',
      description:
        'Tokens = ccusage totalTokens (input + output + cache creation + cache read). ' +
        'These numbers are NOT the same as Anthropic billable tokens — they reflect ' +
        'overall activity. Pick budgets that match your historical usage.',
    })
    page.add(budgets)

    budgets.add(this._buildTokenRow(
      settings,
      'five-hour-token-limit',
      '5-hour limit',
      'Million tokens (default: 200)',
    ))
    budgets.add(this._buildTokenRow(
      settings,
      'weekly-token-limit',
      'Weekly limit (rolling 7 days)',
      'Million tokens (default: 2000)',
    ))

    const indicators = new Adw.PreferencesGroup({ title: 'Indicators' })
    page.add(indicators)

    const warningRow = new Adw.SpinRow({
      title: 'Warning threshold',
      subtitle: 'Progress bar turns orange (%)',
      adjustment: new Gtk.Adjustment({ lower: 1, upper: 99, step_increment: 1, page_increment: 5 }),
    })
    settings.bind('warning-percent', warningRow, 'value', Gio.SettingsBindFlags.DEFAULT)
    indicators.add(warningRow)

    const dangerRow = new Adw.SpinRow({
      title: 'Danger threshold',
      subtitle: 'Progress bar turns red (%)',
      adjustment: new Gtk.Adjustment({ lower: 1, upper: 100, step_increment: 1, page_increment: 5 }),
    })
    settings.bind('danger-percent', dangerRow, 'value', Gio.SettingsBindFlags.DEFAULT)
    indicators.add(dangerRow)

    const refreshRow = new Adw.SpinRow({
      title: 'Refresh interval',
      subtitle: 'Seconds (10–3600)',
      adjustment: new Gtk.Adjustment({ lower: 10, upper: 3600, step_increment: 10, page_increment: 60 }),
    })
    settings.bind('refresh-seconds', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT)
    indicators.add(refreshRow)
  }

  _buildTokenRow(settings, key, title, subtitle) {
    const row = new Adw.SpinRow({
      title,
      subtitle,
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 1_000_000,
        step_increment: 10,
        page_increment: 100,
      }),
    })
    row.value = Math.round(Number(settings.get_int64(key)) / 1_000_000)
    row.connect('changed', () => {
      const tokens = Math.round(row.value * 1_000_000)
      if (settings.get_int64(key) !== tokens) {
        settings.set_int64(key, tokens)
      }
    })
    settings.connect(`changed::${key}`, () => {
      const v = Math.round(Number(settings.get_int64(key)) / 1_000_000)
      if (row.value !== v) row.value = v
    })
    return row
  }
}
