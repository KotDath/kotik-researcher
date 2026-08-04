# Decision Log

Обозначения:

- **Закреплено** — считаем частью целевой концепции.
- **Рабочая гипотеза** — направление принято, но конкретная реализация требует проверки.
- **Открыто** — решение пока не принято.

## Закреплено

1. Названия: `kotik`, `kotik-researcher`, позднее возможен `kotik-coder`.
2. `kotik-researcher` — первый реальный consumer и полигон развития `kotik`.
3. Цель — зрелая расширяемая самоулучшающаяся среда, а не только MVP и не генератор одноразовых отчётов.
4. Главный артефакт — версионированное research state.
5. Research workflow должен быть evidence-oriented и воспроизводимым.
6. Поддерживаются режимы `explore`, `evidence` и `review` как разные policies одного workflow.
7. Источники объединяются в `ResearchObject`; PDF не является основной единицей знания.
8. Весь discovery и screening сохраняют provenance, запросы, причины решений и audit log.
9. Глубина обработки документа адаптивна; таблицы, рисунки, OCR и ручная проверка включаются по необходимости.
10. Knowledge graph является центральной рабочей моделью зрелой системы.
11. Graph knowledge всегда производен от source artifacts и evidence; автоматически извлечённый claim не становится истиной.
12. Knowledge, experience и policy — разные слои.
13. Память разделяется на semantic, episodic, procedural и user memory.
14. Планирование итеративно и связано с hypotheses, contradictions и gaps.
15. Reflection создаёт проверяемые improvement proposals.
16. Learning layer отделён от runtime; runtime работает без него.
17. RL допустим и желателен, но policy проходит offline/replay evaluation, versioning и controlled promotion.
18. Награда оценивает качество исследования, а не только убедительность финального текста.
19. Workers предпочтительно используют ветвящийся общий контекст; постоянный зоопарк ролей не обязателен.
20. Coverage audit и явный остаточный риск пропуска обязательны.
21. Зафиксирован стек: TypeScript + Pi SDK для agent runtime, Electron + React для desktop UI и отдельная Python-песочница для вычислений.
22. Приложение проектируется как self-contained local-first: базовый сценарий не требует обязательного внешнего backend, отдельного сервера БД или ручной установки Python.
23. Основной workspace состоит из Project navigator, центрального Content canvas и докируемой панели агента.
24. В пустом проекте допустим chat-first onboarding; после появления research state центральный акцент переходит к Content canvas.
25. Важные результаты диалога превращаются в типизированные объекты или события и не остаются только в chat history.
26. Длительная работа опирается на events, snapshots, branches, resume и сравнение версий исследовательского состояния.
27. Математические формулы и научная разметка должны одинаково отображаться в чате, заметках, evidence и отчётах.
28. Качество источника оценивается многомерным проверяемым профилем; единый непрозрачный балл «научности» не является источником истины.
29. Основной CS test case — utility-based forgetting для long-horizon LLM-агентов.

## Рабочие гипотезы

1. Knowledge graph будет состоять как минимум из source/artifact, evidence, claim, concept и hypothesis/gap слоёв.
2. Каноническое состояние удобно хранить в relational/event store, а graph/full-text/vector представления делать согласованными индексами.
3. Раннюю практическую пользу обучения дадут learning-to-rank и contextual bandits до полноценного offline RL.
4. Графовые признаки coverage и uncertainty станут частью состояния RL policy.
5. Hypothesis manager практичнее отдельного статичного planner.
6. Первый вертикальный срез должен затронуть весь цикл: discovery → evidence → graph → synthesis → trajectory → reflection.
7. Локальное хранение сочетает project directory, SQLite canonical/event store, content-addressed artifacts, индексы и Git-backed history.
8. Для интерактивного математического рендеринга используется локально упакованный KaTeX, а базовый PDF-экспорт выполняет встроенный Chromium.
9. Второй эталонный test case исследует каноничность систем монет вида `{1, a, b}`.

## Открытые решения

1. Физическое хранение графа: SQLite edges, RDF, property graph или отдельная graph DB после проверки начального SQLite-подхода.
2. Начальная онтология и правила её расширения между дисциплинами.
3. Механизм temporal/versioned graph и пересчёта зависимых выводов.
4. Формальная модель confidence, independence и source/result quality.
5. Способ автоматического entity resolution и пороги ручной проверки.
6. Набор benchmark-задач для coverage, screening, evidence extraction и end-to-end research.
7. Конкретные алгоритмы memory consolidation, retrieval и forgetting для диссертации.
8. Политика human checkpoints в каждом режиме.
9. Детальная информационная архитектура workspace и UX редактирования графа.
10. Пакетирование Python runtime и изоляция воспроизводимых окружений.
11. Окончательная постановка и ground truth математического test case.

## Следующее архитектурное решение

Следующим стоит подробно проиграть основной CS-сценарий в workspace, а затем
спроектировать минимальную доменную схему knowledge graph:

```text
ResearchObject
Artifact
ArtifactLocation
Evidence
Claim
Concept
Hypothesis
ResearchQuestion
SearchRun
ScreeningDecision
VerificationRecord
SynthesisSnapshot
Trajectory
PolicyVersion
```

Для каждой сущности нужно определить identity, versioning, provenance, обязательные поля и допустимые relations. Это превратит общую концепцию в основу реализации, не привязываясь преждевременно к конкретной базе данных.
