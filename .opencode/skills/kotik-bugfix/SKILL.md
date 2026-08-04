---
name: kotik-bugfix
description: Диагностирует и исправляет наблюдаемый дефект через root-cause и regression-first workflow. Use when что-то сломано, падает, работает не по текущей capability/spec или пользователь сообщает воспроизводимую ошибку. NOT FOR behavior-preserving структурного рефакторинга (kotik-refactor), новую возможность (kotik-feature), косметическую правку без дефекта (kotik-small-change) или самостоятельное исследование.
---

# Bugfix

1. Объявить профиль и делегировать diagnostician: reproducer, evidence,
   root cause, impact contours, regression scenario.
2. Если выяснилось, что ожидаемого поведения нет в capability/spec,
   переключиться на feature: это не bugfix.
3. Оценить semantic risk. При migration/data identity/provenance,
   embeddings, nested workflow, permissions, formal logic или
   architecture conflict привлечь solution-architect и
   spec-writer-deep. Иначе использовать spec-writer-fast.
4. Предварительно оценить implementation complexity, после root cause/tasks
   оценить повторно. Один strong или минимум два medium сигнала из правил
   orchestrator → `deep`, иначе `standard`.
5. Создать компактный change с routing card `Profile: bugfix`,
   `Implementation` и signals; обязательны proposal, delta, decisions и tasks.
   Перечитать draft и показать полный Spec review packet по контракту
   orchestrator: root cause, требования, regression, порядок исправления и
   проверки. После каждой коррекции показать заново; только затем получить
   approval до изменения src.
6. Test-author пишет regression test, когда дефект можно стабильно
   автоматизировать. Тест до исправления должен доказуемо падать.
7. Standard исправляет Flash implementer и при локальном затыке может вызвать
   technical-consultant. Deep исправляет K3 implementer-deep без consultant.
8. Выполнить deterministic checks, reviewer Sol/medium и app-tester для
   пользовательского flow. При renderer/both добавить ui-reviewer.
9. На blocker/major выбранный implementer отвечает
   `ACCEPT | DISPUTE | PRE_EXISTING` с evidence.

Research допускается как вложенный шаг диагностики или архитектуры, если
конкретный внешний факт блокирует решение.
