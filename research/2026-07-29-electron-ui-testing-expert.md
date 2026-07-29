# Экспертная консультация: UI-тестирование Electron (вайбкодинг)

- **Дата:** 2026-07-29
- **Источник:** консультация пользователя с экспертом (ChatGPT Plus), передана
  дословно в чате
- **Статус:** первоисточник для будущей фичи UI-верификации; компаньон к
  research/2026-07-29-electron-ui-testing.md (веб-исследование). Расхождения:
  исследование рекомендовало @playwright/mcp с --cdp-endpoint к живому Electron;
  эксперт рекомендует MCP против dev-сервера renderer, а Electron — через
  Playwright Test. Решить на этапе фичи.

---

## Q: что обычно используют вайбкодеры для тестирования UI в Electron

Обычно вайбкодеры используют Playwright — он лучше всего подходит для цикла
«агент изменил UI → запустил приложение → нажал элементы → сделал скриншот →
исправил». Electron официально показывает интеграцию через `_electron.launch()`,
хотя поддержка Electron всё ещё обозначена как experimental.

### Типичный стек

**1. Playwright — реальные E2E-тесты Electron**

Он запускает настоящее Electron-приложение и получает доступ к его окнам:

```ts
import { test, expect, _electron as electron } from '@playwright/test';

test('создание нового проекта', async () => {
  const app = await electron.launch({
    args: ['dist/main.js'],
  });

  const window = await app.firstWindow();

  await window.getByRole('button', {
    name: 'Новый проект',
  }).click();

  await expect(
    window.getByRole('heading', { name: 'Создание проекта' }),
  ).toBeVisible();

  await app.close();
});
```

Через `electronApp.evaluate()` агент также может обращаться к main process,
например проверять IPC, состояние приложения или вызывать тестовые методы.

**2. Playwright MCP или CLI — чтобы агент сам исследовал UI**

Для обычного веб-рендерера вайбкодеры подключают к Claude Code, OpenCode,
Cursor и другим агентам:

```
npx @playwright/mcp@latest
```

Либо более новый CLI-подход:

```
npm i -g @playwright/cli@latest
```

Агент видит accessibility tree, находит кнопки и поля, кликает по ним и
проверяет результат. Microsoft сейчас отдельно рекомендует CLI + skills для
coding-агентов как более экономный по контексту вариант, а MCP — для длительных
интерактивных сессий.

Но MCP обычно работает с браузером, а не напрямую запускает Electron. Поэтому
удобная схема такая:

- в dev-режиме renderer доступен через http://localhost:5173;
- агент исследует его через Playwright CLI/MCP;
- финальные проверки выполняются через Playwright Test с `_electron.launch()`.

**3. Screenshot-тесты**

Очень популярны именно при вайбкодинге:

```ts
await expect(window).toHaveScreenshot('main-window.png', {
  maxDiffPixels: 100,
});
```

Playwright сохраняет эталонный скриншот, а при следующих запусках сравнивает UI
с ним. Важно запускать такие тесты в одинаковом окружении: ОС, шрифты и версия
Chromium могут менять рендеринг.

**4. Vitest для компонентов и логики**

Если Electron-приложение на React/Vite:

```
npm install -D vitest @testing-library/react
```

Им обычно проверяют компоненты, Zustand-сторы, преобразование данных,
IPC-обёртки и хуки. Vitest Browser Mode позволяет запускать компонентные тесты
в настоящем браузере, а не только через JSDOM.

### Что я бы поставил в твой Electron-проект

```
Vitest
├── чистая бизнес-логика
├── React-компоненты
└── IPC с замоканным preload API

Playwright
├── запуск Electron
├── основные пользовательские сценарии
├── скриншоты ключевых экранов
└── проверка нескольких окон

Playwright CLI / MCP
└── агент самостоятельно исследует UI во время разработки
```

Для начала достаточно 5–10 Playwright smoke-тестов:

