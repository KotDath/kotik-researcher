# Delta: ui-verification

## Purpose

Инфраструктура тестирования и верификации UI приложения: трёхслойная (Vitest unit + Playwright E2E + visual regression), агент-driven верификация через Playwright MCP в двух режимах, ui-reviewer субагент для SDD-цикла, документация критериев проверки UI. Capability гарантирует, что каждый change, затрагивающий renderer, проходит обязательную проверку живого UI перед approve.

## ADDED Requirements

### Requirement: Трёхслойная тестовая инфраструктура

Система ДОЛЖНА предоставлять три слоя тестирования UI: Vitest-юниты (бизнес-логика, сторы, IPC-обёртки, хуки, React-компоненты), Playwright E2E smoke-тесты (реальное Electron-приложение через `_electron.launch()`) и визуальные регрессии (скриншотные тесты ключевых экранов через `toHaveScreenshot()`). Тесты ДОЛЖНЫ находиться в директории `tests/` в корне проекта: `tests/unit/`, `tests/e2e/`, `tests/visual/`.

#### Scenario: Все три слоя тестов доступны

- **WHEN** разработчик или агент выполняет `pnpm test:unit`
- **THEN** прогоняются Vitest unit-тесты из `tests/unit/`
- **AND** при выполнении `pnpm test:e2e` прогоняются Playwright E2E smoke-тесты из `tests/e2e/`
- **AND** при выполнении `pnpm test:visual` прогоняются визуальные регрессии из `tests/visual/`

#### Scenario: Агрегирующая команда test

- **WHEN** выполняется `pnpm test`
- **THEN** последовательно прогоняются `pnpm test:unit`, `pnpm test:e2e`, `pnpm test:visual`
- **AND** команда возвращает ненулевой код, если любой из слоёв упал

### Requirement: Vitest workspace с разделением node и web

Vitest ДОЛЖЕН использовать workspace (`vitest.workspace.ts`) с двумя проектами: один для main-логики (использует `tsconfig.node.json`, environment `node`), второй для renderer (использует `tsconfig.web.json`, environment `jsdom`). Команда `pnpm test:unit` ДОЛЖНА прогонять оба проекта.

#### Scenario: Main-логика тестируется в node-окружении

- **WHEN** в `tests/unit/` есть тест, импортирующий модуль из `src/main/` или `src/shared/`
- **THEN** тест выполняется в окружении `node`
- **AND** ему доступны Node.js API (fs, path) и импорты с `node:`-префиксом

#### Scenario: Renderer-компоненты тестируются в jsdom

- **WHEN** в `tests/unit/` есть тест React-компонента с `@testing-library/react`
- **THEN** тест выполняется в окружении `jsdom`
- **AND** ему доступен DOM API (document, window) и алиас `@renderer`

### Requirement: Playwright конфигурация с двумя проектами

Система ДОЛЖНА иметь один `playwright.config.ts` в корне проекта с двумя проектами: `e2e` (запуск Electron, пользовательские сценарии) и `visual` (скриншотные тесты с `toHaveScreenshot`). Оба проекта ДОЛЖНЫ использовать общий fixture для запуска Electron через `_electron.launch()` и стабилизации рендера (фиксированный размер окна, отключение анимаций, ожидание `document.fonts.ready`).

#### Scenario: E2E-проект запускает Electron

- **WHEN** выполняется `pnpm test:e2e`
- **THEN** Playwright запускает тесты только из `tests/e2e/`
- **AND** Electron-приложение запускается через `_electron.launch()` с путём к скомпилированному main-скрипту
- **AND** после тестов приложение корректно закрывается

#### Scenario: Visual-проект сравнивает скриншоты

- **WHEN** выполняется `pnpm test:visual`
- **THEN** Playwright запускает тесты только из `tests/visual/`
- **AND** `toHaveScreenshot()` сравнивает текущий рендер с baseline из `tests/visual/__screenshots__/`

### Requirement: Playwright E2E smoke-тесты

Система ДОЛЖНА содержать 5–10 Playwright E2E smoke-тестов, покрывающих ключевые пользовательские сценарии реального Electron-приложения: запуск и отображение главного окна, создание проекта, открытие существующего проекта, навигация по чатам, отправка сообщения с получением ответа, работа экрана настроек, восстановление состояния после перезапуска.

#### Scenario: Smoke-тест запуска приложения

- **WHEN** выполняется smoke-тест запуска приложения
- **THEN** Electron-приложение запускается через `_electron.launch()`
- **AND** главное окно содержит ожидаемый заголовок (title)
- **AND** ключевой элемент разметки (layout) видим

#### Scenario: Smoke-тест отправки сообщения в чат

