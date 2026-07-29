# Vision: ui-verification-infra

## Цель и границы

**Зачем (мотивация):** LRN-20260729-001 — баг верифицируется на том же уровне,
где наблюдается симптом. При приёмке chat-reasoning-stream два визуальных бага
(скролл, схлопывание tool-блоков) потребовали двух коррекций пользователя, пока
мы не проверили живой UI через CDP. Корректные данные не гарантируют корректный
рендер. Нужна системная инфраструктура UI-верификации, чтобы это не было ad-hoc.

**Что строим:** трёхслойную инфраструктуру тестирования и верификации UI:
1. **Vitest-слой** — unit/интеграционные тесты компонентов, сторов, IPC-обёрток
2. **Playwright E2E-слой** — детерминированные smoke-тесты реального Electron
   приложения через `_electron.launch()` (5–10 сценариев)
3. **Visual regression-слой** — скриншотные тесты 5–10 ключевых экранов,
   baseline в git, только ручное обновление
4. **Агент-driven верификация** — два режима (быстрый: MCP против dev-server
   renderer; полный: MCP против живого Electron через `--cdp-endpoint`)
5. **ui-reviewer субагент** — отдельный агент (`.opencode/agents/ui-reviewer.md`),
   только смотрит UI через Playwright, возвращает PASS/FAIL, не трогает код
