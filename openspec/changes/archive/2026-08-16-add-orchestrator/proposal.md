# Proposal: add-orchestrator

## Why

Сессия add-ratatui-tui показала: один агент монолитно проходит весь SDD-цикл
(propose→apply→archive→push, ~5M токенов, ~270 мин), опрос перед спекой
минимален, код-ревью как этап отсутствует. Backup-ветка содержит работавший
прототип разделения труда (оркестратор + субагенты, routing card, resume по
task_id), но её ручная state machine спек вытеснена openspec CLI — переносить
нужно только план разделения труда, не дублируя инструмент.

## What Changes

- Вводится primary-агент **оркестратор** (`.opencode/agents/orchestrator.md`)
  со структурным запретом правки `src/**`: роутинг, брифинг, Spec review
  packet, approve-гейты; код не пишет.
- Пять субагентов: **spec-writer** (ведёт grill-интервью пользователя через
  question tool, создаёт артефакты change через openspec CLI; правки — resume
  по task_id), **implementer** (быстрая модель), **implementer-deep**
  (сильная модель, выбирается routing card на этапе спеки), **reviewer**
  (код-ревью против спек, вердикт с evidence), **technical-consultant**
  (вложенное делегирование от implementer при локальном затыке).
- Процедура цикла: мини routing card (Size/Risk/Implementation) → grill-гейт
  → approve спеки пользователем → реализация → ревью-гейт (цикл ≤3 итераций)
  → архивация. State machine — ванильный openspec CLI, скиллы `/opsx:*` не
  патчатся; логика оркестрации живёт только в `.opencode/agents/*.md`.
- Стык explore → спека: `vision.md` (дистиллят explore) в папке change;
  брифы субагентам ссылаются на файлы на диске, не на пересказ.
- Обновление `AGENTS.md`: карта агентов, новый SDD-цикл, grill-правило
  переносится со «спрашивает агент» на «опрос ведёт spec-writer».

## Capabilities

### New Capabilities

- `agent-orchestration`: разделение труда в SDD-цикле поверх openspec —
  роли и их границы (permissions), grill-гейт spec-writer'а, routing card и
  выбор implementer'а, ревью-гейт, resume-семантика субагентов, стык
  explore→спека через vision.md.

### Modified Capabilities

(нет — tui-chat не затрагивается)

## Impact

- **Файлы**: новые `.opencode/agents/{orchestrator,spec-writer,implementer,
  implementer-deep,reviewer,technical-consultant}.md`; правки `AGENTS.md`.
  Код `src/`, `src-tauri/` не меняется — change про процесс, не про продукт.
- **Платформа**: первая задача — smoke-тест доступности question tool
  кастомному субагенту (работало на backup-ветке); при провале — задокументированный
  fallback (grill ведёт оркестратор, spec-writer оформляет).
- **Модели**: закрепляются в frontmatter после инвентаризации доступных
  провайдеров (кандидаты: flash — implementer, strong — spec-writer/
  implementer-deep/consultant; reviewer ≠ модель оркестратора по возможности).
- **Процесс**: пользователь переключается на primary-оркестратор (Tab) как
  основной режим; build-агент с ванильными `/opsx:*` остаётся fallback для
  мелочи. DoD проекта не меняется.
- **Приёмка**: dogfood-пилот — первая мелкая фича проводится через новый
  цикл целиком.