- **WHEN** выполняется smoke-тест чата
- **THEN** приложение запущено, проект открыт
- **AND** ввод сообщения и отправка выполняются через Playwright-селекторы
- **AND** ответ агента появляется в ленте чата (стриминг или ошибка — оба исхода валидны для smoke)

#### Scenario: Два режима запуска E2E

- **WHEN** выполняется `pnpm test:e2e`
- **THEN** перед тестами выполняется `pnpm build`
- **AND** тесты запускаются на свежей production-сборке
- **WHEN** выполняется `pnpm test:e2e:quick`
- **THEN** тесты запускаются на текущей dev-сборке electron-vite без пересборки

### Requirement: Визуальные регрессии с ручным baseline

Система ДОЛЖНА содержать 5–10 визуальных регрессионных тестов ключевых экранов через `toHaveScreenshot()`. Baseline-скриншоты ДОЛЖНЫ храниться в git в `tests/visual/__screenshots__/`. Обновление baseline ДОЛЖНО выполняться ТОЛЬКО вручную через `--update-snapshots` и НИКОГДА автоматически агентом или в CI.

#### Scenario: Скриншот совпадает с baseline

- **GIVEN** baseline-скриншот главного окна закоммичен в git
- **WHEN** выполняется `pnpm test:visual` без изменений UI
- **THEN** тест `toHaveScreenshot('main-window.png')` проходит

#### Scenario: Скриншот расходится с baseline

- **GIVEN** baseline-скриншот закоммичен, а UI был изменён
- **WHEN** выполняется `pnpm test:visual`
- **THEN** тест `toHaveScreenshot()` падает
- **AND** Playwright сохраняет expected/actual/diff скриншоты для анализа

#### Scenario: Создание нового baseline

- **GIVEN** baseline-скриншот отсутствует (новый тест)
- **WHEN** выполняется `pnpm exec playwright test --project=visual --update-snapshots`
- **THEN** создаётся новый baseline-скриншот
- **AND** разработчик вручную коммитит его в git

### Requirement: Стратегия test-id для стабильных селекторов

Система ДОЛЖНА использовать атрибуты `data-testid` в React-разметке для Playwright-селекторов (`page.getByTestId()`). Селекторы НЕ ДОЛЖНЫ опираться на CSS-классы, структуру DOM или текстовое содержимое, склонное к изменениям.

#### Scenario: Playwright-тест использует test-id

- **WHEN** E2E или visual тест ищет элемент
- **THEN** селектор использует `page.getByTestId('element-id')`
- **AND** соответствующий `data-testid="element-id"` присутствует в React-разметке

### Requirement: Моки нативных диалогов

Playwright E2E-тесты ДОЛЖНЫ мокать нативные Electron-диалоги (`dialog.showOpenDialog`, `dialog.showMessageBox` и аналоги) через `electronApp.evaluate()`, поскольку Playwright не перехватывает системные диалоги ОС.

#### Scenario: Мок диалога выбора директории

- **WHEN** E2E-тест выполняет сценарий, вызывающий `dialog.showOpenDialog`
- **THEN** диалог замокан через `electronApp.evaluate()` и возвращает предопределённый путь
- **AND** сценарий теста выполняется детерминированно без системного диалога

### Requirement: Агент-driven верификация — быстрый режим

Система ДОЛЖНА поддерживать быстрый режим агентской UI-верификации: `pnpm dev:renderer` запускает renderer на localhost, агент через Playwright MCP подключается к странице и проверяет UI. Режим предназначен для итеративной самопроверки implementer'а и НЕ проверяет main-процесс или IPC-интеграцию.

#### Scenario: Агент проверяет renderer через dev-server

- **GIVEN** агент (implementer) имеет доступ к Playwright MCP
- **WHEN** агент выполняет `pnpm dev:renderer`
- **AND** через MCP переходит на `http://localhost:5173`
- **THEN** агент может выполнять `browser_snapshot`, `browser_click`, `browser_screenshot` на renderer
- **AND** взаимодействия ограничены renderer-процессом

### Requirement: Агент-driven верификация — полный режим

Система ДОЛЖНА поддерживать полный режим агентской UI-верификации: `pnpm test:agent:electron` запускает собранное Electron-приложение с `--remote-debugging-port=9222`, агент через Playwright MCP с `--cdp-endpoint http://127.0.0.1:9222` подключается к живому приложению и проверяет UI с реальной main-renderer интеграцией. Режим предназначен для финальной верификации ui-reviewer'ом.

#### Scenario: Агент проверяет живой Electron через CDP

- **GIVEN** ui-reviewer имеет доступ к Playwright MCP
- **WHEN** ui-reviewer выполняет `pnpm test:agent:electron`
- **AND** подключает MCP через `--cdp-endpoint http://127.0.0.1:9222`
- **THEN** ui-reviewer может проверять UI живого Electron-приложения
- **AND** проверка покрывает реальную интеграцию main-renderer, включая IPC

