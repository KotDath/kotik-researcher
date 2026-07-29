# Delta: ui-verification

## Purpose

Инфраструктура тестирования и верификации UI приложения: Vitest unit, Playwright E2E, visual regression и agent-driven проверка через единый CDP-транспорт. Deterministic-команды выполняются непосредственно по tasks.md; независимые app-tester и ui-reviewer проверяют поведение и визуальный результат живого приложения.

## ADDED Requirements

### Requirement: Разделение deterministic и agent-driven проверок

Система НЕ ДОЛЖНА создавать LLM-субагента только для запуска фиксированных
pnpm-команд. Implementer ДОЛЖЕН выполнить deterministic checks из tasks.md.
Reviewer ДОЛЖЕН независимо проверить code/spec, app-tester — поведение
изменённого live flow, а ui-reviewer при renderer/both — визуальный
результат.

#### Scenario: Полный gate renderer-change

- **GIVEN** implementer завершил change, затрагивающий renderer
- **WHEN** deterministic checks зелёные, reviewer вернул APPROVE,
  app-tester вернул PASS и ui-reviewer вернул PASS
- **THEN** оркестратор может предложить пользователю принять change

#### Scenario: Agent tester находит дефект поведения

- **GIVEN** deterministic tests зелёные
- **WHEN** app-tester воспроизводит сломанный пользовательский flow
- **THEN** approve блокируется evidence от app-tester
- **AND** change возвращается implementer'у

### Requirement: Невидимые окна при тестовых и агентских прогонах

При запуске с флагом `--e2e` (все тестовые и агентские прогоны) main ДОЛЖЕН создавать BrowserWindow с `show: false` (окно не отображается) и `backgroundThrottling: false` (renderer продолжает отрисовку). Система НЕ ДОЛЖНА перехватывать фокус пользователя или показывать окна приложения во время тестовых и агентских прогонов. Скриншоты ДОЛЖНЫ работать: CDP `Page.captureScreenshot` получает изображение из композитора renderer'а независимо от видимости окна.

#### Scenario: E2E-тест не показывает окно

- **GIVEN** приложение запущено с флагом `--e2e` через `_electron.launch()`
- **WHEN** выполняется E2E-тест
- **THEN** BrowserWindow создан с `show: false`
- **AND** окно приложения не появляется на экране
- **AND** пользователь не теряет фокус

#### Scenario: Скриншот скрытого окна корректен

- **GIVEN** окно приложения скрыто (`show: false`)
- **WHEN** Playwright выполняет `page.screenshot()` или `toHaveScreenshot()`
- **THEN** скриншот содержит корректное изображение интерфейса (не пустой/чёрный)
- **AND** визуальные регрессии проходят на скрытом окне

### Requirement: Закреплённые модели агентов верификации

Система ДОЛЖНА закреплять модели непосредственно во frontmatter каждого
субагента: implementer и app-tester — `opencode-go/deepseek-v4-flash`,
reviewer — `openai/gpt-5.6-sol` с `variant: medium`, ui-reviewer —
`kimi-for-coding/k3`.

#### Scenario: Субагент не наследует модель оркестратора

- **WHEN** OpenCode загружает implementer, app-tester или reviewer
- **THEN** frontmatter содержит явный `model`
- **AND** субагент не наследует K3 оркестратора

#### Scenario: ui-reviewer использует k3 с vision

- **WHEN** оркестратор вызывает ui-reviewer
- **THEN** ui-reviewer запускается с моделью `kimi-for-coding/k3`
- **AND** агент способен оценивать скриншоты визуально

### Requirement: Reviewer — evidence-backed code/spec review

Reviewer ДОЛЖЕН проверять покрытие требований, корректность, ошибки и edge
cases и возвращать evidence-backed findings. Он МОЖЕТ запустить узкий
reproducer при недостатке доказательств, но НЕ ДОЛЖЕН механически
дублировать весь deterministic suite.

#### Scenario: Major finding содержит evidence

- **WHEN** reviewer возвращает blocker или major
- **THEN** finding содержит файл:строку, нарушенное требование и reproducer
- **AND** implementer отвечает ACCEPT, DISPUTE или PRE_EXISTING

