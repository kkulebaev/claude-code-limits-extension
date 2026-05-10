# Claude Code Limits — GNOME Shell extension

Показывает в верхней панели Fedora/GNOME активность Claude Code:

- **5h** — стоимость и токены текущего 5-часового billing-блока, время до сброса, burn rate, прогноз;
- **7d** — суммарная стоимость и токены за rolling 7 дней.

> **Важно.** Это **аппроксимация активности**, посчитанная локально по логам в
> `~/.claude/projects/` через [`ccusage`](https://www.npmjs.com/package/ccusage).
> Реальные проценты лимитов Anthropic (5-часовой и недельный) у Claude Code
> публично не доступны через CLI/API — этот плагин показывает то, что можно
> вытянуть локально.

## Требования

- GNOME Shell 45+ (тестировалось на 49.6, Fedora 43)
- Node.js или Bun (для запуска `ccusage` через `npx`/`bunx`)
- Желательно: глобально установленный `ccusage` — иначе каждый запуск через
  `npx -y ccusage@latest` будет тянуть пакет из npm-кэша.

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
ccusage --version || bunx ccusage --version || npx -y ccusage@latest --version
```

## Структура

```
metadata.json       # манифест extension'а (UUID, поддерживаемые версии shell)
extension.js        # PanelMenu.Button + Gio.Subprocess к ccusage
stylesheet.css      # стили лейбла, popup-строк
install.sh          # копирует файлы в ~/.local/share/gnome-shell/extensions
```
