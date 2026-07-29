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
- `pnpm test:e2e:quick` — Playwright E2E на dev-сборке (main/preload собраны, renderer — dev-server)
- `pnpm test:visual` — visual regression против baseline
- `pnpm test:agent:electron` — приложение с CDP :9222 для агентской проверки
- `pnpm test:agent:dev` — Electron dev с CDP :9222 для быстрой проверки

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

- **Спека до кода — только для `src/`.** Используй профиль
  `/kotik-small-change`, `/kotik-bugfix` или `/kotik-feature`; код — только
  после `Status: approved`. Переделка спеки
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
| orchestrator | K3: диалог, выбор профиля, SDD, консилиум, делегирование |
| ideator-fast / ideator-deep | Flash/Pro: vision малой или сложной фичи |
| solution-architect | Pro: владелец design.md |
| architecture-reviewer | Sol/high: независимая критика design |
| implementation-planner / test-strategist / security-reviewer | специализированные участники консилиума |
| spec-writer-fast / spec-writer-deep | Flash/Pro: проверяемые proposal/deltas/tasks |
| diagnostician | Flash: root-cause bugfix |
| implementer | Flash: код зрелого проекта по tasks.md |
| technical-consultant | K3: редкая read-only помощь implementer'у |
| reviewer | всегда GPT-5.6 Sol/medium: code/spec verdict |
| test-author | Flash: пишет automated regression/E2E tests |
| app-tester | Flash: black-box кликает live app через Playwright/CDP |
| ui-designer / ui-reviewer | K3: visual polish / независимый visual verdict |
| logic-reviewer | Sol/high: formal logic и inference semantics |
| founding-architect / bootstrap-implementer | K3 только для подтверждённого greenfield/bootstrap |
| researcher | Pro: формулировка вопросов и синтез; по умолчанию ответ в чат |
| reflector | ретроспектива сессий → prevention-правила |
| web-explore | листовой веб-воркер researcher'а (факты по подвопросу) |

Каждый субагент явно задаёт `model` (и `variant`, когда применимо) в своём
`.opencode/agents/*.md`; иначе он унаследует K3 оркестратора. Встроенный
explore — единственное исключение, его Flash-модель закреплена в
opencode.json.

Команды: `/kotik-small-change`, `/kotik-bugfix`, `/kotik-feature`,
`/kotik-approve`, `/kotik-research`, `/kotik-reflect`. Команды — явные триггеры одноимённых
скиллов из `.opencode/skills/`; скиллы активируются и неявно, по смыслу
запроса (кроме approve-переходов — они всегда требуют подтверждения).

Субагенты могут спавнить субагентов (`subagent_depth: 4` в opencode.json) —
запас на цепочки вида orchestrator → reflector/researcher → explore-воркеры.
Кто кого может спавнить, по-прежнему режет `permission.task` каждого агента.

Конвенции спек: [specs/README.md](specs/README.md).

## App и UI verification

Корректные данные не гарантируют корректный рендер (LRN-20260729-001).
Изменённый пользовательский flow проходит black-box проверку app-tester.
Каждый change, затрагивающий renderer, дополнительно проходит независимое
visual review. Playwright MCP зарегистрирован в opencode.json:

- **Быстрый:** `pnpm test:agent:dev` запускает Electron dev с CDP :9222.
- **Полный:** `pnpm test:agent:electron` запускает живой
  Electron с CDP :9222, изолированный userData с сид-данными — реальные
  проекты и API-ключи агенту недоступны. Оба используют MCP `playwright`
  с `--cdp-endpoint :9222`.

Контракт implementer'а: в отчёте оркестратору implementer обязан указать
строки `Change touches: renderer|main|both` и
`Contours: ui|core|data|agentic` по анализу своего диффа. При
`renderer`/`both` UI-верификация обязательна.

После изменения renderer UI:

1. Implementer выполняет deterministic checks из tasks.md.
2. App-tester проходит затронутый flow и проверяет поведение.
3. Ui-reviewer независимо оценивает визуальный результат. При новой visual
   grammar перед ним может работать ui-designer.
4. Проверять затронутый user flow, не только начальную страницу.
5. Проверять UI при 1280x800 и 1600x900 (когда релевантно).
6. Проверять normal, empty, loading и error-состояния.
7. Захватывать скриншоты каждого затронутого состояния.
8. Сверять скриншоты с критериями [docs/ui-review.md](docs/ui-review.md).
9. Не объявлять задачу завершённой при наличии high-severity UI-проблем.
10. Никогда не обновлять visual baseline только ради прохождения теста —
   baseline обновляется только вручную (`--update-snapshots`), агенту
   запрещено (см. docs/ui-review.md).
11. Critical/major FAIL ui-reviewer = hard gate. Minor/advisory замечания
    фиксируются, но не блокируют approve автоматически.
12. Generator/evaluator цикл (implementer/ui-designer чинит → независимые
    app-tester/ui-reviewer проверяют):
    максимум 3 итерации; после 3-го FAIL оркестратор эскалирует к человеку
    с контекстом всех трёх проверок.

## Полнота vision.md (протокол идеатора)

vision.md обязан покрывать: цель и границы; контуры `ui/core/data/agentic`;
пользовательские и вложенные workflow; UI/UX; данные/provenance; агентное
поведение и human approvals; риски и компромиссы; failure modes; критерии
приёмки; открытые вопросы. Оркестратор проверяет карту до архитектуры/spec.
