---
name: kotik-feature
description: Ведёт новую возможность приложения через SDD с выбором small/normal/large, продуктовых контуров, semantic risk и implementation complexity; для large включает консилиум до architecture/spec. Use when пользователь хочет новую capability, новый workflow или существенное расширение поведения. NOT FOR наблюдаемого дефекта (kotik-bugfix), behavior-preserving рефакторинга (kotik-refactor), локальной обратимой правки (kotik-small-change) или чистого research.
---

# Feature

## 1. Routing card

Объявить профиль и классифицировать:

```text
Profile: feature
Size: small | normal | large
Contours: ui | core | data | agentic
Risk: low | medium | high
Implementation: standard | deep
Implementation signals: <конкретные сигналы>
```

Strong large-signals: greenfield/major subsystem; renderer+main+storage;
data migration; security/permissions; breaking IPC/API; неизвестный
external SDK lifecycle; минимум три независимых workstream; труднообратимое
решение. Soft signals: много failure states, concurrency/recovery,
конкурирующие архитектуры, новая visual grammar.

Ориентир: 0–1 сигнал — small, 2–3 — normal, 4+ или один strong — large.
Large требует объяснения и подтверждения пользователя.

Semantic escalators повышают Risk независимо от размера diff:
identity/migrations/provenance, embeddings/reindexing, nested agent
workflow, permissions, formal logic, breaking IPC/API.

Implementation оценить предварительно сейчас и окончательно после design/tasks.
Один strong или минимум два medium сигнала из правил orchestrator → `deep`;
иначе `standard`. Size и Risk не выбирают implementer автоматически.

## 2. Vision

- small low-risk → ideator-fast;
- normal/large или semantic-high → ideator-deep.

Vision обязан закрыть все измерения карты из AGENTS.md. Research разрешён
вложенно только для конкретного внешнего факта, блокирующего решение.

## 3. Architecture

- small low-risk: design.md не нужен;
- normal или semantic-medium/high: solution-architect создаёт design.md;
- large: сначала консилиум, затем solution-architect синтезирует design.md;
- architecture-reviewer обязателен для large/high-risk, для normal — когда
  есть cross-contour design или необратимое решение.

### Консилиум large feature

Запустить независимый первый раунд по одному подтверждённому vision:
solution-architect, architecture-reviewer, implementation-planner,
test-strategist. Добавить security-reviewer при security/data exposure и
ui-designer при новой visual grammar. Researcher закрывает только
конкретные внешние пробелы.

Оркестратор собирает конфликты и отправляет адресные вопросы тем же task_id.
Свободного group chat нет. После второго раунда solution-architect
синтезирует один design.

## 4. Specification

- small low-risk → spec-writer-fast;
- normal/large/semantic-high → spec-writer-deep.

Spec-writer переводит vision/design в proposal/deltas/tasks, но не
принимает архитектурные решения. Показать пользователю proposal,
requirements и задачи. Код не писать до явного `kotik-approve`.

## 5. Implementation and verification

После approval:

1. Standard реализует Flash implementer с доступом к technical-consultant;
   deep реализует K3 implementer-deep без consultant.
2. K3 bootstrap-implementer допустим только для подтверждённого
   greenfield/bootstrap и должен передать стабилизированный каркас Flash.
3. Test-author пишет необходимые automated tests.
4. Фиксированные pnpm-команды выполняются напрямую по tasks.md; отдельный
   LLM test-runner не создаётся.
5. Reviewer Sol/medium проверяет code/spec.
6. App-tester проходит изменённый live flow.
7. Для renderer/both: Flash строит функциональный/семантический каркас;
   ui-designer K3 подключается для новой visual grammar/важного экрана,
   затем независимый ui-reviewer K3.
8. Для formal logic дополнительно вызвать logic-reviewer.

Generator/evaluator цикл ограничен тремя итерациями.
