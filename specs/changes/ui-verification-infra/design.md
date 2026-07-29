# Design: ui-verification-infra

## Контекст

Приложение на Electron 43 + electron-vite 5 + React 19 + TypeScript strict + pnpm. Тестовой инфраструктуры нет: `tests/` отсутствует, `vitest`/`@playwright/test` не установлены. Существующий механизм верификации — ad-hoc CDP-скрипт через `SPIKE_HEADLESS` и `src/main/spike.ts` (4 функции: базовый LLM-пинг, thinking-спайк, chat-manager-интеграция, feed-дамп). Источники: research/2026-07-29-electron-ui-testing.md (веб-исследование инструментов), research/2026-07-29-electron-ui-testing-expert.md (экспертная консультация).

## Справка: Playwright `_electron` API (v1.62)

Источник — research/2026-07-29-electron-ui-testing.md и официальная документация Playwright, НЕ node_modules (пакет ещё не установлен). Эта справка — единая точка правды для implementer/reviewer (урок LRN-20260728-002: не реверс-инжинирить семантику заново в каждой сессии).

### Запуск Electron

```ts
import { _electron as electron } from '@playwright/test';
// или: import { _electron as electron } from 'playwright';

const electronApp = await electron.launch({
  args: ['./out/main/index.mjs'],        // entry point
  executablePath: undefined,             // автоопределение electron в node_modules
  env: { ...process.env, NODE_ENV: 'test' }
});
```

- `electron.launch()` ищет Electron через `node_modules/.bin/electron` — корректно с pnpm-симлинками
- `executablePath` можно указать для production-сборки; без него используется electron из devDependencies
- `args` — аргументы командной строки для Electron (main-скрипт, флаги)
- Требуется `FuseV1Options.EnableNodeCliInspectArguments !== false` (дефолт electron-vite — ок)
- Возвращает `ElectronApplication`

### ElectronApplication

```ts
const window: Page = await electronApp.firstWindow();
const windows: Page[] = electronApp.windows();
await electronApp.close();

// Доступ к main-процессу
await electronApp.evaluate(({ app, dialog, BrowserWindow }) => {
  // код выполняется в main-процессе
  app.getPath('userData');
});

// JSHandle на BrowserWindow
const bwHandle = await electronApp.browserWindow(page);

// ChildProcess главного процесса (v1.21+)
const process = electronApp.process();
```

- `firstWindow()` — ждёт событие `window` и возвращает первое окно как `Page`
- `windows()` — массив всех открытых окон (для сценариев с несколькими BrowserWindow)
- `evaluate(fn)` — выполнение в main-процессе, аргумент — деструктурированный Electron API
- Событие `'window'` — новое окно открыто
- Событие `'console'` — перехват console.log из main-процесса (v1.42+)

### Page API в renderer-окнах

Стандартный Playwright Page API работает без ограничений:
- `page.locator(selector)`, `page.getByTestId('id')`, `page.getByRole('button', { name: '...' })`
- `page.click()`, `page.fill()`, `page.waitForSelector()`
- `expect(page).toHaveTitle()`, `expect(locator).toBeVisible()`, `expect(locator).toHaveText()`
- `page.screenshot()`, `page.evaluate()`

### Ограничения

- Нативные диалоги (`dialog.showOpenDialog`, `dialog.showMessageBox`) не перехватываются — нужно стабать через `electronApp.evaluate()`: `dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/tmp/test'] })`
- Playwright CLI (codegen, inspector) не гарантирует работу с Electron
- `experimental`-статус не мешает production-использованию: официальные доки Electron рекомендуют Playwright, CI Playwright тестирует на Electron 42–43

### Визуальные регрессии

```ts
await expect(page).toHaveScreenshot('main-window.png', {
  maxDiffPixels: 100,           // абсолютный допуск
  maxDiffPixelRatio: 0.001,     // относительный допуск (0.1%)
  threshold: 0.2,               // pixelmatch threshold (0–1)
  animations: 'disabled',       // отключение CSS-анимаций
  caret: 'hide',                // скрытие курсора
  mask: [page.getByTestId('dynamic-timestamp')],  // маски динамических регионов
});
```