#### Scenario: CDP-порт занят

- **GIVEN** порт 9222 уже занят другим процессом
- **WHEN** выполняется `pnpm test:agent:electron`
- **THEN** команда завершается с ошибкой и понятным сообщением о занятом порте

### Requirement: Playwright MCP в opencode.json

Система ДОЛЖНА иметь Playwright MCP-сервер зарегистрированным в `opencode.json` в секции `mcp.playwright` как локальный сервер (`type: "local"`, команда `npx -y @playwright/mcp@latest`). MCP-сервер ДОЛЖЕН быть доступен всем агентам (ui-reviewer, implementer, reviewer) без ручного запуска.

#### Scenario: MCP доступен агенту

- **WHEN** агент, имеющий доступ к MCP-инструментам, начинает проверку UI
- **THEN** инструменты `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_evaluate` доступны
- **AND** агент не выполняет ручную установку или запуск MCP-сервера

### Requirement: ui-reviewer субагент

Система ДОЛЖНА иметь агента `ui-reviewer` (`.opencode/agents/ui-reviewer.md`) — субагент, специализирующийся на UI-верификации. Агент ДОЛЖЕН иметь `permission.edit: deny` (не может менять код), `permission.bash: allow` (запуск dev-сервера, Electron, проверок). Агент ДОЛЖЕН возвращать PASS или FAIL с evidence (скриншоты, логи, accessibility-дерево, описание нарушений) и руководствоваться критериями из `docs/ui-review.md`.

#### Scenario: ui-reviewer возвращает PASS

- **GIVEN** ui-reviewer проверил UI и не нашёл нарушений
- **WHEN** агент завершает проверку
- **THEN** возвращается вердикт PASS с evidence (скриншоты состояний)
- **AND** файлы приложения не изменены (permission.edit: deny)

#### Scenario: ui-reviewer возвращает FAIL

- **GIVEN** ui-reviewer обнаружил нарушение (обрезанный текст, наложение элементов)
- **WHEN** агент завершает проверку
- **THEN** возвращается вердикт FAIL с описанием нарушения (severity, affected screen, evidence, expected behavior)
- **AND** файлы приложения не изменены

### Requirement: FAIL от ui-reviewer — hard gate

Вердикт FAIL от ui-reviewer ДОЛЖЕН блокировать approve change без исключений: оркестратор НЕ ДОЛЖЕН переводить change в `Status: approved` или `Status: done`, пока ui-reviewer не вернёт PASS.

#### Scenario: FAIL блокирует approve

- **GIVEN** change находится на стадии реализации, implementer завершил код
- **WHEN** reviewer запрашивает UI-проверку и ui-reviewer возвращает FAIL
- **THEN** оркестратор отклоняет approve
- **AND** change возвращается implementer'у на доработку

### Requirement: Цикл generator/evaluator с лимитом итераций

Цикл «implementer вносит изменения → ui-reviewer проверяет» ДОЛЖЕН быть ограничен тремя итерациями. После третьего FAIL от ui-reviewer система ДОЛЖНА эскалировать проблему к человеку (оркестратор сообщает пользователю о серийных FAIL с контекстом всех трёх итераций).

#### Scenario: Эскалация после трёх FAIL

- **GIVEN** implementer получил FAIL от ui-reviewer три раза подряд
- **WHEN** implementer завершает третью попытку исправления
- **THEN** оркестратор НЕ запускает четвёртую итерацию
- **AND** оркестратор сообщает пользователю о проблеме с контекстом всех трёх проверок

### Requirement: Контракт implementer'а о затрагиваемых слоях

Implementer ПОСЛЕ завершения реализации ДОЛЖЕН сообщать оркестратору строку `Change touches: renderer` (или `main`, `both`) на основе анализа своего диффа. Оркестратор ДОЛЖЕН использовать эту строку для определения необходимости UI-верификации: при `renderer` или `both` — требовать UI-проверку от reviewer'а / ui-reviewer'а.

#### Scenario: Implementer сообщает renderer

- **GIVEN** implementer изменил код в `src/renderer/`
- **WHEN** implementer завершает реализацию и отправляет отчёт оркестратору
- **THEN** отчёт содержит строку `Change touches: renderer`
- **AND** оркестратор фиксирует необходимость UI-верификации

#### Scenario: Implementer сообщает main

- **GIVEN** implementer изменил код только в `src/main/`
- **WHEN** implementer завершает реализацию
- **THEN** отчёт содержит строку `Change touches: main`
- **AND** оркестратор НЕ требует UI-верификацию

