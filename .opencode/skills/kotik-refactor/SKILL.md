---
name: kotik-refactor
description: Проводит доказательный behavior-preserving рефакторинг существующего кода через анализ smells, invariants, characterization tests и независимое review. Use when пользователь просит отрефакторить, убрать дублирование, разделить модуль, распутать зависимости или улучшить внутреннюю структуру без изменения наблюдаемого поведения. NOT FOR исправления дефекта (kotik-bugfix), изменения поведения (kotik-small-change), новой capability (kotik-feature), dependency upgrade или миграции формата данных.
---

# Refactor

1. Объявить профиль и определить область. Широкий аудит ограничить одним
   контуром (`ui`, `core`, `data`, `agentic`); не аудитить весь repo.
2. Делегировать Sol/medium refactor-analyst. Потребовать evidence-backed
   verdict, один рекомендуемый structural goal, invariants, scope/non-goals и
   предварительное `Implementation: standard|deep`.
3. При `NO_JUSTIFIED_REFACTOR` остановиться. При `RECLASSIFY` переключить
   профиль. Не маскировать изменение поведения под refactor.
4. Показать рекомендацию пользователю и подтвердить scope до specification.
5. Small/standard → spec-writer-fast. Normal/large/deep → solution-architect
   создаёт design.md, затем spec-writer-deep. Change содержит proposal.md,
   invariants.md, decisions.md и tasks.md; capability deltas не создаются.
6. Зафиксировать baseline: `pnpm typecheck`, `pnpm lint`, `pnpm build` и
   релевантные тесты. При пробеле test-author сначала пишет characterization
   tests текущего поведения. Не принимать необъяснённый красный baseline.
7. Перед approval окончательно оценить implementation complexity. Strong:
   сложная concurrency/lifecycle/recovery state machine; формальные инварианты;
   необратимый data-risk; атомарность между слоями; связный контекст, который
   небезопасно дробить. Medium: нетривиальный SDK lifecycle; несколько
   failure/retry механизмов; тесное renderer+main+storage изменение; алгоритм
   с множеством edge cases. Один strong или два medium → deep.
8. После явного approve: standard выполняет Flash implementer с возможностью
   вызвать technical-consultant; deep выполняет K3 implementer-deep без него.
9. Reviewer проверяет сохранение invariants и достижение structural goal.
   Попутное изменение поведения — blocker.
10. Для user flow вызвать app-tester; при renderer/both — ui-reviewer. Новая
    visual grammar означает reclassify, а не refactor.

Если реализация требует изменить invariant, остановить код, переклассифицировать
change и получить новое approval.