## MODIFIED Requirements

### Requirement: Агент-driven верификация — быстрый режим

Система ДОЛЖНА поддерживать быстрый режим агентской UI-верификации: `pnpm test:agent:dev` запускает electron-vite dev с `--remote-debugging-port=9222` (main из исходников с HMR, renderer из vite dev-server). Агент через Playwright MCP (единственный сервер `playwright` с `--cdp-endpoint http://127.0.0.1:9222`) подключается к Electron-приложению и проверяет UI. Режим предназначен для итеративной разработки и быстрой самопроверки UI. Режим ДОЛЖЕН использовать полноценное Electron-приложение (main + preload + renderer), НЕ голый браузер против dev-server.

#### Scenario: Агент проверяет electron-vite dev через CDP

- **GIVEN** агент имеет доступ к Playwright MCP (сервер `playwright`)
- **WHEN** агент выполняет `pnpm test:agent:dev`
- **AND** MCP уже подключён к `--cdp-endpoint http://127.0.0.1:9222`
- **THEN** агент может выполнять `browser_snapshot`, `browser_click`, `browser_take_screenshot` на живом Electron-приложении
- **AND** взаимодействия проходят через реальный main-renderer IPC

### Requirement: Агент-driven верификация — полный режим

Система ДОЛЖНА поддерживать полный режим агентской UI-верификации: `pnpm test:agent:electron` запускает собранное Electron-приложение (`out/main/index.mjs`) с `--remote-debugging-port=9222` и изолированным userData (сид-данные: recent-projects, проект, чат с историей). Агент через Playwright MCP (единственный сервер `playwright` с `--cdp-endpoint http://127.0.0.1:9222`) подключается к живому приложению и проверяет UI с реальной main-renderer интеграцией. Режим предназначен для финальной верификации ui-reviewer'ом.

#### Scenario: ui-reviewer проверяет prod-сборку через CDP

- **GIVEN** ui-reviewer имеет доступ к Playwright MCP (сервер `playwright`)
- **WHEN** ui-reviewer выполняет `pnpm test:agent:electron`
- **AND** MCP подключён через `--cdp-endpoint http://127.0.0.1:9222`
- **THEN** ui-reviewer может проверять UI production-сборки Electron-приложения
- **AND** проверка покрывает реальную интеграцию main-renderer, включая IPC

#### Scenario: Изолированный userData защищает реальные данные

- **GIVEN** на машине есть реальные проекты и API-ключи в production userData
- **WHEN** выполняется `pnpm test:agent:electron`
- **THEN** Electron использует изолированный userData-каталог с сид-данными
- **AND** реальные проекты и ключи НЕ видны агенту и НЕ попадают в скриншоты

#### Scenario: CDP-порт занят

- **GIVEN** порт 9222 уже занят другим процессом
- **WHEN** выполняется `pnpm test:agent:electron`
- **THEN** команда завершается с ошибкой и понятным сообщением о занятом порте

### Requirement: Playwright MCP в opencode.json

Система ДОЛЖНА иметь ОДИН Playwright MCP-сервер `playwright` в `opencode.json` с командой `npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222`. Сервер ДОЛЖЕН быть доступен app-tester и ui-reviewer без ручного запуска. Система НЕ ДОЛЖНА иметь второй MCP-сервер или автономный Chromium-режим — все агентские проверки идут через CDP к Electron.

#### Scenario: Единственный MCP-сервер доступен агенту

- **WHEN** агент, имеющий доступ к MCP-инструментам, начинает проверку UI
- **THEN** все инструменты доступны с префиксом `playwright_*`
- **AND** агент не выбирает между серверами и не переключает префиксы

#### Scenario: Нет второго MCP-сервера

- **GIVEN** opencode.json содержит только `mcp.playwright`
- **WHEN** агент пытается использовать инструменты с префиксом `playwright-cdp_*`
- **THEN** таких инструментов не существует

### Requirement: Evidence-based verification gate

