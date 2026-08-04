# Knowledge Graph

## Решение

Knowledge graph является центральной частью зрелого `kotik-researcher`.

Отказ от него был бы ошибкой. Ограничение относится только к неудачной реализации: нельзя превращать автоматически извлечённый глобальный граф атомарных утверждений в безошибочный источник истины.

Правильная формулировка:

> Knowledge graph — версионированная рабочая модель предметной области, построенная поверх документов, evidence и provenance. Он помогает исследовать, сравнивать, находить пробелы и планировать следующие действия, но не заменяет первичные основания знания.

## Почему граф здесь действительно нужен

Реляционная база и vector search хорошо находят записи и похожие фрагменты, но исследовательская работа требует явных многосвязных отношений:

- один research object имеет несколько reports, versions, supplements, datasets и code artifacts;
- один claim поддерживается несколькими evidence items и оспаривается другими;
- одно evidence зависит от конкретных условий, benchmark и comparator;
- concepts имеют aliases, competing definitions и дисциплинарные контексты;
- hypotheses связаны с claims, gaps, experiments и unresolved questions;
- новая версия работы может supersede старую, а correction или retraction меняют статус связанных выводов;
- несколько публикаций могут не быть независимыми, если используют один dataset или одну исследовательскую группу.

Именно такие переходы позволяют агенту не только найти похожий текст, но и отвечать на структурные вопросы:

- какие claims опираются только на один независимый объект;
- где два результата противоречат друг другу лишь из-за разных условий;
- какие гипотезы затронет retract конкретной работы;
- какие части карты не покрыты первичными источниками;
- какой следующий поиск сильнее всего уменьшит неопределённость.

## Слои knowledge system

### 1. Source and artifact graph

```text
ResearchObject
├── Report
├── Version
├── Supplement
├── Dataset
├── CodeArtifact
├── Correction
└── Retraction
```

Этот слой отвечает на вопрос: «Что именно существовало, в какой версии и как связано?»

### 2. Evidence graph

```text
Evidence
├── extracted_from → ArtifactLocation
├── reports → Result
├── under → Conditions
├── uses → Method/Dataset/Benchmark
├── compares_with → Comparator
├── has_uncertainty → Uncertainty
└── verification → VerificationRecord
```

Evidence неизменно сохраняет точное происхождение. Любой машинный пересказ должен быть обратимо связан с исходным фрагментом, страницей, таблицей, строкой, рисунком или формулой.

### 3. Claim graph

```text
Claim
├── scoped_to → Scope
├── supported_by → Evidence
├── contradicted_by → Evidence
├── qualified_by → Claim/Evidence
├── superseded_by → Claim
└── status → proposed/supported/contested/unresolved/superseded/retracted
```

Claim — нормализованная интерпретация, а не цитата и не вечная истина. Его status вычисляется относительно доступного evidence, версии графа, вопроса и правил оценки.

### 4. Concept graph

```text
Concept
├── alias_of
├── broader_than / narrower_than
├── related_to
├── defined_by
├── conflicts_with_definition
└── used_in_discipline
```

Concept graph нужен для обнаружения одной идеи под разными названиями и для предотвращения ложного объединения терминов разных школ.

### 5. Hypothesis and gap graph

```text
Hypothesis
├── motivated_by → Claim/Observation
├── tested_by → Evidence/Experiment
├── challenged_by → Evidence
├── requires → MissingEvidence
└── decomposes_into → Subhypothesis
```

Этот слой напрямую управляет итеративным планированием. Research agenda должна строиться не только из списка задач, а из текущих гипотез, неопределённостей и пробелов графа.

## Graph — не единственное хранилище

Следует различать:

| Компонент | Роль |
|---|---|
| Object/blob storage | Оригинальные документы, изображения, OCR и артефакты |
| Relational/event store | Канонические записи, версии, транзакции и audit log |
| Knowledge graph | Явные сущности и отношения |
| Full-text index | Точный и лексический поиск |
| Vector index | Семантические кандидаты |

Граф может физически храниться в PostgreSQL или SQLite на раннем этапе и позднее переноситься в graph database. Архитектурная модель графа не требует немедленного выбора отдельной graph DB.

## Защита от загрязнения

Каждый производный узел и edge хранит:

- provenance;
- creator (`parser`, model, rule или человек);
- confidence и uncertainty;
- verification status;
- valid time и system time;
- версию схемы и extraction policy;
- область применимости;
- ссылки на исходные evidence;
- историю исправлений без потери старых версий.

Автоматическое извлечение создаёт `proposed` knowledge. Переход к `supported` или иному статусу выполняется через evidence и правила проверки.

## Как граф участвует в работе агента

Knowledge graph используется не только для визуализации:

1. Pilot map расширяет concept graph.
2. Discovery использует aliases, gaps и citation relations.
3. Screening учитывает покрытие и дубликаты research objects.
4. Reading создаёт evidence subgraphs.
5. Comparison формирует relations между claims и evidence.
6. Coverage audit выполняет структурные запросы к графу.
7. Hypothesis manager выбирает следующие пробелы.
8. Synthesis строится из ограниченного snapshot графа.
9. Learning layer получает признаки состояния и оценивает изменение coverage.

Итого: граф — не «декоративная карта» и не просто RAG-индекс. Это явная модель текущего понимания исследовательского проекта.
