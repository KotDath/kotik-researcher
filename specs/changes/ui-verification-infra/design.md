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

Источник — research/2026-07-29-electron-ui-testing.md и GitHub readme пакета.

### Режимы работы

1. **Автономный браузер** (дефолт) — MCP сам запускает браузер:
   ```
   npx @playwright/mcp@latest
   ```

2. **Подключение к существующему браузеру через CDP** (наш случай):
   ```
   npx @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222
   ```
   Используется для полного режима агента: Electron запущен с `--remote-debugging-port=9222`, MCP подключается к нему.

3. **Подключение к веб-странице** (наш быстрый режим):
   ```
   npx @playwright/mcp@latest
   ```
   Затем `browser_navigate` на `http://localhost:5173` (dev-server renderer).

### Инструменты (tools)

- `browser_navigate(url)` — переход по URL
- `browser_snapshot` — accessibility-дерево страницы (текстовое представление, экономит токены)
- `browser_click(selector)` — клик по элементу
- `browser_fill(selector, text)` — ввод текста
- `browser_screenshot` — скриншот страницы
- `browser_evaluate(js)` — выполнение JavaScript на странице
- `browser_find(text)` — поиск текста на странице
- `browser_network` — информация о сетевых запросах

Ключевая особенность: `browser_snapshot` использует accessibility-дерево, а не CSS-селекторы — агент «видит» структуру страницы в текстовом виде. Это надёжнее для неструктурированной верификации, чем скриншоты.

### Регистрация в opencode.json

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest"]
    }
  }
}
```

Для полного режима с CDP агент выполняет две операции последовательно:
1. `pnpm test:agent:electron` (запускает Electron с `--remote-debugging-port=9222`)
2. Закрывает автономный MCP и переподключается с `--cdp-endpoint` (или использует `browser_navigate` к CDP)

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

- **Цели:** Vitest unit (бизнес-логика, сторы, IPC-обёртки, хуки, компоненты) + Playwright E2E smoke (5–10 сценариев, два режима запуска) + visual regression (5–10 экранов, baseline в git, ручное обновление) + агент-driven верификация (быстрый: dev-server + MCP; полный: live Electron через CDP + MCP) + ui-reviewer субагент (deny:edit, PASS/FAIL) + документация (docs/ui-review.md, AGENTS.md) + интеграция в SDD-цикл (контракт implementer'а, hard gate reviewer'а) + удаление spike.ts/SPIKE_HEADLESS
- **Не-цели:** облачные visual-сервисы (Percy, Applitools, Chromatic); полное snapshot-покрытие всего UI; CI-инфраструктура (GitHub Actions); тестирование pi SDK; автообновление baseline

## Решения

### 1. Тестовая директория `tests/` в корне

Три поддиректории: `tests/unit/` (Vitest), `tests/e2e/` (Playwright E2E), `tests/visual/` (Playwright визуальные). Все тесты в одном месте, вне `src/`. Отвергнуто: разнесение по `src/__tests__/` — тесты не являются кодом приложения, не должны смешиваться.

### 2. Vitest workspace: два проекта

`vitest.workspace.ts` с проектами под `tsconfig.node.json` (main-логика: сторы, IPC, утилиты) и `tsconfig.web.json` (renderer: компоненты, хуки, React). Разделение решает конфликт tsconfig (node vs DOM) и позволяет разный `environment` (`node` vs `jsdom` или `@vitejs/plugin-react`). Отвергнуто: один проект с ручным переключением environment — хрупко и не масштабируется.

### 3. Playwright: один конфиг, два проекта

`playwright.config.ts` в корне с проектами `e2e` (запуск Electron, пользовательские сценарии) и `visual` (скриншоты, `toHaveScreenshot`). Единый fixture для Electron-запуска в `tests/e2e/fixtures/electron.fixture.ts` (переиспользуется в e2e и visual). Отвергнуто: два конфига — дублирование fixture и общей конфигурации.

### 4. Два режима E2E-тестов: build и dev

- `pnpm test:e2e` → `pnpm build && playwright test --project=e2e` — для reviewer'а: полный production-цикл
- `pnpm test:e2e:quick` → `playwright test --project=e2e` (на dev-сборке electron-vite) — для implementer'а в итерациях, без пересборки

Оба используют `_electron.launch()`, разница только в том, собран ли `out/` заново. Отвергнуто: только build-режим — замедляет итерации implementer'а.

### 5. Агент-driven: два режима с явным разделением

- **Быстрый (dev-server):** `pnpm dev:renderer` → renderer на localhost → MCP подключается к странице. Быстро, не требует сборки main, но не проверяет IPC/preload/main-интеграцию.
- **Полный (live Electron):** `pnpm test:agent:electron` → Electron с `--remote-debugging-port=9222` → MCP с `--cdp-endpoint`. Финальная верификация с реальной main-renderer интеграцией.

Разделение зафиксировано в AGENTS.md: implementer использует быстрый режим для самопроверки, ui-reviewer — полный для финальной. Отвергнуто: унификация в один режим — быстрый не ловит баги IPC/main (LRN-20260729-001: баги верифицируются на том же уровне, где наблюдаются симптомы).

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

### 10. ui-reviewer: deny:edit, PASS/FAIL

Отдельный субагент (`.opencode/agents/ui-reviewer.md`) — `permission.edit: deny`, только наблюдатель. Инструменты: Playwright MCP (browser_snapshot, browser_screenshot, browser_click и др.). Возвращает PASS/FAIL с evidence (скриншоты, accessibility-дерево, описание нарушений). FAIL — hard gate: блокирует `/kotik-approve` без исключений. Оркестратор — диспетчер: reviewer сообщает «нужна UI-проверка», оркестратор вызывает ui-reviewer.

### 11. Интеграция в SDD-цикл

- **Контракт implementer'а:** строка `Change touches: renderer` (или `main`, `both`) в ответе оркестратору после реализации. Определяется по диффу implementer'ом. Оркестратор парсит ответ и требует UI-проверку при `renderer`/`both`.
- **Быстрая самопроверка implementer'а:** `pnpm test:unit && pnpm test:e2e:quick` + быстрый UI-чек (dev-server + MCP).
- **Полная верификация reviewer'а:** reviewer вызывает ui-reviewer (через оркестратора) для полной проверки (live Electron + скриншоты).
- **Цикл generator/evaluator:** максимум 3 итерации, конвенция в AGENTS.md. После 3-го FAIL — эскалация к человеку.
- **Hard gate:** FAIL от ui-reviewer блокирует approve.

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
| MCP против dev-server не видит main-интеграцию (баги IPC/preload) | Полный режим (live Electron) для финальной верификации + Playwright E2E-тесты покрывают IPC |
| Self-review bias: агент переоценивает свою работу | Отдельный ui-reviewer с deny:edit + цикл generator/evaluator ≤3 итераций |
| Отсутствие CI: все проверки локально, агент может забыть запустить | Интеграция в SDD-цикл: обязательная проверка на стадии reviewer'а / kotik-approve; ui-reviewer — hard gate |
| `@playwright/mcp` только для renderer — не проверяет main-процесс | Playwright E2E-тесты покрывают main через `electronApp.evaluate()`; MCP используется только для визуальной верификации renderer |