- приложение запускается
- создаётся проект
- открывается существующий проект
- работает навигация
- сохраняются настройки
- отправляется сообщение агенту
- ошибка API отображается нормально
- приложение восстанавливает состояние после перезапуска

Не стоит брать Spectron — Electron официально прекратил его поддержку ещё в
феврале 2022 года.

Единственное заметное ограничение: Playwright не перехватывает системные
Electron-диалоги вроде `dialog.showOpenDialog()`, потому что они вызываются в
main process. Их обычно мокают в тестовом режиме или отдельно проверяют
минимальным интеграционным тестом.

Итого для вайбкодинга: Playwright + screenshot assertions + Playwright
CLI/MCP; Vitest — вторым слоем.

## Q: а скриншоты проверяют, да?

Да. Обычно проверяют двумя способами:

**1. Автоматическое сравнение скриншотов**

Playwright сохраняет эталон и сравнивает с новым:

```ts
await expect(window).toHaveScreenshot('main-window.png');
```

Если кнопка уехала, текст обрезался или изменился layout — тест покажет diff.

**2. Просмотр скриншота AI-агентом**

Агент открывает приложение, делает скриншот и визуально оценивает: «модалка
перекрыта», «слишком большой отступ», «кнопка не видна». Это менее
детерминировано, зато хорошо ловит очевидно плохой UI.

Обычно сочетают:

- accessibility/DOM-проверки — элемент существует и доступен;
- скриншоты — внешний вид не сломался;
- действия Playwright — пользовательский сценарий реально работает.

Но весь UI скриншотами покрывать не стоит: они часто флапают из-за шрифтов,
анимаций, дат, курсора и различий ОС. Лучше делать снимки ключевых экранов и
отдельных стабильных компонентов.

## Q: как реализуются оба способа? может есть конкретные рекомендации конкретных людей

Да. На практике это два разных контура проверки, которые лучше запускать
вместе:

- Pixel diff отвечает: «UI изменился относительно утверждённого эталона?»
- AI-review скриншота отвечает: «UI выглядит сломанным, неудобным или визуально
  неаккуратным?»

### 1. Автоматическое сравнение скриншотов

Playwright запускает Electron, проходит пользовательский сценарий и сравнивает
полученное изображение с baseline-файлом. При первом запуске baseline создаётся,
при последующих — вычисляется отличие. Playwright рекомендует создавать baseline
в том же окружении, где будут выполняться тесты, поскольку ОС, шрифты, версия
Chromium и графическое окружение влияют на рендеринг.

**Установка**

```
npm install -D @playwright/test playwright
```

**Fixture для Electron**

```ts
// tests/electron.fixture.ts

import {
  test as base,
  expect,
} from '@playwright/test';

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from 'playwright';

type ElectronFixtures = {
  electronApp: ElectronApplication;
  appWindow: Page;
};

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      // Замени на entry point своего Electron main process.
      args: ['dist/main/index.js', '--e2e'],

      env: {
        ...process.env,
        NODE_ENV: 'test',
        E2E: '1',
      },
    });

    await use(app);
    await app.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    await window.waitForLoadState('domcontentloaded');

    // Дожидаемся загрузки шрифтов.
    await window.evaluate(async () => {
      await document.fonts.ready;
    });

    // Убираем источники случайных кадров.
    await window.addStyleTag({
      content: `
        *,
        *::before,
        *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          caret-color: transparent !important;
        }
      `,
    });

    await use(window);
  },
});

export { expect };
```

Playwright официально поддерживает запуск Electron через `_electron.launch()`,
получение окна через `firstWindow()` и управление main process через
`electronApplication.evaluate()`. Поддержка Electron при этом всё ещё отмечена
как experimental.

**Сам визуальный тест**