- Baseline создаётся при первом прогоне или с `--update-snapshots`
- Playwright включает ОС в имя снепшота (`-linux`, `-darwin`, `-win32`) — кросс-платформенные baseline'ы невозможны без отдельных файлов
- Факторы нестабильности: ОС, версия Chromium, GPU, шрифты, headless-режим
- Стабилизация: фиксированный размер окна, `document.fonts.ready`, отключение анимаций/transition, маски динамических регионов

## Справка: `@playwright/mcp` (Microsoft, июль 2026)

Источник — research/2026-07-29-electron-ui-testing.md и живая проверка пакета.

### Единый CDP-режим (решение A)

Оба агентских режима подключаются к Electron через CDP на порту 9222. ОДИН MCP-сервер в opencode.json:

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://127.0.0.1:9222"]
    }
  }
}
```

**Почему один сервер:**
- `@playwright/mcp` не умеет переключаться между автономным браузером и CDP в одном процессе — поэтому раньше использовались два сервера (`playwright` + `playwright-cdp`), что создавало путаницу префиксов инструментов (`playwright_*` vs `playwright-cdp_*`)
- Решение: ВСЕ агентские проверки идут через CDP к Electron. Нет автономного Chromium-режима. Нет MCP против голого dev-server в браузере.
- Два режима реализации применяются ДО запуска MCP: `pnpm test:agent:dev` (electron-vite dev + CDP) и `pnpm test:agent:electron` (prod build + CDP). MCP всегда один и тот же, разница — что запущено на порту 9222.

**Быстрый режим (electron-vite dev):**
- `pnpm test:agent:dev` — electron-vite dev с `--remote-debugging-port=9222`
- Main из исходников (с HMR), renderer из vite dev-server (с HMR)
- Полноценное Electron-приложение (main + preload + renderer), не голый браузер
- Для итеративной разработки: быстро, но не гарантирует prod-сборку

**Полный режим (prod build):**
- `pnpm test:agent:electron` — собранное приложение (`out/main/index.mjs`) с `--remote-debugging-port=9222`
- Изолированный userData с сид-данными, env-allowlist без credentials
- Для финальной верификации ui-reviewer'ом

### Инструменты (tools)

Актуальные имена (проверено живьём на @playwright/mcp 0.0.78):
`browser_navigate`, `browser_snapshot` (accessibility-дерево), `browser_click`,
`browser_fill`, `browser_take_screenshot` (НЕ `browser_screenshot` — переименован),
`browser_evaluate`, `browser_find`, `browser_network_requests`, `browser_resize`.

Все инструменты доступны с префиксом `playwright_*` (единственный сервер — нет путаницы).

**Важно:** `@playwright/mcp` не имеет инструментов для Electron main-процесса — только renderer. Проверка IPC/main-интеграции — через Playwright E2E-тесты, не через MCP.

## Справка: `@playwright/test` конфигурация

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual',
      testDir: './tests/visual',
      use: { ...devices['Desktop Chrome'] },
      snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
    },
  ],
});
```

- Один конфиг, два проекта — `e2e` и `visual`
- `e2e`-проект: запуск Electron через `_electron.launch()`, пользовательские сценарии
- `visual`-проект: скриншотные тесты с `toHaveScreenshot()`
- Общий fixture для `_electron.launch()` / `electronApp.close()` — через `test.extend()`

## Цели и не-цели

- **Цели:** Vitest unit (бизнес-логика, сторы, IPC-обёртки, хуки, компоненты) + Playwright E2E smoke (5–10 сценариев, два режима запуска) + visual regression (5–10 экранов, baseline в git, ручное обновление) + agent-driven верификация (быстрый: electron-vite dev + CDP; полный: prod build + CDP) + app-tester (Flash, functional live flow) + ui-reviewer (K3, visual verdict) + reviewer (Sol/medium, code/spec) + документация (docs/ui-review.md, AGENTS.md) + интеграция в SDD-цикл + удаление spike.ts/SPIKE_HEADLESS
- **Не-цели:** облачные visual-сервисы (Percy, Applitools, Chromatic); полное snapshot-покрытие всего UI; CI-инфраструктура (GitHub Actions); тестирование pi SDK; автообновление baseline; автономный Chromium-режим MCP; Xvfb

## Решения