Оркестратор ДОЛЖЕН блокировать approve при красном deterministic check,
доказанном blocker/major reviewer, FAIL app-tester или critical/major FAIL
ui-reviewer. Minor/advisory замечание без нарушения спеки НЕ ДОЛЖНО
автоматически блокировать approve.

#### Scenario: Все обязательные проверки зелёные

- **GIVEN** deterministic checks зелёные, reviewer APPROVE и app-tester PASS
- **AND** ui-reviewer PASS при renderer/both
- **WHEN** оркестратор собирает evidence
- **THEN** change может быть предложен пользователю к approve

#### Scenario: Спорная reviewer-находка

- **GIVEN** implementer ответил DISPUTE с evidence
- **WHEN** оркестратор рассматривает finding
- **THEN** он выполняет meta-review
- **AND** архитектурный спор возвращает архитектору

### Requirement: Цикл generator/evaluator с лимитом итераций

Полный цикл «implementer/ui-designer вносит изменения → deterministic
checks → reviewer/app-tester/ui-reviewer → исправление» ДОЛЖЕН быть
ограничен тремя итерациями. После третьего FAIL система ДОЛЖНА
эскалировать проблему к человеку с evidence всех итераций.

#### Scenario: Эскалация после трёх FAIL

- **GIVEN** implementer получил FAIL от любого агента конвейера три раза подряд
- **WHEN** implementer завершает третью попытку исправления
- **THEN** оркестратор НЕ запускает четвёртую итерацию
- **AND** оркестратор сообщает пользователю о проблеме с контекстом всех трёх проверок

### Requirement: Контракт implementer'а о затрагиваемых слоях

Implementer ПОСЛЕ завершения реализации ДОЛЖЕН выполнить `pnpm typecheck &&
pnpm lint && pnpm build`, релевантные tests из tasks.md, проанализировать
дифф и сообщить `Change touches: renderer|main|both` и
`Contours: ui|core|data|agentic`. Оркестратор использует это для вызова
app-tester и, при renderer/both, ui-reviewer.

#### Scenario: Implementer сообщает renderer с минимальными проверками

- **GIVEN** implementer изменил код в `src/renderer/`
- **WHEN** implementer завершает реализацию и отправляет отчёт оркестратору
- **THEN** отчёт содержит строку `Change touches: renderer`
- **AND** выполнены обязательные deterministic checks из tasks.md
- **AND** оркестратор фиксирует необходимость app-tester и ui-reviewer

#### Scenario: Implementer сообщает main — ui-reviewer не нужен

- **GIVEN** implementer изменил код только в `src/main/`
- **WHEN** implementer завершает реализацию
- **THEN** отчёт содержит строку `Change touches: main`
- **AND** оркестратор запускает reviewer и app-tester, но НЕ ui-reviewer

### Requirement: Документация UI-верификации в AGENTS.md

Система ДОЛЖНА содержать в `AGENTS.md` секцию «App и UI verification»:
deterministic checks, reviewer, app-tester и ui-reviewer; быстрый и полный
Electron CDP modes; запрет автообновления baseline; лимит 3 итераций;
normal/empty/loading/error; размеры окна и невидимые окна.

#### Scenario: Агент следует конвейеру из AGENTS.md

- **WHEN** implementer, reviewer, app-tester, ui-reviewer или оркестратор выполняет свою роль
- **THEN** агент находит секцию «UI verification» в AGENTS.md
- **AND** следует инструкциям для своей роли и стадии конвейера

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
- **THEN** main и preload собираются свежими (`electron-vite build`), а renderer берётся из живого dev-server без пересборки renderer'а

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

### Requirement: ui-reviewer субагент

Система ДОЛЖНА иметь агента `ui-reviewer` (`.opencode/agents/ui-reviewer.md`) — субагент, специализирующийся на UI-верификации. Агент ДОЛЖЕН использовать модель `kimi-for-coding/k3`, иметь `permission.edit: deny` (не может менять код), `permission.bash: allow` (запуск Electron, проверок). Агент ДОЛЖЕН возвращать PASS или FAIL с evidence (скриншоты, логи, accessibility-дерево, описание нарушений) и руководствоваться критериями из `docs/ui-review.md`.

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