```ts
// tests/settings.visual.spec.ts

import { test, expect } from './electron.fixture';

test('экран настроек', async ({ appWindow }) => {
  await appWindow
    .getByRole('button', { name: 'Настройки' })
    .click();

  await expect(
    appWindow.getByRole('heading', { name: 'Настройки' }),
  ).toBeVisible();

  const screen = appWindow.getByTestId('settings-screen');

  await expect(screen).toHaveScreenshot(
    'settings-screen.png',
    {
      animations: 'disabled',
      caret: 'hide',

      // Разрешаем изменение максимум 0,1% пикселей.
      maxDiffPixelRatio: 0.001,

      // Динамические данные не участвуют в сравнении.
      mask: [
        appWindow.getByTestId('current-time'),
        appWindow.getByTestId('user-avatar'),
      ],
    },
  );
});
```

Лучше снимать конкретный экран или компонент, а не всё окно приложения. Так
меньше шумят sidebar, часы, уведомления и системные элементы.

**Создание baseline**

```
npx playwright test tests/settings.visual.spec.ts \
  --update-snapshots
```

Полученные PNG нужно положить в Git и проверять изменения baseline как обычный
code review. Именно это рекомендует документация Playwright.

Обычный запуск:

```
npx playwright test
```

При несовпадении Playwright сохранит ожидаемый, фактический и diff-скриншоты.

**Что обязательно стабилизировать**

Фиксируй:

- размер окна;
- ОС и набор шрифтов;
- тестовые данные;
- дату и время;
- язык интерфейса;
- тему;
- масштаб;
- анимации;
- состояние загрузки.

Например, нативные Electron-диалоги нужно мокать через main process:

```ts
await electronApp.evaluate(({ dialog }) => {
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: ['/tmp/test-project'],
  });
});
```

Playwright прямо рекомендует подменять `dialog.showOpenDialog()` и аналогичные
методы, поскольку браузерная автоматизация не может управлять системными окнами
детерминированно.

Не стоит автоматически обновлять baseline в CI. Иначе агент может сломать UI,
обновить эталон и получить зелёный тест.

### 2. Проверка скриншота AI-агентом

Здесь нет строгого pixel diff. Агент открывает UI, совершает действия, делает
скриншот и оценивает его по критериям:

- нет ли наложения элементов;
- не обрезан ли текст;
- понятна ли визуальная иерархия;
- не потерялись ли кнопки;
- корректен ли скролл;
- не выглядит ли экран пустым или перегруженным;
- соответствуют ли отступы и размеры референсу.

**Наиболее практичный вариант для OpenCode**

Для renderer-процесса запускаешь обычный Vite-сервер:

```
npm run dev:renderer
```

А Playwright MCP подключаешь к OpenCode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "playwright": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "@playwright/mcp@latest"
        ]
      }
    }
  }
}
```

Текущая документация OpenCode прямо показывает Playwright MCP в качестве
конфигурации MCP-сервера; OpenCode также умеет принимать изображения как
контекст.

Playwright MCP работает прежде всего с браузером, поэтому я бы разделил
проверки:

```
Renderer UI
└── Vite URL + Playwright MCP + AI-review

Настоящий Electron shell
├── Playwright _electron
├── pixel screenshots
└── main-process / IPC проверки
```

То есть агент визуально проверяет renderer на localhost, а финальный E2E-тест
запускает настоящее Electron-приложение.

**Инструкции для агента**

Добавь в AGENTS.md:

```md
## UI verification

After changing renderer UI:

1. Start the renderer with `npm run dev:renderer`.
2. Open it through Playwright.
3. Verify the affected user flow, not only the initial page.
4. Check the UI at 1280x800 and 1600x900.
5. Check normal, empty, loading and error states when relevant.
6. Capture screenshots of every affected state.
7. Review screenshots using `docs/ui-review.md`.
8. Run Playwright and Vitest tests.
9. Do not declare the task complete while high-severity UI issues remain.
10. Never update visual baselines merely to make a test pass.
```

А в docs/ui-review.md:

```md
# UI review criteria

Fail the review when:

- text is clipped or overlaps another element;
- an important control is outside the visible area;
- horizontal scrolling appears unexpectedly;
- modal content cannot be reached;
- loading, empty or error states are missing;
- the primary action is visually unclear;
- spacing or alignment visibly breaks the existing design system;
- keyboard focus is hidden;
- interaction produces a different state from the specification.