### 1. Тестовая директория `tests/` в корне

Три поддиректории: `tests/unit/` (Vitest), `tests/e2e/` (Playwright E2E), `tests/visual/` (Playwright визуальные). Все тесты в одном месте, вне `src/`. Отвергнуто: разнесение по `src/__tests__/` — тесты не являются кодом приложения, не должны смешиваться.

### 2. Vitest workspace: два проекта

`vitest.workspace.ts` с проектами под `tsconfig.node.json` (main-логика: сторы, IPC, утилиты) и `tsconfig.web.json` (renderer: компоненты, хуки, React). Разделение решает конфликт tsconfig (node vs DOM) и позволяет разный `environment` (`node` vs `jsdom` или `@vitejs/plugin-react`). Отвергнуто: один проект с ручным переключением environment — хрупко и не масштабируется.

### 3. Playwright: один конфиг, два проекта

`playwright.config.ts` в корне с проектами `e2e` (запуск Electron, пользовательские сценарии) и `visual` (скриншоты, `toHaveScreenshot`). Единый fixture для Electron-запуска в `tests/e2e/fixtures/electron.fixture.ts` (переиспользуется в e2e и visual). Отвергнуто: два конфига — дублирование fixture и общей конфигурации.

### 4. Два режима E2E-тестов: build и quick (CDP)

- `pnpm test:e2e` → `pnpm build && playwright test --project=e2e` — для финальной проверки: полный production-цикл (renderer из бандла `out/renderer`)
- `pnpm test:e2e:quick` → `electron-vite build && E2E_RENDERER_URL=http://localhost:5173 playwright test --project=e2e` — для итеративной разработки: main+preload свежесобранные (быстрая сборка ~1с), renderer — живой dev-server с HMR

Оба используют `_electron.launch()`. Quick НЕ бежит на stale main/preload (review-fix, блокер 3): ранняя версия брала main из старого `out/`, и изменения main/preload не попадали в прогон. Отвергнуто: только build-режим — замедляет итерации; команды запускаются непосредственно из tasks.md без отдельной LLM-роли.

### 5. Агент-driven: два режима на едином CDP (решение A)

ОБА режима — это Electron на CDP-порту 9222:

- **Быстрый (electron-vite dev):** `pnpm test:agent:dev` — electron-vite dev с `--remote-debugging-port=9222`. Main из исходников с HMR, renderer из vite dev-server — полноценное Electron-приложение. Быстро, но не гарантирует prod-сборку.
- **Полный (prod build):** `pnpm test:agent:electron` — собранное приложение (`out/main/index.mjs`) с `--remote-debugging-port=9222`, изолированный userData с сид-данными. Финальная верификация с реальной main-renderer интеграцией.

Один MCP-сервер `playwright` в opencode.json с флагом `--cdp-endpoint http://127.0.0.1:9222` — агенты не переключают серверы, разница только в том, что запущено на порту.

Отвергнуто: два MCP-сервера (`playwright` + `playwright-cdp`) — путаница префиксов инструментов; MCP против голого dev-server в Chromium — не проверяет main-интеграцию (LRN-20260729-001) и убран как режим полностью; Xvfb — не нужен, скриншоты работают через композитор CDP даже с `show: false`.

### 5a. Невидимые окна (решение B)

При запуске с флагом `--e2e` (все тестовые и агентские прогоны) main ДОЛЖЕН создавать BrowserWindow с опциями:
- `show: false` — окно не отображается на экране, не крадёт фокус
- `backgroundThrottling: false` — renderer продолжает отрисовку, даже когда окно скрыто (критично для скриншотов)

**Механика скриншотов:** CDP `Page.captureScreenshot` захватывает изображение из композитора renderer'а — видимость окна не требуется. Доказательство: задача-проверка со скриншотом-пруфом скрытого окна.

Отвергнуто: Xvfb — избыточно для локальных прогонов без CI; `show: true` с отображением окна — крадёт фокус пользователя при фоновых прогонах.

### 6. Стратегия test-id: `data-testid`

Атрибуты `data-testid` в React-разметке для Playwright-селекторов (`page.getByTestId('id')`). Защищает от хрупкости CSS-селекторов и DOM-структуры. Отвергнуто: ARIA role-based селекторы (`getByRole`) — подходят для accessibility, но не дают точечной адресации конкретных компонентов; CSS-селекторы — хрупкие при рефакторинге.

