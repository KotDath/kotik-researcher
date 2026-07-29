Status: approved
Review: CHANGES_REQUESTED 2026-07-29

# Proposal: ui-verification-infra

## Зачем

LRN-20260729-001: два визуальных бага (скролл, схлопывание tool-блоков) потребовали двух коррекций пользователя при приёмке chat-reasoning-stream, потому что проверка ограничивалась данными и code review — живой UI никто не смотрел. Корректные данные не гарантируют корректный рендер. Нужна системная трёхслойная инфраструктура тестирования и верификации UI, встроенная в SDD-цикл, а не ad-hoc CDP-замеры.

## Что меняется

- **Тестовая инфраструктура (новый capability `ui-verification`):**
  - Vitest unit/интеграционные тесты (компоненты, сторы, хуки, IPC-обёртки) с workspace (node + web tsconfig)
  - Playwright E2E smoke-тесты (5–10 сценариев) через `_electron.launch()` — два режима: build (для reviewer) и dev (для implementer в итерациях)
  - Visual regression (5–10 ключевых экранов) через `toHaveScreenshot()`, baseline в git, только ручное обновление
  - Семь npm-скриптов: `test`, `test:unit`, `test:e2e`, `test:e2e:quick`, `test:visual`, `test:agent:electron`, `test:agent:dev`
- **Агент-driven верификация:**
  - Playwright MCP зарегистрирован в `opencode.json` (`mcp.servers.playwright`) — доступен всем агентам
  - Два режима: быстрый (MCP против dev-server renderer) и полный (MCP против живого Electron через `--cdp-endpoint 9222`)
  - Новый субагент `ui-reviewer` (`.opencode/agents/ui-reviewer.md`) — deny:edit, возвращает PASS/FAIL
  - FAIL от ui-reviewer — hard gate для approve
  - Цикл generator/evaluator ≤3 итераций, после 3-го FAIL — эскалация к человеку
- **Документация и процесс:**
  - `docs/ui-review.md` — критерии FAIL (clipping, overflow, missing states, visual hierarchy, spacing, focus)
  - `AGENTS.md` — секция «UI verification» с пошаговыми инструкциями для обоих режимов агента, запретом автообновления baseline, лимитом 3 итераций
  - Ужесточение протокола идеатора: обязательное покрытие всех измерений карты в vision.md, оркестратор проверяет
  - Контракт implementer'а: строка `Change touches: renderer` (или `main`, `both`) в ответе оркестратору
- **Очистка:** `src/main/spike.ts` и `SPIKE_HEADLESS` — удалены; новый стек Playwright E2E + MCP покрывает все сценарии

## Capabilities

- **Новые:** `ui-verification` — трёхслойная тестовая инфраструктура и агент-driven верификация UI приложения, встроенные в SDD-цикл.
- **Изменённые:** нет — тесты верифицируют существующее поведение, не меняя его. `data-testid` атрибуты — деталь реализации. Удаление spike.ts не затрагивает задокументированное поведение (spike не покрыт ни одной capability).

## Влияние

- **Новые devDependencies:** `@playwright/test`, `@playwright/mcp`, `vitest`, `@testing-library/react` + возможно `@testing-library/jest-dom`
- **Новая директория `tests/`** в корне (вне `src/`): `tests/unit/`, `tests/e2e/`, `tests/visual/`
- **Новые конфигурационные файлы:** `playwright.config.ts`, `vitest.workspace.ts`
- **Новый npm-скрипт `pnpm test`** — агрегирует unit + e2e + visual; не должен ломать `pnpm typecheck`, `pnpm lint`, `pnpm build`
- **Система агентов:** новый файл `.opencode/agents/ui-reviewer.md`, изменения в `opencode.json` (mcp.servers), `AGENTS.md` (секция UI verification, ужесточение идеатора), новый `docs/ui-review.md`
- **Удаление кода:** `src/main/spike.ts` (4 функции, ~450 строк), `SPIKE_HEADLESS`-ветвление из `src/main/index.ts`
- **design.md нужен:** справка по Playwright `_electron` API и `@playwright/mcp` (урок LRN-20260728-002: не реверс-инжинирить семантику заново); интеграция двух режимов агента в SDD-цикл; кросс-резовые решения (конфигурация, fixture, baseline-стратегия)

## Открытые вопросы

Все 19 вопросов разрешены в 5 раундах vision-интервью. Новых неразрешённых вопросов нет.
