# Tasks: ui-verification-infra

## 1. DevDependencies и npm-скрипты

- [x] 1.1 Установить devDependencies: `pnpm add -D @playwright/test vitest @testing-library/react @testing-library/jest-dom`
- [x] 1.2 Установить `@playwright/mcp`: `pnpm add -D @playwright/mcp` (агент-driven верификация, MCP-сервер)
- [x] 1.3 Установить Playwright-браузеры: `npx playwright install chromium` (Electron использует тот же Chromium, нужен для toHaveScreenshot)
- [x] 1.4 Добавить в `package.json` скрипты: `test`, `test:unit`, `test:e2e`, `test:e2e:quick`, `test:visual`, `test:agent:electron`, `test:agent:dev`
- [x] 1.5 Проверить, что `pnpm test` (вызов агрегирующего скрипта) не падает на отсутствующих тестах (деградация до «no tests found»)

## 2. Vitest workspace и конфигурация

- [x] 2.1 Создать `vitest.workspace.ts` в корне: два проекта — node (`tsconfig.node.json`, environment `'node'`) и web (`tsconfig.web.json`, environment `'jsdom'`)
- [x] 2.2 Убедиться, что web-проект корректно резолвит алиас `@renderer` через `resolve.alias`
- [x] 2.3 Настроить `include` паттерны: `tests/unit/**/*.test.ts` для node-проекта, `tests/unit/**/*.test.tsx` для web-проекта

## 3. Playwright конфигурация и fixture

- [x] 3.1 Создать `playwright.config.ts` в корне: `testDir: './tests'`, два проекта — `e2e` (testDir `./tests/e2e`) и `visual` (testDir `./tests/visual`)
- [x] 3.2 Создать `tests/e2e/fixtures/electron.fixture.ts` — общий fixture:
  - `electronApp`: `_electron.launch()` с `args: ['./out/main/index.mjs']` (для build-режима) и `env: { NODE_ENV: 'test' }`; close в teardown
  - `appWindow`: `electronApp.firstWindow()`, `waitForLoadState('domcontentloaded')`, `document.fonts.ready`, отключение анимаций/transition, `setViewportSize(1280, 800)`
- [x] 3.3 В fixture предусмотреть флаг `--e2e`, передаваемый в `args`, чтобы приложение могло пропустить начальные диалоги в тестовом режиме (если нужно)
- [x] 3.4 Убедиться, что `_electron.launch()` находит electron через pnpm-симлинки (`node_modules/.bin/electron`) без явного `executablePath`

## 4. Playwright E2E smoke-тесты (5–10 сценариев)

- [x] 4.1 Smoke: приложение запускается и показывает главное окно — `toHaveTitle`, видимость `data-testid="main-layout"`
- [x] 4.2 Smoke: создание нового проекта — замокать `dialog.showOpenDialog`, клик «Новый проект», проверка появления проекта в UI
- [x] 4.3 Smoke: открытие существующего проекта — замокать `dialog.showOpenDialog`, клик «Открыть проект», проверка перехода
- [x] 4.4 Smoke: навигация по чатам — открыть проект с чатами, проверить список чатов, переключиться между чатами
- [x] 4.5 Smoke: отправка сообщения и получение ответа — ввести текст, отправить, дождаться появления ответа в ленте (или карточки ошибки — оба исхода валидны)
- [x] 4.6 Smoke: экран настроек — открыть Settings, проверить наличие полей API-ключей и модели
- [x] 4.7 Smoke: восстановление после перезапуска — создать проект, перезапустить приложение, проверить что проект в списке недавних
- [x] 4.8 Убедиться, что `pnpm test:e2e` (с предварительным `pnpm build`) проходит все smoke-тесты
- [x] 4.9 Убедиться, что `pnpm test:e2e:quick` (на dev-сборке `electron-vite dev`) проходит все smoke-тесты

## 5. Visual regression (5–10 экранов)

