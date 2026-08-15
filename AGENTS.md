# AGENTS.md

## Что за проект

**kotik-researcher** — задел под исследовательскую платформу с LLM-агентом:
typed artifacts, provenance источников, возобновляемые исследовательские
сессии (долгосрочное видение). Сейчас реализован базовый десктоп-чат с
DeepSeek — это фундамент, а не конечная цель.

Первая итерация проекта (Pi SDK + Electron) сохранена в ветке `backup`.
Её ключевой урок: **нельзя смешивать слой агента и ядро приложения** —
отсюда главный инвариант ниже.

## Решение о стеке

Выбран **Rig + Tauri + React**. Альтернативы `Pi SDK + Electron` и
`Tauri + Pi RPC` отвергнуты: первая не даёт Rust-ядра и тянет Electron,
вторая добавляет лишний RPC-слой до стабилизации headless-протокола.

Принятые риски: API `rig-core` нестабилен (миграции локализованы в
`kotik-agent-rig`); Tauri WebView различается между ОС (для будущих
KaTeX/PDF/canvas потребуется отдельная проверка); свой CLI вместо Pi TUI —
свой артефакт для поддержки.

Осознанно отложено до первых research-фич: typed artifacts
(ResearchIntent/Evidence/Claim), event log, SQLite, генерация TS-типов,
полноценный TUI (ratatui), Python sandbox. **Не вводить раньше времени.**

Открытый вопрос: долгосрочная память проекта (уроки, решения, контекст) —
формат не выбран, решить осознанно отдельной задачей.

## Карта проекта

```
src/                        # React 19 + Vite фронтенд (JavaScript, не TypeScript)
├── main.jsx                # точка входа
├── App.jsx                 # весь чат: состояние, invoke, стриминг через Channel
└── App.css
src-tauri/                  # Cargo workspace
├── src/lib.rs              # Tauri-оболочка (пакет kotik-researcher) — тонкий IPC-адаптер
├── crates/kotik-core/      # контракты (ChatMessage, ChatEvent, ChatError) + порт ChatAgent.
│                           # Чистый Rust: БЕЗ Rig, Tauri, UI
├── crates/kotik-agent-rig/ # адаптер Rig (DeepSeek), реализует ChatAgent
├── crates/kotik-cli/       # headless чат в терминале (TUI-first harness)
└── tauri.conf.json         # devUrl :1420, frontendDist ../dist
.opencode/
├── skills/kotik-reflect/   # ретроспектива сессий (session-digest.mjs + correction-phrases.txt)
├── skills/kotik-usage/     # отчёт по токенам/стоимости (usage-report.mjs + pricing.json)
└── agents/reflector.md     # субагент анализа дайджестов (deepseek-v4-flash)
eslint.config.js            # flat config ESLint (eslint 9 + eslint-plugin-react)
```

## Инварианты

### Архитектура

- **Ядро ≠ агент ≠ UI.** `kotik-core` не импортирует Rig, Tauri и не знает
  про React — это контролируется компилятором, не дисциплиной. Новый
  функционал сначала появляется в core + CLI, UI — тонкий адаптер поверх.
- **TUI-first.** Весь функционал обязан работать через `kotik-cli` без
  запуска десктоп-окна. Если фича доступна только в UI — она не в core.
- UI не владеет состоянием: история чата живёт в React и передаётся в
  команду целиком, Rust-часть stateless.

### Definition of Done

Задача **не считается выполненной**, пока не зелёные ВСЕ проверки:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run lint
npm run build
```

«Работает у меня вручную» без зелёных проверок — незавершённая задача.

### Баг-фиксы: первопричина, не симптом

При любом баге: **воспроизвести → локализовать первопричину → исправить
причину → добавить регрессионный тест**. Запрещено лечить симптом
(обёртки try/catch вокруг непонятной ошибки, ретраи «чтобы прошло»,
правка следствия вместо источника). Если первопричина не найдена —
задача не закрыта, фиксируем состояние расследования.

### Секреты

`DEEPSEEK_API_KEY` и любые ключи — только из переменных окружения
(`deepseek::Client::from_env()`). Ключи не храним, не коммитим, не пишем
в логи.

## Зависимости и где по ним смотреть информацию

| Зависимость | Версия | Где смотреть |
|---|---|---|
| `rig-core` (как `rig`) | 0.41 | ⚠️ API нестабилен. Только исходники закреплённой версии: `~/.cargo/registry/src/*/rig-core-0.41.0/` или docs.rs/rig-core/**0.41.0**. Докам с main-branch НЕ верить — типы стриминга уже переименованы |
| `tauri` | 2 | https://tauri.app, схема конфига: https://schema.tauri.app/config/2 |
| `@tauri-apps/api` | 2 | https://tauri.app/reference/javascript/ — `invoke`, `Channel` |
| React | 19 | https://react.dev |
| Vite | 8 | https://vite.dev |
| DeepSeek API | v4 | https://api-docs.deepseek.com |
| Node.js | 24 | Скрипты скиллов используют `node:sqlite` — требуется Node ≥ 22.5 |

## Команды

```bash
npm run tauri dev                                        # десктоп-приложение (нужен DEEPSEEK_API_KEY)
cargo run --manifest-path src-tauri/Cargo.toml -p kotik-cli   # чат в терминале без UI
node .opencode/skills/kotik-usage/scripts/usage-report.mjs    # отчёт по токенам/стоимости
node .opencode/skills/kotik-reflect/scripts/session-digest.mjs # дайджест сессий для ретроспективы
```

Проверки — см. Definition of Done выше.

## Ограничения среды

- `create-tauri-app` здесь не работает (требует TTY) — структура создана вручную.