### 7. Baseline: ручное обновление, git

`toHaveScreenshot()` создаёт baseline при первом прогоне или с `--update-snapshots`. Baseline-скриншоты коммитятся в git (`tests/visual/__screenshots__/`). Автообновление запрещено в AGENTS.md — агент не может обновить эталон и получить зелёный тест. Отвергнуто: автообновление в CI — агент может сломать UI и обновить эталон; CI-генерация при каждом прогоне — хрупко из-за разного окружения.

### 8. Моки нативных диалогов: `electronApp.evaluate()`

Playwright не перехватывает системные диалоги Electron. Моки реализуются через `electronApp.evaluate()`:
```ts
await electronApp.evaluate(({ dialog }) => {
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: ['/tmp/test-project'],
  });
});
```
Отвергнуто: отдельный IPC-канал для тестов — добавляет код в production, который существует только для тестов.

### 9. Fixture стабилизации скриншотов

Общий Playwright fixture (`electron.fixture.ts`) содержит:
- `window.waitForLoadState('domcontentloaded')`
- `await window.evaluate(async () => { await document.fonts.ready })` — ожидание загрузки шрифтов
- `window.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }' })` — отключение анимаций
- Фиксированный размер окна: `await window.setViewportSize({ width: 1280, height: 800 })`
- **env allowlist** (review-fix, major 9): Electron получает только явно перечисленные переменные (PATH/HOME/DISPLAY/…), credentials (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, AWS) не достигают pi SDK — реальные сетевые вызовы LLM из тестов исключены, исход отправки сообщения детерминирован (карточка ошибки). Отвергнут denylist `*_API_KEY`: пропускал бы остальные креды.
- **teardown в try/finally** (review-fix, minor 10): изолированный userData удаляется и при падении теста.

### 9a. Мок window.api в preload по `E2E_MOCK_API` (review-fix, блокер 4)

Детерминированные состояния (вечная загрузка, точный текст ошибки, богатая история) в реальном main недостижимы. contextBridge экспонирует read-only `window.api` — подмена снаружи невозможна (проверено: «Cannot assign to read only property»). Поэтому мок живёт в `src/preload/mock-api.ts` и активируется env `E2E_MOCK_API=loading|demo|error` в `src/preload/index.ts` — подмена происходит ДО рендера, внутри Electron. Visual-тесты мок-состояний используют `_electron.launch()` и общий fixture. Тот же мок renderer ставит себе сам в renderer-only режиме (`pnpm dev:renderer`, `src/renderer/src/mock-api.ts`) — быстрый агентский режим и visual-тесты видят идентичные состояния.

### 10. Конвейер верификации (решение C, пересмотрено)

```
implementer Flash (код + deterministic checks из tasks.md)
       │
       │ Change touches: renderer/main/both
       ▼
  reviewer Sol/medium
  code/spec + evidence
       │ APPROVE
       ▼
  app-tester Flash
  live flow через CDP
       │ PASS
       ▼ (renderer/both)
  ┌──────────────────────────┐
  │ ui-reviewer (k3)         │
  │ живой UI через MCP CDP   │
  │ скриншоты, PASS/FAIL     │
  └──────────────────────────┘
       │ PASS
       ▼
    предложить approve
```

**Разделение ответственности:**

- **implementer** (`opencode-go/deepseek-v4-flash`): код и
  deterministic checks из tasks.md. Не выполняет exploratory app testing.
- **reviewer** (`openai/gpt-5.6-sol`, medium): независимый code/spec review.
  Может запустить узкий reproducer, но не дублирует весь suite.
- **app-tester** (`opencode-go/deepseek-v4-flash`): black-box проходит
  пользовательский flow в live Electron и возвращает evidence.
- **ui-reviewer** (kimi-for-coding/k3): живой UI через MCP CDP + скриншоты, PASS/FAIL по docs/ui-review.md. Модель с vision (k3) нужна для оценки скриншотов. deny:edit.
- **Оркестратор** собирает deterministic evidence и вердикты; при
  renderer/both вызывает ui-reviewer после functional PASS. Цикл ≤3.

