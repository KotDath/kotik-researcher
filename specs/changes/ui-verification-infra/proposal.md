Status: approved
Review: CHANGES_REQUESTED 2026-07-29
Profile: feature
Size: normal
Contours: ui, core, agentic
Risk: medium

# Proposal: ui-verification-infra

## Зачем

LRN-20260729-001: два визуальных бага (скролл, схлопывание tool-блоков) потребовали двух коррекций пользователя при приёмке chat-reasoning-stream, потому что проверка ограничивалась данными и code review — живой UI никто не смотрел. Корректные данные не гарантируют корректный рендер. Нужна системная трёхслойная инфраструктура тестирования и верификации UI, встроенная в SDD-цикл, а не ad-hoc CDP-замеры.

## Что меняется

- **Тестовая инфраструктура (новый capability `ui-verification`):**
  - Vitest unit/интеграционные тесты (компоненты, сторы, хуки, IPC-обёртки) с workspace (node + web tsconfig)
  - Playwright E2E smoke-тесты (5–10 сценариев) через `_electron.launch()` — два режима: build (prod) и quick (electron-vite dev с CDP); окна скрыты (`show: false`), скриншоты работают
  - Visual regression (5–10 ключевых экранов) через `toHaveScreenshot()`, baseline в git, только ручное обновление
  - Семь npm-скриптов: `test`, `test:unit`, `test:e2e`, `test:e2e:quick`, `test:visual`, `test:agent:electron`, `test:agent:dev` (оба агентских — на CDP :9222)
- **Агент-driven верификация:**
  - Один MCP-сервер `playwright` в `opencode.json` с `--cdp-endpoint http://127.0.0.1:9222` — доступен всем агентам
  - Два режима на едином CDP-транспорте: быстрый (electron-vite dev, main из исходников + renderer из HMR) и полный (собранное prod-приложение)
  - Новый субагент `ui-reviewer` (`.opencode/agents/ui-reviewer.md`, модель kimi-for-coding/k3) — deny:edit, живой UI через MCP, возвращает PASS/FAIL
  - Новый субагент `app-tester` (Flash) — black-box проходит живой user flow через Electron CDP и возвращает PASS/FAIL с evidence
  - Конвейер: deterministic checks из tasks.md → reviewer → app-tester → ui-reviewer при renderer/both
  - Цикл generator/evaluator ≤3 итераций, после 3-го FAIL — эскалация к человеку
- **Документация и процесс:**
  - `docs/ui-review.md` — критерии FAIL (clipping, overflow, missing states, visual hierarchy, spacing, focus)
  - `AGENTS.md` — секция «App и UI verification» с разделением functional/visual checks, запретом автообновления baseline и лимитом 3 итераций
  - Ужесточение протокола идеатора: обязательное покрытие всех измерений карты в vision.md, оркестратор проверяет
  - Контракт implementer'а: строки `Change touches` и `Contours`; deterministic checks выполняются по tasks.md, exploratory testing делегируется app-tester
- **Очистка:** `src/main/spike.ts` и `SPIKE_HEADLESS` — удалены; новый стек Playwright E2E + MCP покрывает все сценарии

## Capabilities

- **Новые:** `ui-verification` — трёхслойная тестовая инфраструктура и агент-driven верификация UI приложения, встроенные в SDD-цикл.
- **Изменённые:** нет — тесты верифицируют существующее поведение, не меняя его. `data-testid` атрибуты — деталь реализации. Удаление spike.ts не затрагивает задокументированное поведение (spike не покрыт ни одной capability).

## Влияние

- **Новые devDependencies:** `@playwright/test`, `@playwright/mcp`, `vitest`, `@testing-library/react` + возможно `@testing-library/jest-dom`
- **Новая директория `tests/`** в корне (вне `src/`): `tests/unit/`, `tests/e2e/`, `tests/visual/`
- **Новые конфигурационные файлы:** `playwright.config.ts`, `vitest.workspace.ts`
- **Новый npm-скрипт `pnpm test`** — агрегирует unit + e2e + visual; не должен ломать `pnpm typecheck`, `pnpm lint`, `pnpm build`
- **Система агентов:** ui-reviewer и app-tester, один mcp.playwright CDP,
  `AGENTS.md`, `docs/ui-review.md`, правки implementer/reviewer/orchestrator
- **Удаление кода:** `src/main/spike.ts` (4 функции, ~450 строк), `SPIKE_HEADLESS`-ветвление из `src/main/index.ts`
- **design.md нужен:** справка по Playwright `_electron` API и `@playwright/mcp` (урок LRN-20260728-002: не реверс-инжинирить семантику заново); интеграция двух режимов агента в SDD-цикл; кросс-резовые решения (конфигурация, fixture, baseline-стратегия)

## Открытые вопросы

Все 19 вопросов разрешены в 5 раундах vision-интервью. Новых неразрешённых вопросов нет.

## Revision 1 — 2026-07-29

Три решения пользователя после обсуждения конвейера верификации: (A) один MCP-сервер с `--cdp-endpoint` вместо двух — оба агентских режима унифицированы на Electron CDP (быстрый = electron-vite dev, полный = prod build); Chromium-режим против голого dev-server удалён. (B) невидимые окна (`show: false` + `backgroundThrottling: false`) — приложение не крадёт фокус пользователя при тестах и агентских прогонах; скриншоты работают через композитор CDP. (C) трёхагентный конвейер — implementer только код + unit (e2e/visual/agent запрещены), новый test-runner (flash) прогоняет e2e/visual механически, reviewer только логика против спеки (не тесты), ui-reviewer (k3) — живой UI; тройной PASS gate для approve.

## Revision 2 — 2026-07-29

Решение C заменено после ревью всей метасистемы: отдельная LLM для запуска
фиксированных тестовых команд не нужна. Implementer на Flash выполняет
deterministic checks, reviewer Sol/medium проверяет code/spec, app-tester
Flash исследует поведение live app, ui-reviewer K3 независимо оценивает
визуальный результат.
