# Claude Code Limits — GNOME Shell extension

Показывает в верхней панели Fedora/GNOME реальные проценты использования Claude
Code — те же, что выдаёт команда `/usage` внутри интерактивной сессии:

- **5h** — текущее 5-часовое окно, процент и время до сброса;
- **7d** — последние 7 дней (агрегат), процент и время до сброса.

Данные тянутся напрямую с `api.anthropic.com` (приватный OAuth-эндпоинт
`/api/oauth/usage`) с использованием токена из `~/.claude/.credentials.json`.
Это значит, что цифры 1:1 совпадают с `/usage` и обновляются вслед за
изменениями тарифа / лимитов на стороне Anthropic.

## Управление опросом API

- В popup-меню есть переключатель **API requests** и кнопка **Refresh now**.
- Если выключить переключатель (или снять галку в настройках) — расширение
  перестаёт стучаться на API, но продолжает показывать последние полученные
  цифры. Кнопка `Refresh now` остаётся рабочей для разового ручного запроса.
- Если API вернул ошибку, авто-опрос ставится на паузу: цифры замораживаются,
  в popup-меню появляется строка статуса с текстом ошибки. Расширение **не**
  будет ретраить самостоятельно — возобновление произойдёт только при нажатии
  `Refresh now` (если ответ успешен, таймер снова стартует автоматически).

## Требования

- GNOME Shell 45+ (тестировалось на 49.6, Fedora 43).
- Установленный и залогиненный Claude Code (подписка, не API key) — файл
  `~/.claude/.credentials.json` должен содержать `claudeAiOauth.accessToken`.

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

Если в баре висит `Claude: ⚠`:

- `credentials not readable` — `~/.claude/.credentials.json` не существует или
  не доступен; запустите `claude` хотя бы раз для входа.
- `401 Unauthorized` — OAuth-токен просрочен; запустите `claude` — CLI сам
  обновит токен в credentials-файле, бар подтянется на следующем тике.
- `HTTP 5xx` — проблема на стороне Anthropic, ретрай по таймеру.

## Структура

```
metadata.json       # манифест extension'а (UUID, поддерживаемые версии shell)
extension.js        # PanelMenu.Button + Soup.Session к /api/oauth/usage
prefs.js            # окно настроек (Adw.PreferencesPage)
stylesheet.css      # стили лейбла, popup-строк
schemas/            # GSettings-схема (org.gnome.shell.extensions.claude-code-limits)
install.sh          # копирует файлы в ~/.local/share/gnome-shell/extensions
```

## Замечание про приватный API

Эндпоинт `/api/oauth/usage` не задокументирован публично — это тот же
эндпоинт, который дёргает сам Claude Code для своей команды `/usage`.
Anthropic может изменить его без предупреждения; в этом случае расширение
покажет соответствующую ошибку, нужен будет апдейт.