- [x] 5.1 Скриншот главного окна приложения (пустой проект / dashboard)
- [x] 5.2 Скриншот чата с историей сообщений (создать тестовый проект с предзаполненной сессией)
- [x] 5.3 Скриншот экрана настроек (Settings)
- [x] 5.4 Скриншот модального окна (например, создание проекта)
- [x] 5.5 Скриншот состояния загрузки (loading spinner / skeleton)
- [x] 5.6 Скриншот состояния ошибки (карточка ошибки в чате)
- [x] 5.7 Скриншот пустого состояния (нет чатов / нет проектов)
- [x] 5.8 Для каждого скриншотного теста: замаскировать динамические регионы (дата/время, аватары), использовать `maxDiffPixelRatio: 0.001`, `animations: 'disabled'`, `caret: 'hide'`
- [x] 5.9 Создать baseline: `pnpm exec playwright test --project=visual --update-snapshots`, закоммитить скриншоты в `tests/visual/__screenshots__/`
- [x] 5.10 Убедиться, что `pnpm test:visual` проходит без отличий от baseline

## 6. Vitest unit-тесты

- [x] 6.1 Тест IPC-типов: `src/shared/ipc.ts` — типы компилируются, контракты каналов валидны (хотя бы structural test)
- [x] 6.2 Тест JSON-хранилища: `src/main/json-file.ts` — атомарное чтение/запись, tmp+rename, отсутствующий файл → дефолт
- [x] 6.3 Тест RecentProjects: `src/main/recent-projects.ts` — добавление, сортировка, удаление, персистентность
- [x] 6.4 Тест SettingsStore: `src/main/settings-store.ts` — чтение/запись настроек, дефолты, миграция
- [x] 6.5 Тест IPC-обёртки: `src/preload/index.ts` — при моканом `ipcRenderer` вызовы `window.api.*` пробрасывают правильные каналы
- [x] 6.6 Тест React-компонента: хотя бы один компонент с `@testing-library/react` (рендерится, реагирует на клик)
- [x] 6.7 Убедиться, что `pnpm test:unit` проходит все Vitest-тесты

## 7. Playwright MCP и агент-driven верификация

- [x] 7.1 Добавить в `opencode.json` секцию `mcp.servers.playwright` (type: local, command: npx -y @playwright/mcp@latest)
- [x] 7.2 Создать npm-скрипт `test:agent:electron` — запуск `electron` с `--remote-debugging-port=9222` и путём к `./out/main/index.mjs` (требует предварительной сборки; при отсутствии — понятная ошибка)
- [x] 7.3 Создать npm-скрипт `test:agent:dev` — выводит инструкцию для агента: запустить `pnpm dev:renderer`, затем через MCP `browser_navigate http://localhost:5173`
- [x] 7.4 Проверить, что MCP-сервер запускается и инструменты доступны: выполнить ручной прогон `browser_snapshot` на dev-server
- [x] 7.5 Проверить полный CDP-режим: `pnpm test:agent:electron` + подключение MCP с `--cdp-endpoint` — агент получает accessibility-дерево живого Electron

## 8. ui-reviewer субагент

- [x] 8.1 Создать `.opencode/agents/ui-reviewer.md` с frontmatter: `description: Reviews UI through Playwright without editing code`, `mode: subagent`, `permission.edit: deny`, `permission.bash: allow`
- [x] 8.2 Тело агента: инструкция открыть приложение через Playwright (полный режим для финальной верификации), выполнить указанный пользовательский сценарий, проверить состояния (normal/empty/loading/error), захватить скриншоты, оценить по критериям `docs/ui-review.md`, вернуть PASS/FAIL с evidence
- [x] 8.3 В теле агента явно запретить: редактирование кода, обновление baseline (`--update-snapshots`), предположение что фича работает потому что страница загрузилась

## 9. Документация

- [x] 9.1 Создать `docs/ui-review.md` — критерии FAIL:
  - text is clipped or overlaps another element
  - important control is outside visible area
  - unexpected horizontal scrolling
  - modal content cannot be reached
  - loading, empty or error states are missing
  - primary action is visually unclear
  - spacing or alignment visibly breaks existing design system
  - keyboard focus is hidden
  - interaction produces a different state from specification
  - для каждого нарушения: severity (critical/major/minor), affected screen, visible evidence, expected behavior, suggested correction
