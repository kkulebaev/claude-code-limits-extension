# Claude Code Limits — GNOME Shell extension

Показывает в верхней панели Fedora/GNOME активность Claude Code:

- **5h** — стоимость и токены текущего 5-часового billing-блока, время до сброса, burn rate, прогноз;
- **7d** — суммарная стоимость и токены за 7 календарных дней.

> **Важно.** Это **аппроксимация активности**, посчитанная локально по логам в
> `~/.claude/projects/` через [`ccusage`](https://www.npmjs.com/package/ccusage).
> Реальные проценты лимитов Anthropic (5-часовой и недельный) у Claude Code
> публично не доступны через CLI/API — этот плагин показывает то, что можно
> вытянуть локально.

## Требования

- GNOME Shell 45+ (тестировалось на 49.6, Fedora 43)
- Глобально установленный `ccusage` версии **18.0.0 или выше** (плагин использует
  поле `tokenCounts` из JSON-вывода). Плагин запускает абсолютный путь к бинарнику;
  on-demand fallback не реализован.

```sh
pnpm add -g ccusage   # или: npm i -g ccusage / bun add -g ccusage
```

## Установка

```sh
./install.sh
```

После установки нужно перезайти в сессию (на Wayland — обязательно;
на X11 можно `Alt+F2`, ввести `r`, Enter), затем включить:

```sh
gnome-extensions enable claude-code-limits@kkulebaev
```

## Обновление с 0.2.0

Дефолтная метрика в 0.3.0 исключает cache-read токены, которые раньше доминировали в
счётчике (обычно занимали ~80% от `ccusage totalTokens`). Если у вас была ручная
подстройка `five-hour-token-limit` или `weekly-token-limit`, числа в баре упадут
примерно в 5 раз. Варианты:

- перенастроить бюджеты в prefs под новые величины (рекомендуется);
- включить переключатель **«Count cache reads»** в prefs, чтобы вернуть старое
  поведение (cache-read токены снова войдут в счёт).

## Удаление

```sh
gnome-extensions disable claude-code-limits@kkulebaev
rm -rf ~/.local/share/gnome-shell/extensions/claude-code-limits@kkulebaev
```

## Отладка

Логи GNOME Shell:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

Проверить, какую команду найдёт extension:

```sh
ccusage --version
```

## Структура

```
metadata.json       # манифест extension'а (UUID, поддерживаемые версии shell)
extension.js        # PanelMenu.Button + Gio.Subprocess к ccusage
prefs.js            # окно настроек (Adw.PreferencesPage)
stylesheet.css      # стили лейбла, popup-строк
schemas/            # GSettings-схема (org.gnome.shell.extensions.claude-code-limits)
install.sh          # копирует файлы в ~/.local/share/gnome-shell/extensions
```
