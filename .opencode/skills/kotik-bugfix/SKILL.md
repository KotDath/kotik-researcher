---
name: kotik-bugfix
description: Диагностирует и исправляет наблюдаемый дефект через root-cause и regression-first workflow. Use when что-то сломано, падает, работает не по текущей capability/spec или пользователь сообщает воспроизводимую ошибку. NOT FOR новую возможность (kotik-feature), косметическую правку без дефекта (kotik-small-change) или самостоятельное исследование.
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
4. Создать компактный change с routing card `Profile: bugfix`; получить
   явное approval до изменения src.
5. Test-author пишет regression test, когда дефект можно стабильно
   автоматизировать. Тест до исправления должен доказуемо падать.
6. Flash implementer исправляет root cause, не симптом. При локальном
   сложном затыке может вызвать technical-consultant.
7. Выполнить deterministic checks, reviewer Sol/medium и app-tester для
   пользовательского flow. При renderer/both добавить ui-reviewer.
8. На blocker/major reviewer implementer отвечает
   `ACCEPT | DISPUTE | PRE_EXISTING` с evidence.

Research допускается как вложенный шаг диагностики или архитектуры, если
конкретный внешний факт блокирует решение.
