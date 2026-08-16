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
Python sandbox. **Не вводить раньше времени.**

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
├── crates/kotik-cli/       # полноценный TUI-чат на ratatui (TUI-first harness):
│                           # main.rs — цикл событий/терминал, app.rs — чистое состояние,
│                           # ui.rs — отрисовка кадра
└── tauri.conf.json         # devUrl :1420, frontendDist ../dist
openspec/                   # SDD: спеки и changes (OpenSpec, ванильный workflow)
├── specs/                  # действующие требования (source of truth по поведению)
├── changes/                # активные changes; archive/ — история решений
└── config.yaml             # схема + project context для AI
.opencode/
├── skills/ast-index/       # структурный поиск кода (порт плагина defendend/ast-index)
├── skills/kotik-reflect/   # ретроспектива сессий (session-digest.mjs + correction-phrases.txt)
├── skills/kotik-usage/     # отчёт по токенам/стоимости (usage-report.mjs + pricing.json)
├── skills/openspec-*/      # workflow-скиллы OpenSpec (сгенерированы openspec init)
├── commands/opsx-*.md      # slash-команды OpenSpec (сгенерированы)
├── commands/kotik-*.md     # slash-команды скиллов reflect/usage
└── agents/reflector.md     # субагент анализа дайджестов (deepseek-v4-flash)
opencode.json               # разрешения: ast-index — bash без подтверждения
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

## Инструменты разработки

### ast-index — структурный поиск кода

PRIMARY-инструмент навигации по коду (вместо grep по символам). Скилл:
`.opencode/skills/ast-index/SKILL.md` — там critical rules, команды,
ограничения. Кратко:

```bash
ast-index explore "stream chat reply"   # one-shot контекст по области кода
ast-index usages ChatAgent              # все использования перед рефакторингом
ast-index refs send_message             # определения + импорты + usages
ast-index map --module src-tauri        # карта проекта (скоуп; без --module шумит node_modules)
ast-index update                        # инкрементально после правок
ast-index rebuild                       # полный переиндекс
```

Установка: `cargo install --git https://github.com/defendend/Claude-ast-index-search ast-index`.
Индекс в `~/.cache/ast-index/`, конфиг не нужен. `node_modules/**/*.d.ts`
индексируются намеренно — дают API зависимостей в search/explore.
Запросы — терминами кода (англ.), не русской прозой.

### OpenSpec — spec-driven development

Спеки и changes живут в `openspec/`; workflow-команды `/opsx:*` доступны
в opencode (сгенерированы `openspec init`, не редактировать — перезапишутся
при `openspec update`).

**Когда spec обязателен:** фичи, меняющие контракты (`kotik-core`), порты,
архитектуру, доменную модель. **Когда не нужен:** багфиксы, рефакторинг без
смены поведения, мелкие UI-правки, документация.

**Цикл:**
1. `/opsx:explore <идея>` — необязательный, но рекомендуемый шаг: обсудить
   подход до артефактов (прочитает код, предложит варианты).
2. `/opsx:propose <что строим>` — создаёт `openspec/changes/<name>/`:
   proposal.md (что и зачем), specs/ (требования SHALL + сценарии WHEN/THEN),
   design.md (как), tasks.md (чеклист). **Код на этом шаге не пишется.**
3. Ревью артефактов глазами → правки → только потом реализация.
4. `/opsx:apply` — реализация по tasks.md (помечать выполненные задачи).
5. `/opsx:archive` — перенос change в `changes/archive/`, дельты спек
   сливаются в `openspec/specs/`.

Проверки: `openspec list`, `openspec status --change <name>`,
`openspec validate <name>`. Контекст проекта для AI — `openspec/config.yaml`.

Отложено осознанно (после пилота): профили/оркестрация из backup-ветки,
кастомные схемы OpenSpec.

## Зависимости и где по ним смотреть информацию

| Зависимость | Версия | Где смотреть |
|---|---|---|
| `rig-core` (как `rig`) | 0.41 | ⚠️ API нестабилен. Только исходники закреплённой версии: `~/.cargo/registry/src/*/rig-core-0.41.0/` или docs.rs/rig-core/**0.41.0**. Докам с main-branch НЕ верить — типы стриминга уже переименованы |
| `tauri` | 2 | https://tauri.app, схема конфига: https://schema.tauri.app/config/2 |
| `ratatui` | 0.29 | https://ratatui.rs — используется unstable-фича `rendered-line-info` (`Paragraph::line_count` для скролла); при апгрейде проверять `kotik-cli/src/ui.rs` |
| `crossterm` | 0.28 | https://docs.rs/crossterm — версия обязана совпадать с бэкенд-зависимостью ratatui (проверка: `cargo tree -i crossterm`) |
| `@tauri-apps/api` | 2 | https://tauri.app/reference/javascript/ — `invoke`, `Channel` |
| React | 19 | https://react.dev |
| Vite | 8 | https://vite.dev |
| DeepSeek API | v4 | https://api-docs.deepseek.com |
| Node.js | 24 | Скрипты скиллов используют `node:sqlite` — требуется Node ≥ 22.5 |
| ast-index | 3.50 | CLI без crates.io: исходники `~/Documents/Claude-ast-index-search` (тег v3.50.0) или GitHub. Скилл — `.opencode/skills/ast-index/` |
| OpenSpec | 1.9 | https://openspec.dev/docs — workflow `/opsx:*`, кастомизация через `openspec/config.yaml` |

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