For every issue report:

- severity: critical, major or minor;
- affected screen;
- visible evidence;
- expected behavior;
- suggested correction.
```

**Отдельный reviewer-субагент**

Лучше, чтобы UI писал один агент, а проверял другой:

```md
<!-- .opencode/agents/ui-reviewer.md -->

---
description: Reviews UI through Playwright without editing code
mode: subagent
permission:
  edit: deny
  bash: allow
---

You are a strict UI evaluator.

Open the running application through Playwright.
Exercise the specified user flow.
Capture screenshots of all relevant states.

Evaluate:
- functionality;
- clipping and overlap;
- layout and spacing;
- visual hierarchy;
- scrolling;
- empty, loading and error states;
- correspondence to reference screenshots.

Return PASS or FAIL.

Do not modify code.
Do not assume that a feature works merely because the page loaded.
Every PASS must include evidence from the executed scenario.
```

OpenCode поддерживает проектные специализированные агенты и позволяет
ограничить reviewer доступом только на чтение и выполнение проверок.

**Цикл работы**

```
Build-agent изменяет UI
        ↓
Playwright выполняет сценарий
        ↓
DOM assertions + screenshot
        ↓
UI-reviewer оценивает изображение
        ↓
FAIL: конкретные замечания
        ↓
Build-agent исправляет
        ↓
Повторная проверка
```

Я бы ограничивал такой цикл тремя попытками, после чего показывал результат
человеку. Иначе агент может бесконечно «полировать» субъективные детали.

### Что рекомендуют конкретные люди

Addy Osmani формулирует это как «proof, not promises»: агент должен не просто
сказать, что всё работает, а предоставить тесты, логи, скриншоты и результаты.
При этом AI-review должен оставаться первым фильтром, а не окончательным
арбитром. Он также рекомендует небольшие, инкрементальные изменения.

В другой своей статье Османи пишет, что браузер, логи, скриншоты и test runner
замыкают self-verification loop агента. Он отдельно поддерживает разделение на
generator и evaluator, поскольку агент склонен слишком позитивно оценивать
собственную работу.

Команда Anthropic, описывая harness для длительной разработки приложений,
использовала Playwright MCP: evaluator проходил приложение как пользователь,
проверял UI, API и состояние данных. Для каждого критерия был жёсткий порог;
провал одного критерия означал провал всей итерации. До реализации generator и
evaluator договаривались, что именно означает «готово».

Kent C. Dodds советует тестировать наблюдаемое пользователем поведение, а не
детали реализации. Начинать — с одного E2E happy path для самого критичного
сценария, а остальные случаи закрывать преимущественно интеграционными
тестами. Это хороший аргумент против сотен хрупких full-screen snapshots.

Simon Willison обращает внимание на новую проблему: агент способен очень
быстро создать убедительные тесты и документацию, поэтому само наличие
красивой test suite ещё не доказывает качество. Для него важный сигнал —
реальное использование приложения и фактическое прохождение сценариев.

Официальная рекомендация OpenAI для AI-разработки frontend почти дословно
совпадает с этим подходом: давать агенту несколько референсных состояний,
открывать UI через Playwright, проверять разные размеры окна и итеративно
сравнивать реализацию со скриншотами.

### Что я бы выбрал для твоего Electron-проекта

```
Vitest + Testing Library
├── компоненты
├── состояние
└── preload API / IPC wrappers

Playwright Electron
├── 5–10 основных пользовательских сценариев
├── IPC и перезапуск приложения
└── нативные особенности Electron

Visual regression
├── 10–20 стабильных экранов/компонентов
├── baseline в Git
└── ручное подтверждение изменений baseline

Playwright MCP + UI-reviewer
├── после каждого заметного UI-изменения
├── normal/loading/empty/error states
└── субъективные визуальные дефекты
```

Главное правило: pixel diff является автоматическим gate, AI-review —
диагностическим reviewer, человек утверждает намеренные визуальные изменения.
