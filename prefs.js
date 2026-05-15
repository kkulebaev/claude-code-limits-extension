import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import Gio from 'gi://Gio'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

export default class ClaudeCodeLimitsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings()

    const page = new Adw.PreferencesPage({ title: 'General', icon_name: 'preferences-system-symbolic' })
    window.add(page)

    const polling = new Adw.PreferencesGroup({
      title: 'Polling',
      description:
        'При отключённом API-опросе расширение перестаёт стучаться на api.anthropic.com ' +
        'и продолжает показывать последние полученные значения. Кнопка "Refresh now" в popup-меню ' +
        'остаётся доступной для разового ручного запроса.',
    })
    page.add(polling)

    const apiEnabledRow = new Adw.SwitchRow({
      title: 'Enable API requests',
      subtitle: 'Auto-polling. Turns off automatically after an API error until you press Refresh.',
    })
    settings.bind('api-enabled', apiEnabledRow, 'active', Gio.SettingsBindFlags.DEFAULT)
    polling.add(apiEnabledRow)

    const indicators = new Adw.PreferencesGroup({
      title: 'Indicators',
      description:
        'Лимиты приходят с сервера Anthropic (как в /usage внутри Claude Code). ' +
        'Пороги ниже только окрашивают прогресс-бары.',
    })
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
}
