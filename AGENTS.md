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
├── agents/orchestrator.md      # PRIMARY: роутинг, гейты, делегирование; src/ deny
├── agents/spec-writer.md       # grill-опрос + артефакты change через openspec CLI (k3)
├── agents/implementer.md       # standard-реализация (deepseek-v4-flash)
├── agents/implementer-deep.md  # deep-реализация (k3)
├── agents/reviewer.md          # независимое код-ревью (openai/gpt-5.6-sol)
├── agents/technical-consultant.md # read-only консультант для implementer'а (k3)
├── agents/reflector.md         # субагент анализа дайджестов (deepseek-v4-flash)

# Модели задаются явно в frontmatter каждого агента (единственное место правды
# — там и в этой карте); агент без model унаследует k3 оркестратора.
├── skills/ast-index/       # структурный поиск кода (порт плагина defendend/ast-index)
├── skills/kotik-reflect/   # ретроспектива сессий (session-digest.mjs + correction-phrases.txt)
├── skills/kotik-usage/     # отчёт по токенам/стоимости (usage-report.mjs + pricing.json)
├── skills/openspec-*/      # workflow-скиллы OpenSpec (сгенерированы openspec init)
├── commands/opsx-*.md      # slash-команды OpenSpec (сгенерированы)
└── commands/kotik-*.md     # slash-команды скиллов reflect/usage
opencode.json               # subagent_depth: 3 (вложенность ролей), explore — deepseek-v4-flash; разрешения: ast-index — bash без подтверждения
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

**Цикл (основной режим — агент `orchestrator`, процедура —
`.opencode/agents/orchestrator.md`):**
1. Explore — режим оркестратора, НЕ гейт: для неясных/крупных идей —
   обсудить подход до артефактов. Механическая разведка кода — встроенный
   explore-субагент.
2. Скаффолд `openspec new change` + vision.md (дистиллят explore, если был)
   — оркестратор. Routing card: Profile/Size/Risk/Implementation.
3. `/opsx:propose` → **spec-writer** ведёт grill-опрос пользователя
   итеративными раундами (скоуп, критерии приёмки как наблюдаемые свойства,
   non-goals, граничные случаи, UX, режимы отказа) и создаёт артефакты
   через openspec CLI. Артефакты не создаются, пока открыты вопросы,
   влияющие на объём или критерии приёмки. **Код на этом шаге не пишется.**
4. Spec review packet от оркестратора → правки (resume spec-writer по
   task_id) → явный approve пользователя.
5. `/opsx:apply` → реализация делегируется implementer'у (standard) или
   implementer-deep (deep) по routing card; чекбоксы tasks.md, DoD. Затем
   ревью-гейт: **reviewer** против спеки, цикл исправлений ≤3 итераций.
6. `/opsx:archive` — оркестратор: sync спек, `openspec validate`, перенос
   в `changes/archive/`.

Fallback-режим: build-агент с ванильными `/opsx:*` (как раньше) — для
мелочи и на случай отладки ролей. Если question tool субагенту недоступен —
grill ведёт оркестратор, spec-writer оформляет (зафиксировано в
orchestrator.md).

Проверки: `openspec list`, `openspec status --change <name>`,
`openspec validate <name>`. Контекст проекта для AI — `openspec/config.yaml`.

Отложено осознанно: кастомные схемы OpenSpec; расширение ролей из
backup-ветки (консилиум, app-tester, ui-reviewer) — только отдельным change.

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
