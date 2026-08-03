---
name: kotik-approve
description: Принимает текущую стадию SDD-цикла — утверждает спеку и запускает реализацию, либо принимает готовую реализацию и архивирует change. Use when пользователь говорит «принимаю», «аппрув», «одобряю», «готово», «архивируй», «выкатывай», или явно вызывает /kotik-approve. NOT FOR начала новой фичи (kotik-feature) и исследований (kotik-research). ПЕРЕД ЛЮБЫМ переходом всегда запрашивает явное подтверждение пользователя.
---

# kotik-approve — переходы стадий SDD-цикла

## 0. Предохранитель (всегда первым)

Approve активируется неявно, а переходы необратимы (архивация). Перед любым
переходом — явное подтверждение через question tool: «понял как приёмку
стадии <какой> change <какого> — подтверждаете?». Без подтверждения ничего
не выполнять.

## Определение стадии

Перечитать файлы на диске, не полагаться на память. Если активный change не
один — уточнить у пользователя, о каком речь.

## Стадия draft → approved (утверждение спеки)

### Preflight-гейты (при провале — не начинать реализацию)

1. Артефакты на месте: proposal.md, decisions.md, tasks.md и профильный
   контракт: deltas/ для behavior-change либо invariants.md для refactor.
2. Для behavior-change у каждого требования в дельтах есть хотя бы один
   сценарий (`#### Scenario:`). Для refactor у каждого invariant есть
   verification. Нет → вернуть тому же spec-writer-fast/deep.
3. Секция «Открытые вопросы» в proposal пуста или удалена. Нет → показать
   вопросы пользователю и уточнить, закрыты ли.
4. `pnpm typecheck` зелёный — implementer не должен начинать на сломанной
   базе.

### Переход

1. Сменить Status на `approved`.
2. Создать `agent-sessions.md` change и фиксировать там роль → task_id.
3. Прочитать `Implementation` из proposal (`standard` для legacy): standard →
   Flash implementer; deep → K3 implementer-deep без technical-consultant.
   K3 bootstrap-implementer допустим только при записанном подтверждении
   greenfield/bootstrap.
4. При необходимости делегировать test-author написание недостающих
   automated tests. Фиксированные pnpm-команды выполняются напрямую по
   tasks.md; LLM test-runner не создавать.
5. Делегировать reviewer (`GPT-5.6 Sol / medium`), затем app-tester для
   изменённого user flow. При renderer/both после функциональной проверки
   делегировать ui-reviewer; при новой visual grammar до него может
   работать ui-designer.
6. Для formal-logic/inference changes дополнительно вызвать logic-reviewer.
7. На blocker/major reviewer выбранный implementer отвечает
   `ACCEPT | DISPUTE | PRE_EXISTING` с evidence. ACCEPT → тот же implementer
   исправляет; DISPUTE → оркестратор adjudicates, архитектурный спор
   возвращает архитектору. Minor/advisory не блокируют автоматически.
8. Повторять необходимые проверки максимум 3 цикла, затем эскалировать
   пользователю. После 2+ циклов финальный reviewer запускается свежим.
9. После APPROVE — зафиксировать вердикт на диске: строка
   `Review: APPROVE YYYY-MM-DD` в proposal.md (заменив прошлую строку
   Review, если была; CHANGES_REQUESTED фиксировать аналогично). Вердикт
   в чате не переживает сессию — на диске переживает.
10. Доложить: что реализовано, вердикты reviewer/app-tester/ui-reviewer и
   список «что проверить руками». Сказать явно: «проверьте и примите через /kotik-approve или
   напишите, что доделать».

## Стадия approved → done (приёмка и архивация)

### Preflight-гейты

1. Все чекбоксы в tasks.md — `[x]`. Нет → приёмка преждевременна.
2. В proposal.md есть строка `Review: APPROVE <дата>`. Нет строки или
   последний вердикт CHANGES_REQUESTED → ревью не зафиксировано: сначала
   делегировать reviewer проверку и записать вердикт, архивация без
   APPROVE на диске запрещена.

### Рефлексия (только если были сигналы)

Сигналы: CHANGES_REQUESTED в этом цикле / блокер implementer'а / коррекция
результата пользователем текстом / отклонение от спеки. Не было — пропустить
молча.

Если были: сформулировать урок (prevention-правило + почему) и спросить:
«вшиваем урок в docs/LESSONS.md?». При «да» — новая запись LRN-дата-NNN или
Recurrence-Count +1 существующей (обновить Last-Seen).

Promotion: урок с Recurrence-Count ≥ 3, из ≥ 2 разных changes, в окне
30 дней → предложить дистиллировать в правило в AGENTS.md или промпт
агента. При «да» — внести правило, уроку статус `promoted`.

### Архивация

1. Для behavior-change смерджить дельты в specs/capabilities/ по правилам
   specs/README.md
   (ADDED → добавить, MODIFIED → заменить, REMOVED → удалить,
   RENAMED → переименовать; новая capability — с Purpose). Для refactor без
   изменения поведения capabilities не менять.
2. Status → `done`, перенести папку в specs/changes/archive/YYYY-MM-DD-<имя>/.
3. Доложить: какие capability обновлены, куда перенесён change, какие уроки
   записаны/промоутированы.