Отвергнуто: отдельный LLM test-runner — запуск фиксированной команды не
требует отдельной модели; генеративная роль оправдана для написания тестов
и exploratory app testing.

### 10a. Закреплённые модели агентов верификации

- **implementer/app-tester:** `opencode-go/deepseek-v4-flash`.
- **ui-reviewer:** `kimi-for-coding/k3` — нужна поддержка изображений (vision) для оценки скриншотов; тяжёлая модель оправдана важностью финальной визуальной верификации.
- **reviewer:** `openai/gpt-5.6-sol`, `variant: medium`.

### 11. Интеграция в SDD-цикл

- **Контракт implementer'а:** `Change touches` и `Contours`; проверки из tasks.md.
- **Диспетчеризация:** reviewer → app-tester → ui-reviewer(renderer/both).
- **Evidence gate:** красный deterministic check, доказанный blocker/major,
  FAIL app-tester или critical/major visual FAIL блокируют approve.
- **Цикл generator/evaluator:** максимум 3 итерации полного цикла, конвенция в AGENTS.md. После 3-го FAIL — эскалация к человеку с контекстом всех трёх итераций.
- **Reviewer dispute:** implementer отвечает ACCEPT/DISPUTE/PRE_EXISTING;
  спор adjudicates оркестратор, архитектурный — архитектор.

### 12. Удаление spike.ts / SPIKE_HEADLESS

`src/main/spike.ts` (4 экспортируемые функции, ~450 строк) и `SPIKE_HEADLESS`-ветвление в `src/main/index.ts` удаляются. Причины:
- `runSpike()` (базовый LLM-пинг) → покрывается Playwright E2E smoke (сценарий «чат работает»)
- `runThinkingSpike()` (thinking-спайк) → спайк выполнил свою роль (данные в decisions.md archive/chat-reasoning-stream), больше не нужен
- `runChatManagerSpike()` (ChatManager-интеграция) → покрывается unit-тестами Vitest
- `runFeedDumpSpike()` (диагностика) → покрывается Playwright E2E + visual

Новый стек Playwright E2E + MCP покрывает все сценарии системно; не плодим зоопарк инструментов. import'ы `runSpike` и др. из `src/main/index.ts` удаляются вместе с условным ветвлением по `SPIKE_HEADLESS`.

### 13. Ужесточение протокола идеатора

В AGENTS.md добавляется требование к ideator: vision.md обязан покрывать все измерения карты (Цель и границы, Техническая реализация, UI/UX, Риски и опасения, Компромиссы, Крайние случаи и failure modes, Критерии приёмки, Открытые вопросы). Оркестратор обязан проверять наличие всех секций перед передачей vision.md spec-writer'у. При неполной карте оркестратор возвращает vision.md идеатору на доработку.

## Риски

| Риск | Митигация |
|---|---|
| `_electron` — experimental API, возможна нестабильность на Electron 43 | Активно чинится (PR #41695, июль 2026), CI Playwright тестирует на Electron 42–43; риск приемлем для dev-инструмента (тесты не в production) |
| Флапающие скриншоты из-за ОС, шрифтов, GPU | Фиксация размера окна, отключение анимаций, маски динамических регионов, `document.fonts.ready`, единое окружение запуска (локально) |
| CDP-порт занят — Electron не запустится | Обработка ошибки запуска с понятным сообщением; в будущем — динамический порт |
| Self-review bias: агент переоценивает свою работу | Независимые reviewer, app-tester и ui-reviewer с evidence |
| Отсутствие CI: все проверки локально, агент может забыть запустить | Deterministic checks явно перечислены в tasks.md и являются approve gate |
| `@playwright/mcp` только для renderer — не проверяет main-процесс | Playwright E2E-тесты покрывают main через `electronApp.evaluate()`; MCP используется только для визуальной верификации renderer |
| Скрытое окно может не рендерить контент для скриншотов | `backgroundThrottling: false` + CDP `Page.captureScreenshot` из композитора; задача-проверка со скриншотом-пруфом |
| Flash app-tester неверно интерпретирует UI | Требовать steps, DOM/snapshot и screenshot evidence; визуальный verdict остаётся у K3 |
