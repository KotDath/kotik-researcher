# Kotik Researcher

Агентная AI-система для помощи в исследовательских задачах. Desktop-приложение
на Electron.

## Стек

- Electron + electron-vite (сборка main/preload/renderer)
- React 19 + TypeScript (strict)
- pnpm

## Команды

- `pnpm dev` — запуск с HMR
- `pnpm build` — сборка в `out/`
- `pnpm typecheck` — проверка типов (node + web конфиги)
- `pnpm lint` — ESLint (flat config)
- `pnpm test` — все слои: unit + e2e + visual
- `pnpm test:unit` — Vitest (node + web/jsdom проекты)
- `pnpm test:e2e` — Playwright E2E на свежей production-сборке
- `pnpm test:e2e:quick` — Playwright E2E на dev-сборке без пересборки
- `pnpm test:visual` — visual regression против baseline
- `pnpm test:agent:electron` — приложение с CDP :9222 для агентской проверки
- `pnpm test:agent:dev` — инструкция быстрого режима (dev-server + MCP)

После любого изменения кода `pnpm typecheck` и `pnpm lint` обязаны проходить.

## Структура

```
src/main/       # main-процесс Electron (окна, lifecycle, IPC)
src/preload/    # contextBridge API → window.api
src/renderer/   # React UI (alias @renderer → src/renderer/src)
tests/          # тесты: unit/ (Vitest), e2e/ и visual/ (Playwright)
specs/          # SDD: спеки и изменения (см. specs/README.md)
research/       # отчёты исследований
docs/           # документация системы агентов (LESSONS.md и др.)
```

## Куда что кладём (routing table)

| Тип | Куда |
|---|---|
| Код приложения | `src/` |
| Спеки, changes, шаблоны | `specs/` |
| Исследовательские отчёты | `research/` (YYYY-MM-DD-<тема>.md) |
| Уроки из инцидентов | `docs/LESSONS.md` (grep по теме, не читать целиком) |
| Отложенные методики системы агентов | `BACKLOG.md` |
| Конфиги агентов | `.opencode/agents/` |
| Workflow-процедуры (скиллы) | `.opencode/skills/` |
| Команды (триггеры скиллов) | `.opencode/commands/` |

Корень — не хранилище: исключения только AGENTS.md и BACKLOG.md.

## Hard rules (и почему)

- **Спека до кода — только для `src/`.** Фича приложения начинается с
  `/kotik-feature`, код — только после `Status: approved`. Переделка спеки
  стоит минуты, переделка кода — часы. Изменения самой системы агентов
  (`.opencode/`, AGENTS.md, docs/) SDD-спеки не требуют — они меняются
  напрямую, по согласованному с пользователем плану.
- **Оркестратор не пишет код.** Решения и исполнение разделены, чтобы ревью
  было независимым (настроено через permissions).
- **Состояние на диске, не в чате.** Status в proposal.md, чекбоксы в
  tasks.md, правда в specs/capabilities/. Сессия может прерваться — диск
  помнит всё.
- **Без новых зависимостей без необходимости.** Сначала ищем решение на
  текущем стеке. Каждая зависимость — это поддержка и поверхность атаки.

## Агенты

| Агент | Роль |
|---|---|
| orchestrator | диалог, требования, SDD-цикл, делегирование |
| ideator | vision-интервью → vision.md |
| spec-writer | оформление спек по vision.md в `specs/changes/` |
| researcher | веб-исследования → `research/` |
| implementer | код по tasks.md |
| reviewer | проверка кода против спек, вердикт |
| ui-reviewer | проверка живого UI через Playwright MCP, PASS/FAIL (deny:edit) |
| reflector | ретроспектива сессий → prevention-правила |
| web-explore | листовой веб-воркер researcher'а (факты по подвопросу) |

Команды: `/kotik-feature` (новая фича), `/kotik-approve` (принять стадию),
`/kotik-research` (исследование), `/kotik-reflect` (разбор сессий: текущая +
дочерние, либо `--days N`). Команды — явные триггеры одноимённых
скиллов из `.opencode/skills/`; скиллы активируются и неявно, по смыслу
запроса (кроме approve-переходов — они всегда требуют подтверждения).

Субагенты могут спавнить субагентов (`subagent_depth: 4` в opencode.json) —
запас на цепочки вида orchestrator → reflector/researcher → explore-воркеры.
Кто кого может спавнить, по-прежнему режет `permission.task` каждого агента.

Конвенции спек: [specs/README.md](specs/README.md).

## UI verification

Корректные данные не гарантируют корректный рендер (LRN-20260729-001).
Каждый change, затрагивающий renderer, проходит проверку живого UI перед
approve. Два режима агентской верификации (Playwright MCP зарегистрирован
в opencode.json, ручной запуск не нужен):

- **Быстрый (implementer, итерации):** `pnpm test:agent:dev` выводит
  инструкцию — `pnpm dev:renderer`, затем `browser_navigate
  http://localhost:5173` через MCP. Renderer-only: main/IPC не проверяется.
- **Полный (ui-reviewer, финальная):** `pnpm test:agent:electron` (живой
  Electron с CDP :9222) + MCP с `--cdp-endpoint http://127.0.0.1:9222`.
  Реальная main-renderer интеграция.

Контракт implementer'а: в отчёте оркестратору implementer обязан указать
строку `Change touches: renderer` (или `main`, `both`) по анализу своего
диффа. При `renderer`/`both` UI-верификация обязательна.

После изменения renderer UI:

1. Implementer: `pnpm test:unit && pnpm test:e2e:quick`, затем
   `pnpm test:agent:dev` + MCP для быстрой визуальной проверки.
2. Reviewer: запросить ui-reviewer (через оркестратора) для полной
   верификации.
3. Проверять затронутый user flow, не только начальную страницу.
4. Проверять UI при 1280x800 и 1600x900 (когда релевантно).
5. Проверять normal, empty, loading и error-состояния.
6. Захватывать скриншоты каждого затронутого состояния.
7. Сверять скриншоты с критериями [docs/ui-review.md](docs/ui-review.md).
8. Не объявлять задачу завершённой при наличии high-severity UI-проблем.
9. Никогда не обновлять visual baseline только ради прохождения теста —
   baseline обновляется только вручную (`--update-snapshots`), агенту
   запрещено (см. docs/ui-review.md).
10. FAIL ui-reviewer = hard gate для approve: оркестратор не переводит
    change в approved/done, пока ui-reviewer не вернёт PASS.
11. Generator/evaluator цикл (implementer чинит → ui-reviewer проверяет):
    максимум 3 итерации; после 3-го FAIL оркестратор эскалирует к человеку
    с контекстом всех трёх проверок.

## Полнота vision.md (протокол идеатора)

vision.md обязан покрывать ВСЕ измерения карты: Цель и границы, Техническая
реализация, UI/UX, Риски и опасения, Компромиссы, Крайние случаи и failure
modes, Критерии приёмки, Открытые вопросы. Оркестратор проверяет наличие
всех секций перед передачей vision.md spec-writer'у; при неполной карте —
возврат идеатору с указанием пропущенного измерения.
