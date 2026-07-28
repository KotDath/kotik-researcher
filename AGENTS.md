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

После любого изменения кода `pnpm typecheck` и `pnpm lint` обязаны проходить.

## Структура

```
src/main/       # main-процесс Electron (окна, lifecycle, IPC)
src/preload/    # contextBridge API → window.api
src/renderer/   # React UI (alias @renderer → src/renderer/src)
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