- [x] 9.2 Добавить в `AGENTS.md` секцию «UI verification»:
  - После изменения renderer UI:
    1. Implementer: `pnpm test:unit && pnpm test:e2e:quick`, затем `pnpm test:agent:dev` + MCP для быстрой визуальной проверки
    2. Reviewer: запросить ui-reviewer (через оркестратора) для полной верификации
    3. Проверять затронутый user flow, не только начальную страницу
    4. Проверять UI при 1280x800 и 1600x900 (когда релевантно)
    5. Проверять normal, empty, loading и error-состояния
    6. Захватывать скриншоты каждого затронутого состояния
    7. Сверять скриншоты с `docs/ui-review.md`
    8. Не объявлять задачу завершённой при наличии high-severity UI-проблем
    9. Никогда не обновлять visual baseline только ради прохождения теста
    10. FAIL ui-reviewer = hard gate для approve
    11. Generator/evaluator цикл: максимум 3 итерации; после 3-го FAIL — эскалация к человеку
- [x] 9.3 Добавить в `AGENTS.md` ужесточение протокола идеатора:
  - vision.md обязан покрывать все измерения карты: Цель и границы, Техническая реализация, UI/UX, Риски и опасения, Компромиссы, Крайние случаи и failure modes, Критерии приёмки, Открытые вопросы
  - Оркестратор проверяет наличие всех секций перед передачей spec-writer'у; при неполной карте — возврат идеатору
- [x] 9.4 Добавить в `AGENTS.md` контракт implementer'а: в ответе оркестратору implementer обязан указать `Change touches: renderer` (или `main`, `both`) по результатам анализа своего диффа

## 10. Интеграция в SDD-цикл (процесс, не код)

- [x] 10.1 В инструкции implementer'а (`.opencode/agents/implementer.md`) добавить: после реализации проанализировать дифф и включить в ответ строку `Change touches: renderer` / `main` / `both`; выполнить `pnpm test:unit && pnpm test:e2e:quick`; при `renderer`/`both` — быстрый UI-чек (dev-server + MCP)
- [x] 10.2 В инструкции reviewer'а (`.opencode/agents/reviewer.md`) добавить: при `Change touches: renderer` или `both` от implementer'а — сообщить оркестратору о необходимости UI-проверки (вызов ui-reviewer)
- [x] 10.3 В инструкции оркестратора (`.opencode/agents/orchestrator.md`) добавить: при `Change touches: renderer`/`both` от implementer'а — после кодового ревью вызвать ui-reviewer для полной верификации; FAIL от ui-reviewer — блокировать approve; после 3-го FAIL — эскалация к человеку

## 11. Очистка

- [x] 11.1 Удалить `src/main/spike.ts` (4 экспортируемые функции, ~450 строк)
- [x] 11.2 Удалить из `src/main/index.ts`: импорты `runSpike`, `runThinkingSpike`, `runChatManagerSpike`, `runFeedDumpSpike`; условное ветвление по `SPIKE_HEADLESS` (строки `isSpike`, `no-sandbox`/`disable-gpu`/`ozone-platform=headless`, вызовы спайк-функций)
- [x] 11.3 Удалить из `src/main/index.ts` env-переменные и флаги, специфичные для SPIKE_HEADLESS: `--no-sandbox`, `--disable-gpu`, `--ozone-platform=headless` при `isSpike`

## 12. Проверка

- [x] 12.1 `pnpm typecheck` проходит (node + web конфиги)
- [x] 12.2 `pnpm lint` проходит (ESLint flat config)
- [x] 12.3 `pnpm build` собирается без ошибок
- [x] 12.4 Smoke: `pnpm build && pnpm start` — собранное приложение запускается, главное окно отображается
- [x] 12.5 `pnpm test:unit` проходит (все Vitest unit-тесты зелёные)
- [x] 12.6 `pnpm test:e2e` проходит (все Playwright E2E smoke-тесты на production-сборке)
- [x] 12.7 `pnpm test:e2e:quick` проходит (все Playwright E2E smoke-тесты на dev-сборке)
- [x] 12.8 `pnpm test:visual` проходит (все visual regression тесты без отличий от baseline)
- [x] 12.9 `pnpm test` проходит (агрегирующая команда: unit + e2e + visual)
- [x] 12.10 LRN-20260729-001 smoke: ручной прогон полного цикла UI-верификации — `pnpm test:agent:electron`, подключение MCP с `--cdp-endpoint`, `browser_snapshot`, `browser_screenshot` — агент получает accessibility-дерево и скриншот живого приложения (доказательство: скриншот / лог инструментов)
- [ ] 12.11 Проверка ui-reviewer hard gate: симулировать ui-reviewer с FAIL — оркестратор должен заблокировать approve
- [x] 12.12 Проверка сценариев дельты ui-verification: все 18 требований покрыты работающими тестами и процессами