### Requirement: Запрет автообновления visual baseline

Система ДОЛЖНА явно запрещать автоматическое обновление baseline-скриншотов агентом или тестовым раннером. Обновление baseline ДОЛЖНО выполняться только разработчиком вручную через `--update-snapshots`. Запрет ДОЛЖЕН быть зафиксирован в AGENTS.md и в документации `docs/ui-review.md`.

#### Scenario: Агент не обновляет baseline

- **GIVEN** агент (implementer или ui-reviewer) обнаружил расхождение скриншотов
- **WHEN** агент пытается «починить» тест
- **THEN** агент НЕ выполняет `--update-snapshots`
- **AND** агент сообщает о расхождении человеку для ручного решения

### Requirement: Критерии UI-проверки

Система ДОЛЖНА содержать документ `docs/ui-review.md` с критериями FAIL для UI-проверки: обрезка или наложение текста (clipping/overlap), выход важных элементов за видимую область, неожиданный горизонтальный скролл, недоступность содержимого модальных окон, отсутствие состояний loading/empty/error, визуальная неясность primary action, нарушение spacing/alignment существующей дизайн-системы, скрытый keyboard focus, несоответствие визуального состояния спецификации.

#### Scenario: ui-reviewer сверяется с критериями

- **WHEN** ui-reviewer оценивает UI
- **THEN** каждый вердикт FAIL сопровождается ссылкой на конкретный критерий из `docs/ui-review.md`
- **AND** evidence (скриншот) демонстрирует нарушение критерия

### Requirement: Документация UI-верификации в AGENTS.md

Система ДОЛЖНА содержать в `AGENTS.md` секцию «UI verification» с пошаговыми инструкциями для агентов: быстрый режим (dev-server + MCP) для implementer'а, полный режим (live Electron + CDP + MCP) для ui-reviewer'а, запрет автообновления baseline, лимит 3 итераций generator/evaluator, требование проверять normal/empty/loading/error-состояния, несколько размеров окна (1280x800, 1600x900).

#### Scenario: Агент следует инструкциям из AGENTS.md

- **WHEN** любой агент (implementer, reviewer, ui-reviewer) выполняет UI-верификацию
- **THEN** агент находит секцию «UI verification» в AGENTS.md
- **AND** следует пошаговым инструкциям для своего режима

### Requirement: Ужесточение протокола идеатора

Протокол идеатора в AGENTS.md ДОЛЖЕН требовать обязательного покрытия всех измерений карты в vision.md: Цель и границы, Техническая реализация, UI/UX, Риски и опасения, Компромиссы, Крайние случаи и failure modes, Критерии приёмки, Открытые вопросы. Оркестратор ДОЛЖЕН проверять наличие всех секций перед передачей vision.md spec-writer'у. При неполной карте оркестратор ДОЛЖЕН возвращать vision.md идеатору на доработку.

#### Scenario: Оркестратор проверяет полноту vision.md

- **GIVEN** идеатор создал vision.md
- **WHEN** оркестратор получает vision.md для передачи spec-writer'у
- **THEN** оркестратор проверяет наличие всех обязательных секций
- **AND** при отсутствии любой секции возвращает vision.md идеатору с указанием пропущенного измерения

#### Scenario: Полная карта измерений принимается

- **GIVEN** vision.md содержит все обязательные секции
- **WHEN** оркестратор проверяет vision.md
- **THEN** оркестратор передаёт vision.md spec-writer'у без замечаний

### Requirement: Удаление ad-hoc CDP-инфраструктуры

Система НЕ ДОЛЖНА содержать файл `src/main/spike.ts` и связанные с ним ветвления по `SPIKE_HEADLESS` в `src/main/index.ts`. Все спайк-функции (`runSpike`, `runThinkingSpike`, `runChatManagerSpike`, `runFeedDumpSpike`) ДОЛЖНЫ быть удалены. Их сценарии ДОЛЖНЫ покрываться новым стеком: Playwright E2E smoke-тесты + Vitest unit-тесты + агент-driven верификация.

#### Scenario: spike.ts удалён, приложение запускается

- **WHEN** приложение запускается в обычном режиме (`pnpm dev` или `pnpm start`)
- **THEN** main-процесс не содержит импортов из `spike.ts`
- **AND** переменная `SPIKE_HEADLESS` не проверяется
- **AND** приложение запускается и работает как раньше

#### Scenario: Сценарии бывших спайков покрыты

- **WHEN** выполняется `pnpm test:e2e`
- **THEN** сценарий «приложение запускается и получает ответ от LLM» покрыт E2E smoke-тестом
- **AND** `pnpm test:unit` покрывает unit-тестами логику, проверявшуюся `runChatManagerSpike`
