# Research: Инструменты и практики UI-тестирования Electron-приложений

**Дата:** 2026-07-29

## Вопрос

Какие инструменты и практики существуют для UI-тестирования Electron-приложений на уровне DOM-ассертов и скриншотных сравнений, в двух режимах: детерминированные CI-тесты и агент-driven верификация (AI-агент смотрит живой UI через CDP). Решение информирует выбор тестовой инфраструктуры для `kotik-researcher` (Electron 43 + electron-vite 5 + React 19 + pnpm, маленькое приложение без существующей тестовой инфраструктуры).

## Находки

### 1. Ландшафт инструментов UI-тестирования Electron (2025–2026)

#### Playwright (`_electron`) — рекомендован

- **Статус:** Экспериментальный, но активно развивается. API доступен через `const { _electron } = require('playwright')` или `import { _electron as electron } from '@playwright/test'` начиная с Playwright v1.9 (октябрь 2021). Префикс `_` — конвенция JavaScript для экспериментальных API, не признак нестабильности. Playwright v1.62 (24.07.2026) содержит свежие исправления для Electron (PR #41695, мерж 10.07.2026 — фикс зависания page.close() на Electron 42.x).
- **Поддерживаемые версии Electron:** v12.2.0+, v13.4.0+, v14+ (официально). CI Playwright тестирует на Electron 42.4.1–42.6.1 (июль 2026). Electron v43 (наш стек) — в пределах поддерживаемого диапазона.
- **Ключевые возможности:**
  - `electron.launch({ args: ['main.js'] })` — запуск приложения (dev-режим) или с указанием `executablePath` (production-сборка)
  - `electronApp.firstWindow()` / `electronApp.windows()` — доступ к каждому BrowserWindow как к стандартному объекту Page
  - `electronApp.evaluate(fn)` — выполнение кода в main-процессе (доступ к `app`, `dialog`, `BrowserWindow`, `ipcMain`)
  - `electronApp.browserWindow(page)` — JSHandle на нативный BrowserWindow (v1.11+)
  - `electronApp.process()` — ChildProcess главного процесса (v1.21+)
  - Полный Page API в renderer-окнах: locators, click, fill, expect, screenshot, video, tracing, HAR
  - `electronApp.on('console')` — перехват console.log из main-процесса (v1.42+)
- **Известные ограничения:**
  - Нативные диалоги (`dialog.showOpenDialog`, `dialog.showMessageBox`) не перехватываются — нужно стабать через `electronApp.evaluate()`
  - Требуется `FuseV1Options.EnableNodeCliInspectArguments !== false` (иначе launch timeout)
  - Playwright CLI (codegen, inspector) не гарантирует работу с Electron (Issue #41976, закрыт 29.07.2026)
  - Отдельный npm-пакет `@playwright/electron` (latest: 0.0.1, next: 1.60.0-alpha) — в зачаточном состоянии, реальная разработка в монорепозитории Playwright
  - `experimental`-статус не мешает production-использованию — официальные доки Electron используют Playwright как один из двух рекомендованных подходов
- **Источники:**
  - [Playwright API: class Electron](https://playwright.dev/docs/api/class-electron) — актуально на 29.07.2026 (v1.62)
  - [Playwright API: class ElectronApplication](https://playwright.dev/docs/api/class-electronapplication) — актуально на 29.07.2026
  - [Electron Automated Testing guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing) — официальный гайд Electron (@playwright/test@1.52.0)
  - [PR #41695 — fix(electron): close pages from main process](https://github.com/microsoft/playwright/pull/41695) — мерж 10.07.2026
  - [npm @playwright/electron](https://registry.npmjs.org/@playwright/electron) — данные на 28.04.2026

#### Spectron — DEPRECATED (не рассматривать)

- **Статус:** Официально deprecated с 1 февраля 2022 года. Последний релиз: v19.0.0 (февраль 2022) — совместимость только с Electron 17. Репозиторий заморожен. Активных community-форков не обнаружено (225 форков, ни один не активен).
- **Рекомендованный путь миграции от создателей:** Переход на Playwright или WebDriverIO.
- **Источники:**
  - [Spectron GitHub (archived README)](https://github.com/electron-userland/spectron) — deprecated notice Feb 2022
  - [Spectron npm](https://registry.npmjs.org/spectron/latest) — v19.0.0, последняя публикация Feb 2022

#### WebDriverIO (`@wdio/electron-service`) — альтернатива

- **Статус:** Активно поддерживается. `@wdio/electron-service` v10.1.0 (июль 2026). Требует Node.js >= 22.12.0, `webdriverio@9.27.1`. Разработчик: Sam Maister (goosewobbler).
- **Ключевые возможности:**
  - Автоопределение путей для Electron Forge и electron-builder (для electron-vite — ручная настройка `appEntryPoint`)
  - Полный доступ к Electron API через `browser.electron.execute`
  - Моки Electron API (Vitest-подобный API)
  - Стандартный WebDriver-протокол — можно переиспользовать тесты между Electron и веб-версией
  - Интеграция с Selenium Grid
- **Недостатки относительно Playwright:**
  - Более сложный старт (конфигурация WDIO, `appEntryPoint` для electron-vite)
  - Дополнительный слой ChromeDriver между тестом и Electron
  - Привязанность к экосистеме WDIO (peerDependency на webdriverio >9.0.0)
  - Нет встроенной AI-agent интеграции
- **Источники:**
  - [WebDriverIO Electron docs](https://webdriver.io/docs/desktop-testing/electron) — актуально на июль 2026
  - [npm @wdio/electron-service](https://registry.npmjs.org/@wdio/electron-service/latest) — v10.1.0, июль 2026

#### Raw CDP-подход (Chrome DevTools Protocol) — текущий

- **Статус:** Работает (подтверждено опытом проекта), но ad-hoc. Требует ручного написания WebSocket-клиента, вызовов `Runtime.evaluate`, `Page.captureScreenshot` и т.д.
- **Недостатки:** Не даёт готовых ассертов, retry-логики, параллелизации, trace-отладки, CI-интеграции — всё приходится писать самостоятельно.
- **Когда применять:** Как транспортный слой для AI-агентов (через MCP-серверы), но не как основу для детерминированных CI-тестов.

#### Прочие

- **Selenium WebDriver (raw):** Работает через `electron-chromedriver` + `selenium-webdriver`, но требует ручного управления ChromeDriver. Уступает Playwright/WDIO по эргономике.
- **Custom test driver (IPC-over-STDIO):** Node.js `child_process` + IPC через STDIO. Максимальный контроль, но требует собственного RPC-протокола.
- **electron-mocha, electron-test:** Не обнаружены как поддерживаемые решения на 2025–2026.

### 2. DOM-уровень: ассерты и стратегии

- **Playwright:** Полный Page API работает в Electron renderer-окнах без ограничений. `page.locator()`, `page.getByTestId()`, `page.getByRole()`, `expect(locator).toBeVisible()`, `expect(locator).toHaveText()` — всё доступно.
- **Test-ID стратегия:** `page.getByTestId('submit-button')` — рекомендованный Playwright-подход. Требует атрибутов `data-testid` в разметке React. Защищает от хрупкости селекторов (не привязаны к CSS-классам или структуре DOM).
- **Доступ к renderer из теста:** Через `electronApp.firstWindow()` → стандартный Page. Никаких специальных мостов не требуется.
- **Доступ к main-процессу из теста:** `electronApp.evaluate(({ app }) => app.getPath('userData'))` — прямое выполнение в контексте main.
- **AI-агенты:** Microsoft Playwright MCP использует accessibility-дерево (не селекторы) — агент «видит» структуру страницы в текстовом виде (`browser_snapshot`), а не CSS-селекторы. Это более надёжно для неструктурированной верификации.
- **Источники:**
  - [Playwright Locators](https://playwright.dev/docs/locators) — актуально на июль 2026
  - [Electron Automated Testing guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing)

### 3. Скриншоты: visual regression в Electron

#### Playwright `toHaveScreenshot()` — работает с Electron

- **Работает с Electron:** Да — Electron BrowserWindow → Page → `expect(page).toHaveScreenshot()`. Это стандартный Page, все Playwright-фичи применимы.
- **Возможности:**
  - `maxDiffPixels` / `maxDiffPixelRatio` — пороговые значения допустимых отличий
  - `threshold` — pixelmatch matching threshold (0–1, меньше = чувствительнее)
  - `mask: [page.locator('.dynamic')]` — скрытие динамических регионов цветной заливкой
  - `stylePath` — CSS-файл для скрытия волатильных элементов
- **Платформенные baseline'ы:** Playwright автоматически включает ОС в имя снепшота (`chromium-darwin`, `chromium-linux`). Нельзя ожидать совпадения macOS ↔ Linux CI.
- **Факторы нестабильности:** Playwright предупреждает — рендеринг зависит от ОС, версии, GPU, батареи vs питание, headless-режима. Тесты нужно гонять в той же среде, где генерировались эталоны.
- **Источники:**
  - [Playwright Visual Comparisons guide](https://playwright.dev/docs/test-snapshots) — актуально на июль 2026
  - [Playwright PageAssertions API](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1)
  - [pixelmatch GitHub](https://github.com/mapbox/pixelmatch)

#### Облачные сервисы — не рекомендованы для маленького проекта

- **Percy (BrowserStack):** `@percy/playwright` принимает стандартный Page. Electron не документирован, поддержка не тестировалась.
- **Applitools Eyes:** `@applitools/eyes-playwright` — аналогично, Electron-специфичных страниц нет.
- **Chromatic:** Работает через перерендеринг в облачном Chrome. Electron-специфичное поведение не захватывается — **не подходит**.
- **Lost Pixel:** Open-source, архивирован в апреле 2026 (присоединился к Figma). Имел подход «Custom shots».
- **Вывод:** Ни один облачный сервис не декларирует официальную поддержку Electron. Для маленького проекта — избыточно и рискованно.

#### CI considerations

- **Xvfb обязателен на Linux CI:** Electron не имеет headless-режима. Playwright Docker-образ (`mcr.microsoft.com/playwright:v1.62.0-noble`) включает Xvfb. Альтернатива: `xvfb-run npx playwright test`.
- **Шрифты:** Bundle'ить UI-шрифты в приложение для стабильности рендеринга между машинами.
- **Источники:**
  - [Playwright CI docs](https://playwright.dev/docs/ci) — v1.62
  - [Electron Testing on Headless CI](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci)

### 4. Два режима: CI-автотесты и AI-agent-верификация

#### Режим A: CI-автотесты (детерминированные)

- **Playwright Test — де-факто стандарт для Electron E2E.** Поддерживает параллелизацию, шардирование, retry, trace viewer, CI-репортеры.
- **GitHub Actions:** `ubuntu-latest`, Xvfb (Docker или `xvfb-run`), `pnpm exec playwright test --workers=1`.
- **Vitest для renderer-юнитов:** `@vitest/browser-playwright` (Vitest v4.1.10) тестирует React-компоненты в браузере, но **не поддерживает Electron main-процесс**.

#### Режим B: AI-agent-driven верификация (ключевая находка)

- **`@playwright/mcp` (Microsoft)** — официальный MCP-сервер:
  - 35.6k звезд на GitHub, последняя активность июль 2026
  - **Флаг `--cdp-endpoint`** — подключается к _уже запущенному_ браузеру/Electron через CDP. Идеально под ваш сценарий: `@playwright/mcp --cdp-endpoint http://127.0.0.1:9222`
  - Использует **accessibility-дерево** (не скриншоты/пиксели) — `browser_snapshot` возвращает структурированный текст страницы. Экономит токены и надёжнее screenshot-based подхода.
  - Инструменты: `browser_navigate`, `browser_click`, `browser_fill`, `browser_evaluate`, `browser_screenshot`, `browser_snapshot`, `browser_find`, `browser_network`
  - Может работать в `stdio`-режиме (Claude Desktop) или `http`-режиме (VS Code/Cursor)
  - **Не имеет** инструментов для Electron main-процесса — только renderer
- **Альтернативы:**
  - `ChromeDevTools/chrome-devtools-mcp` (47.8k звезд) — 50+ инструментов через Puppeteer/CDP, поддерживает `--browser-url`. Официально только Chrome, но технически подключается к Electron.
  - `@anthropic/mcp-server-puppeteer` — архивирован 29 мая 2025. Неактуален.
  - `executeautomation/mcp-playwright` (5.6k звезд) — ориентирован на генерацию тестового кода, избыточен.
- **Готовые AI-тестовые платформы (Browserbase, Steel.dev, Browserless):** Все ориентированы на **веб**, не на десктопные Electron-приложения. Не подходят.

#### Совместная инфраструктура CI + Agent

```
                    Electron App (--remote-debugging-port=9222)
                                  │
                ┌─────────────────┴─────────────────┐
                │                                   │
    Playwright Test (CI)                   @playwright/mcp (agent)
    _electron.connect()                    --cdp-endpoint 127.0.0.1:9222
    детерминированные ассерты              AI-верификация живым UI
```

**Один CDP-эндпойнт обслуживает обоих клиентов.** Общий движок Playwright — обновление Playwright улучшает и CI-тесты, и агента.

- **Источники:**
  - [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) — июль 2026
  - [ChromeDevTools chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) — июль 2026
  - [Electron Debugging Main Process](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)

### 5. electron-vite + pnpm — специфика интеграции

- **electron-vite не предоставляет тестовой документации или scaffolding.** Официальные доки (v5.0.0) покрывают dev, build, HMR, отладку, дистрибуцию — но не тестирование. Boilerplate (`alex8088/electron-vite-boilerplate`) не содержит тестов.
- **Playwright работает с electron-vite без проблем:** `electron.launch({ args: ['./out/main/index.mjs'] })` — указать путь к скомпилированному main-скрипту в `out/`.
- **pnpm:** Playwright полностью поддерживает pnpm. `_electron.launch()` ищет electron через `node_modules/.bin/electron` — корректно с pnpm-симлинками. `pnpm.onlyBuiltDependencies` уже настроен. Проблем не задокументировано.
- **Источники:**
  - [electron-vite docs](https://electron-vite.org/guide/) — v5.0.0
  - [Playwright Installation — pnpm](https://playwright.dev/docs/intro#using-pnpm) — v1.62

## Сравнение

| Критерий | Playwright Test + @playwright/mcp | WebDriverIO (@wdio/electron-service) | Raw CDP (текущий) |
|---|---|---|---|
| **Зрелость Electron-поддержки** | Экспериментальный, активно чинится (PR июль 2026) | Production-ready (v10.1.0, июль 2026) | Ad-hoc, без стандартизации |
| **Рекомендован Electron-доками** | Да | Да | Нет (только как custom driver) |
| **Сложность старта** | Минимальная: 1 dev-зависимость, 1 конфиг | Средняя: WDIO config, appEntryPoint | Высокая: всё руками |
| **DOM-ассерты** | Полный Page API, locators, toHaveScreenshot | WDIO-селекторы, кастомные команды | Runtime.evaluate вручную |
| **Visual regression** | toHaveScreenshot() из коробки | Скриншоты WDIO + pixelmatch | Page.captureScreenshot вручную |
| **AI-agent-верификация** | @playwright/mcp --cdp-endpoint — единый движок | Нет встроенной MCP-интеграции | Работает, но без структурированных инструментов |
| **Общий движок CI + Agent** | Да — оба используют Playwright | Нет — потребуется отдельный agent-стек | Только agent, CI-тесты с нуля |
| **CI-интеграция** | Стандартный GitHub Actions + Xvfb/Docker | GitHub Actions + ChromeDriver | Всё писать самостоятельно |
| **Main process testing** | evaluate() в main-процессе | browser.electron.execute | Runtime.evaluate в нужном контексте |
| **Node.js требования** | Нет жёстких (v1.62) | Node.js >= 22.12.0 | Нет |
| **pnpm-совместимость** | Да, без проблем | Не тестировалось, вероятно ок | Да |

## Рекомендация

**VERDICT:** Playwright Test + `@playwright/mcp` — единый стек для CI-тестов и агентской верификации. Уверенность: **высокая**.

### Что предлагается

```
pnpm add -D @playwright/test
pnpm add -D @playwright/mcp   # MCP-сервер для AI-верификации
```

**Слой 1: CI-тесты (детерминированные)**

```ts
// e2e/app.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';

test('app launches and shows main window', async () => {
  const electronApp = await electron.launch({ args: ['./out/main/index.mjs'] });
  const window = await electronApp.firstWindow();
  await expect(window).toHaveTitle(/Kotik Researcher/);
  await expect(window.getByTestId('main-layout')).toBeVisible();
  await electronApp.close();
});
```

Скрипты в `package.json`:
```json
{
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```

CI (GitHub Actions): `ubuntu-latest`, Docker `mcr.microsoft.com/playwright:v1.62.0-noble` или `xvfb-run pnpm test:e2e`.

**Слой 2: AI-agent-верификация (исследовательская)**

Запуск Electron для агента:
```bash
./node_modules/.bin/electron --remote-debugging-port=9222 ./out/main/index.mjs
```

Подключение агента (через MCP):
```bash
npx @playwright/mcp --cdp-endpoint http://127.0.0.1:9222
```

Агент получает структурированные инструменты: `browser_snapshot` (accessibility-дерево), `browser_screenshot`, `browser_click`, `browser_evaluate` — и может верифицировать UI без ручного написания CDP-вызовов.

**Слой 3 (опционально): Визуальные регрессии**

В CI-тестах:
```ts
await expect(window).toHaveScreenshot('main-window.png', {
  mask: [window.getByTestId('dynamic-timestamp')],
  maxDiffPixels: 100,
});
```

### Почему не WebDriverIO

- **Нет AI-agent-интеграции.** Придётся поднимать отдельное решение (raw CDP или MCP-сервер) — два не связанных стека.
- **Сложнее старт.** WDIO config, `appEntryPoint` для electron-vite, ChromeDriver — всё вручную.
- **Playwright рекомендован Electron-доками** наравне с WDIO. Для маленького проекта разница в зрелости не критична — `_electron` API стабильно работает на Electron 42–43 в CI Playwright.

### Почему не чистый CDP

- **Нет готовой тестовой инфраструктуры.** Retry, параллелизация, trace viewer, репортеры, CI-артефакты — всё пришлось бы писать.
- **Не даёт структурированных инструментов для AI-агента.** `@playwright/mcp` решает это из коробки.
- **Ваш текущий CDP-подход ложится в `@playwright/mcp --cdp-endpoint` без переписывания.** Транспорт тот же (WebSocket к CDP), но с готовыми инструментами.

### Что могло бы изменить рекомендацию

1. **Если бы `@playwright/mcp` не поддерживал `--cdp-endpoint`** — тогда пришлось бы рассматривать `chrome-devtools-mcp` как отдельный agent-стек. Но поддержка подтверждена.
2. **Если бы проект требовал тестирования native-диалогов без моков** — WebDriverIO имеет лучшую поддержку. Для kotik-researcher не критично — диалоги стабаются через `electronApp.evaluate()`.
3. **Если бы проект уже использовал WebDriverIO для веб-тестов** — WDIO давал бы переиспользование. Не наш случай.
4. **Если бы требовалась поддержка Selenium Grid / мультибраузерность** — WDIO предпочтительнее. Не наш случай.

### План внедрения (оценка усилий)

| Шаг | Усилие | Результат |
|---|---|---|
| 1. `pnpm add -D @playwright/test` + `playwright.config.ts` | ~15 мин | Запуск CI-тестов в headless |
| 2. Первый тест: smoke-тест запуска приложения | ~15 мин | Базовая верификация в CI |
| 3. DOM-тесты с test-id | ~30 мин/компонент | Покрытие критичных UI-сценариев |
| 4. Визуальные регрессии (`toHaveScreenshot`) | ~30 мин | Автоматическая проверка вёрстки |
| 5. `@playwright/mcp` + скрипт запуска для агента | ~30 мин | AI-agent-верификация через CDP |
| 6. GitHub Actions workflow | ~20 мин | CI-проверка на PR |

**Итого:** ~2.5 часа до полного покрытия (CI-тесты + agent-верификация + визуальные регрессии).

## Источники

- [Playwright API: class Electron](https://playwright.dev/docs/api/class-electron) — полный API, версии добавления, known issues. v1.62, доступ 29.07.2026
- [Playwright API: class ElectronApplication](https://playwright.dev/docs/api/class-electronapplication) — методы, события, примеры. v1.62, доступ 29.07.2026
- [Electron Automated Testing guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing) — официальный гайд Electron (@playwright/test@1.52.0). Доступ 29.07.2026
- [Playwright Visual Comparisons guide](https://playwright.dev/docs/test-snapshots) — toHaveScreenshot API, masking, threshold. v1.62, доступ 29.07.2026
- [Playwright CI docs](https://playwright.dev/docs/ci) — GitHub Actions, Docker, Xvfb. v1.62, доступ 29.07.2026
- [Playwright Installation (pnpm)](https://playwright.dev/docs/intro#using-pnpm) — pnpm-совместимость. v1.62, доступ 29.07.2026
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) — MCP-сервер, флаг --cdp-endpoint. 35.6k звезд, активность июль 2026
- [ChromeDevTools chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) — альтернативный MCP-сервер (CDP/Puppeteer). 47.8k звезд, июль 2026
- [PR #41695 (Playwright)](https://github.com/microsoft/playwright/pull/41695) — fix(electron): close pages from main process. Мерж 10.07.2026
- [Issue #41976 (Playwright)](https://github.com/microsoft/playwright/issues/41976) — запрос поддержки старых Electron в CLI. Закрыт 29.07.2026
- [Spectron GitHub](https://github.com/electron-userland/spectron) — deprecated notice Feb 2022. Доступ 29.07.2026
- [WebDriverIO Electron docs](https://webdriver.io/docs/desktop-testing/electron) — @wdio/electron-service. v10.1.0, доступ 29.07.2026
- [Electron Testing on Headless CI](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci) — Xvfb, xvfb-maybe. Доступ 29.07.2026
- [Electron Debugging Main Process](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process) — --remote-debugging-port. Доступ 29.07.2026
- [pixelmatch GitHub](https://github.com/mapbox/pixelmatch) — библиотека попиксельного сравнения. Доступ 29.07.2026
- [electron-vite docs](https://electron-vite.org/guide/) — v5.0.0 (без тестовой документации). Доступ 29.07.2026
- [Browserbase Stagehand](https://github.com/browserbase/stagehand) — AI-фреймворк (не поддерживает Electron). 23.7k звезд, июль 2026