6. **Документация** — `docs/ui-review.md` (критерии проверки), обновление
   `AGENTS.md` (инструкции для агентов, включая ужесточение протокола идеатора:
   обязательное покрытие всех измерений карты в vision.md, оркестратор проверяет
   наличие всех секций перед передачей spec-writer'у)

**Что НЕ входит (антискоуп):**
- Облачные visual-сервисы (Percy, Applitools, Chromatic)
- Полное snapshot-покрытие всего UI
- CI-инфраструктура (GitHub Actions workflow)
- Тестирование pi SDK
- Автообновление baseline (всегда ручное, с `--update-snapshots`)

## Техническая реализация

**Стек:**
- `@playwright/test` + `_electron` API — E2E-тесты реального Electron
- `@playwright/mcp` — MCP-сервер для агент-driven верификации
- `vitest` + `@testing-library/react` — unit/интеграционные тесты
- Playwright `toHaveScreenshot()` — визуальные регрессии
- `electron --remote-debugging-port=9222` — CDP-эндпойнт для полного режима
  агента (живой Electron)

**Два режима агент-driven верификации:**
- **Быстрый (dev-server):** `pnpm dev:renderer` → renderer на localhost →
  `@playwright/mcp` подключается как к обычному браузеру. Для итеративной
  разработки: быстро, не требует сборки main, но не проверяет IPC/main.
- **Полный (live Electron):** `electron --remote-debugging-port=9222` →
  `@playwright/mcp --cdp-endpoint http://127.0.0.1:9222`. Финальная
  верификация: реальный рендер в Electron, интеграция main-renderer.

**Структура тестов:**
```
tests/
  unit/           # Vitest — компоненты, сторы, хуки, IPC-обёртки
  e2e/            # Playwright Test — _electron.launch(), пользовательские сценарии
  visual/         # Playwright Test — toHaveScreenshot(), baseline-скриншоты
```

**Vitest workspace:** `vitest.workspace.ts` с двумя проектами — один для
main-логики (`tsconfig.node.json`), один для renderer (`tsconfig.web.json`).

**Playwright конфигурация:** один `playwright.config.ts` в корне, два проекта
внутри — `e2e` (запуск Electron, пользовательские сценарии) и `visual`
(скриншотные тесты с `toHaveScreenshot`, отключением анимаций, масками).

**Два режима E2E-тестов:**
- `pnpm test:e2e` — `pnpm build` + `playwright test --project=e2e`. Для
  reviewer'а: полная production-сборка.
- `pnpm test:e2e:quick` — на dev-сборке electron-vite. Для implementer'а
  в итерациях: быстрее, без полной сборки.

**npm-скрипты:**
```
test              # pnpm test:unit && pnpm test:e2e && pnpm test:visual
test:unit         # vitest run (все workspace-проекты)
test:e2e          # pnpm build && playwright test --project=e2e
test:e2e:quick    # playwright test --project=e2e (на dev-сборке)
test:visual       # playwright test --project=visual
test:agent:electron  # запуск electron с --remote-debugging-port=9222
test:agent:dev    # информация для агента: dev-server + MPC подключение
```

**Стратегия test-id:** атрибуты `data-testid` в разметке React — для защиты от
хрупкости селекторов (не привязаны к CSS-классам или структуре DOM).

**Моки нативных диалогов:** через `electronApp.evaluate()` — подмена
`dialog.showOpenDialog`, `dialog.showMessageBox` и аналогов. Playwright не
перехватывает системные диалоги.

**Prior art:** существующий spike-механизм (`src/main/spike.ts`, SPIKE_HEADLESS)
и CDP-скрипт — **удалить**. Новый стек Playwright E2E + MCP покрывает все
сценарии; не плодим зоопарк инструментов.

**Файловая структура:** `tests/` в корне проекта:
- `tests/unit/` — Vitest (бизнес-логика, компоненты, сторы, IPC-обёртки)
- `tests/e2e/` — Playwright Test (пользовательские сценарии на `_electron`)
- `tests/visual/` — Playwright Test (скриншотные тесты с `toHaveScreenshot`)

**Интеграция в SDD-цикл:**
- **Обязательность:** implementer по диффу определяет, что change трогает
  renderer, и сообщает в ответе оркестратору: `Change touches: renderer`
  (или `main`, `both`). Reviewer и оркестратор требуют UI-проверку при
  `renderer`/`both`. Контракт — строка в ответе implementer'а, не поле
  в proposal.md.
- **Процесс:** implementer делает быструю самопроверку (unit + E2E + быстрый
  UI-чек через dev-server + MCP). Reviewer вызывает ui-reviewer для полной
  верификации (live Electron + скриншоты). FAIL от ui-reviewer — hard gate:
  блокирует approve без исключений.
- **Цикл generator/evaluator:** максимум 3 итерации, конвенция в AGENTS.md.
  После 3-го FAIL — эскалация к человеку.

## UI/UX

Не применимо — инфраструктурная фича, не затрагивает пользовательский интерфейс.

## Риски и опасения

- **playwright `_electron` — experimental:** API под префиксом `_`, но активно
  чинится (PR #41695, июль 2026), используется в CI Playwright для Electron
  42–43, рекомендован официальными доками Electron. Риск приемлем.
- **Флапающие скриншоты:** рендеринг зависит от ОС, шрифтов, GPU, headless-
  режима. Митигируется: фиксация размера окна, отключение анимаций, маски
  динамических регионов, единое окружение запуска.
- **Self-review bias:** агент склонен переоценивать свою работу (урок Османи).
  Митигируется: отдельный ui-reviewer с deny: edit, цикл generator/evaluator
  максимум 3 итерации.
- **MCP против dev-server не видит main-интеграцию:** баги IPC/preload не
  ловятся в быстром режиме. Митигируется: полный режим (live Electron) для
  финальной верификации + Playwright E2E-тесты.
- **Отсутствие CI:** все проверки — локально. Риск «забыли запустить».
  Митигируется: интеграция в SDD-цикл (обязательная проверка на стадии
  reviewer'а / kotik-approve).

## Компромиссы (что выбрано важнее и почему)

1. **Полнота покрытия сейчас vs идеальный coverage потом:** берём все три слоя
   сразу (Vitest + Playwright E2E + visual + agent-driven + ui-reviewer),
   а не минимальный срез. Мотивация: закрыть LRN-20260729-001 системно, а не
   частично; цена откладывания — повторение инцидента.
2. **Два режима агента vs один:** оба (dev-server + live Electron), а не
   унификация. Быстрый режим — для итеративной разработки (секунды), полный —
   для финальной верификации (полнота). Явное разделение в AGENTS.md.
3. **Отдельный ui-reviewer vs расширение reviewer'а:** отдельный агент, а не
   дополнительный чек в существующем. reviewer проверяет код против спеки,
   ui-reviewer — UI против `docs/ui-review.md`. Разные компетенции, разный
   инструментарий.
4. **Ручное обновление baseline vs автоматическое:** только ручное
   (`--update-snapshots`). Автообновление в CI/агентом — агент может сломать UI
   и обновить эталон, получив зелёный тест. Запрет зафиксирован в AGENTS.md.
5. **5–10 скриншотов vs полное покрытие:** ключевые экраны, а не всё.
   Соответствует совету Kent C. Dodds: один E2E happy path для критичного
   сценария, остальное — интеграционными тестами. Снижает хрупкость и
   maintenance-нагрузку.

## Крайние случаи и failure modes

- **Приложение не собрано перед E2E-тестом:** `pnpm test:e2e` делает
  `pnpm build` автоматически. `pnpm test:e2e:quick` работает на dev-сборке
  electron-vite — для итеративной разработки implementer'а.
- **Первый запуск — нет baseline:** `toHaveScreenshot()` создаёт baseline при
  первом прогоне. Нужна явная команда `--update-snapshots` и commit baseline в
  репозиторий.
- **CDP-порт занят:** Electron не запустится. Нужен retry/detect или
  динамический порт.
- **Renderer не загрузился / белый экран:** Playwright E2E должен иметь timeout
  + ассерт на видимость ключевого элемента (не только title).
- **Шрифты не загружены → скриншот отличается:** fixture должен дожидаться
  `document.fonts.ready` (из экспертной консультации).
- **Агент запускает MCP, но renderer не готов:** нужен health-check / retry
  перед началом верификации.
- **Множественные окна (BrowserWindow):** Electron может открыть несколько.
  Тесты должны явно выбирать нужное окно (`firstWindow()` / `windows()[n]`).
- **Пустые/loading/error-состояния:** ui-reviewer обязан проверять их согласно
  `docs/ui-review.md`. Без этого агент проверяет только happy path.

## Критерии приёмки

Общие (детализируются в spec-writer):

**Инфраструктура тестов:**
- `tests/unit/`, `tests/e2e/`, `tests/visual/` — директории созданы
- `vitest.workspace.ts` — два проекта (node + web tsconfig)
- `playwright.config.ts` — в корне, два проекта (e2e + visual)
- `pnpm add -D @playwright/test vitest @testing-library/react` — зависимости
- `pnpm add -D @playwright/mcp` — для агент-driven верификации

**npm-скрипты в package.json:**
- `test`, `test:unit`, `test:e2e`, `test:e2e:quick`, `test:visual`,
  `test:agent:electron`, `test:agent:dev` — все 7 скриптов

**Playwright E2E smoke (5–10 сценариев):**
- Приложение запускается через `_electron.launch()`
- Ключевые пользовательские сценарии проходят (создание проекта, навигация,
  настройки, и т.д.)
- `pnpm test:e2e` (build + test) проходит
- `pnpm test:e2e:quick` (dev + test) проходит

**Visual regression (5–10 экранов):**
- `toHaveScreenshot()` для ключевых экранов: главное окно, модалки, настройки,
  критические состояния (normal/empty/loading/error)
- Baseline-скриншоты закоммичены в git
- `pnpm test:visual` проходит без отличий от baseline
- Автообновление baseline запрещено явно (в AGENTS.md)

**Vitest unit-тесты:**
- Покрытие: бизнес-логика, сторы, IPC-обёртки, хуки
- Используется `@testing-library/react` для компонентных тестов
- `pnpm test:unit` проходит

**Агент-driven верификация:**
- Быстрый режим: агент может выполнить `pnpm test:agent:dev` → dev-server →
  MCP-подключение → верификация UI
- Полный режим: агент может выполнить `pnpm test:agent:electron` → запуск
  Electron с CDP → `@playwright/mcp --cdp-endpoint` → верификация
- Инструкции для обоих режимов в AGENTS.md (секция «UI verification»)

**ui-reviewer субагент:**
- `.opencode/agents/ui-reviewer.md` существует
- `permission.edit: deny`, `permission.bash: allow` (только запуск проверок)
- Возвращает PASS/FAIL с evidence (скриншоты, логи)
- FAIL — hard gate для approve

**Документация:**
- `docs/ui-review.md` — критерии FAIL (clipping, overflow, missing states,
  visual hierarchy, spacing, focus, etc.)
- `AGENTS.md` — секция «UI verification» с пошаговыми инструкциями
- В AGENTS.md зафиксированы: запрет автообновления baseline, лимит 3
  итераций generator/evaluator, два режима верификации
- В AGENTS.md зафиксировано ужесточение протокола идеатора: обязательное
  покрытие всех измерений карты в vision.md, оркестратор проверяет наличие
  всех секций перед передачей spec-writer'у

**Конфигурация MCP:**
- `opencode.json` → `mcp.servers.playwright` — `@playwright/mcp` как
  локальный MCP-сервер (доступен ui-reviewer и другим агентам)

**Сборка и качество:**
- `pnpm typecheck && pnpm lint && pnpm build` проходят
- `pnpm test` (unit + e2e + visual) проходит

**Очистка:**
- `src/main/spike.ts` и связанный CDP-скрипт — удалены
- `SPIKE_HEADLESS` и связанные env-переменные — удалены из конфигурации

## Открытые вопросы

Все вопросы, выявленные на старте, разрешены в интервью. Новых неразрешённых
вопросов нет.

**Закрытые (были в брифе):**
1. Скоуп первого захода → всё сразу (Vitest + Playwright E2E + visual + agent-driven + ui-reviewer)
2. Агент-driven режим → оба (dev-server + live Electron), явное разделение
3. ui-reviewer → отдельный агент
4. Baseline-скриншоты → 5–10, в git, ручное обновление
5. Интеграция в SDD-цикл → implementer (быстро) + reviewer (полно); implementer сообщает `Change touches: renderer`

## Источники

- research/2026-07-29-electron-ui-testing.md — веб-исследование инструментов
- research/2026-07-29-electron-ui-testing-expert.md — экспертная консультация
- docs/LESSONS.md → LRN-20260729-001 — мотивация фичи
- docs/LESSONS.md → LRN-20260728-004 — grep по node_modules

## Приложение: лог Q&A

### Раунд 1

**Q1: Скоуп первого захода — минимальный срез или всё сразу?**
→ **Всё сразу** — все три слоя: Vitest + Playwright E2E + visual regression +
  Playwright MCP + ui-reviewer + AGENTS.md/docs

**Q2: Агент-driven режим — MCP к живому Electron или к dev-server?**
→ **Оба, с явным разделением** — быстрый (dev-server) для итеративной
  разработки, полный (live Electron через --cdp-endpoint) для финальной
  верификации

**Q3: ui-reviewer — отдельный агент или расширение reviewer'а?**
→ **Отдельный агент** — `.opencode/agents/ui-reviewer.md`, строгий UI-оценщик,
  deny: edit, только PASS/FAIL

**Q4: Сколько baseline-скриншотов?**
→ **5–10 ключевых экранов** — в git, только ручное обновление, запрет
  автообновления

### Раунд 2

**Q5: Когда UI-проверка обязательна?**
→ **Implementer определяет по диффу** — если change трогает renderer,
  implementer сообщает в отчёте, reviewer и оркестратор требуют UI-проверку.
  Не оркестратор анализирует дифф, а implementer в отчёте возвращает флаг.

**Q6: Кто и когда запускает UI-верификацию?**
→ **Implementer (быстро) + reviewer (полно)** — implementer прогоняет unit/E2E
  и быстрый UI-чек (dev-server + MCP) сам. Reviewer вызывает ui-reviewer для
  полной верификации (live Electron + скриншоты). FAIL от ui-reviewer блокирует
  approve.

**Q7: Судьба spike.ts / CDP-скрипта?**
→ **Удалить** — новый стек Playwright E2E + MCP покрывает все сценарии, не
  плодим зоопарк инструментов.

**Q8: Файловая структура тестов?**
→ **`tests/` в корне** — `tests/unit/` (Vitest), `tests/e2e/` (Playwright),
  `tests/visual/` (Playwright скриншоты). Все тесты в одном месте.

### Раунд 3

**Q9: FAIL от ui-reviewer — hard gate или soft gate?**
→ **Hard gate** — FAIL блокирует approve без исключений. Человек видит и
  решает. Максимальная защита от визуальных багов.

**Q10: Где живёт логика 3-итерационного лимита?**
→ **Конвенция в AGENTS.md** — implementer и ui-reviewer сами соблюдают лимит.
  После 3-го FAIL — эскалация к человеку.

**Q11: Как агент запускает Electron для полного режима?**
→ **npm-скрипт `pnpm test:agent:electron`** — запускает electron с
  `--remote-debugging-port`. AGENTS.md содержит инструкцию: «для полной
  проверки выполни pnpm test:agent:electron, затем подключи MCP».

**Q12: Playwright конфигурация — один файл или раздельные?**
→ **Один `playwright.config.ts` в корне, два проекта внутри** — `e2e` и
  `visual` с разными настройками. Единая точка входа, общий fixture.

### Раунд 4

**Q13: Тесты на build или dev electron-vite?**
→ **Два режима** — `pnpm test:e2e` (build + test, для reviewer'а),
  `pnpm test:e2e:quick` (dev + test, для implementer'а в итерациях).

**Q14: Как implementer сообщает, что change трогает renderer?**
→ **Строка в ответе implementer'а оркестратору:** `Change touches: renderer`
  (или `main`, `both`). Оркестратор парсит и требует UI-проверку при
  `renderer`/`both`.

**Q15: Vitest и конфликт tsconfig (node vs web)?**
→ **Vitest workspace** — `vitest.workspace.ts` с двумя проектами: один для
  main-логики (`tsconfig.node.json`), один для renderer (`tsconfig.web.json`).

**Q16: npm-скрипты?**
→ **6 скриптов + агрегирующий `test`:**
  - `test:unit` — `vitest run` (все workspace-проекты)
  - `test:e2e` — `playwright test --project=e2e` (после `pnpm build`)
  - `test:e2e:quick` — `playwright test --project=e2e` (на dev-сборке)
  - `test:visual` — `playwright test --project=visual`
  - `test:agent:electron` — запуск electron с `--remote-debugging-port`
  - `test:agent:dev` — информация для агента: dev-server + MPC
  - `test` — `pnpm test:unit && pnpm test:e2e && pnpm test:visual`

### Раунд 5 (финальный)

**Q17: MCP-сервер — в opencode.json или ручной запуск?**
→ **Конфиг в opencode.json** — `mcp.servers.playwright`, MCP всегда доступен
  ui-reviewer и другим агентам.

**Q18: Кто вызывает ui-reviewer — reviewer или оркестратор?**
→ **Оркестратор — диспетчер** — reviewer сообщает оркестратору «нужна
  UI-проверка», оркестратор вызывает ui-reviewer. Reviewer не меняется.

**Q19: Финальная проверка + ужесточение идеатора?**
→ **Vision полный, финализировать.** Дополнительно: в scope фичи добавлено
  ужесточение протокола идеатора — обязательное покрытие всех измерений карты
  в vision.md, оркестратор проверяет наличие всех секций.
