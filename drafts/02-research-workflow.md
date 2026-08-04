# Research Workflow

## Режимы

Один workflow поддерживает разные политики глубины:

| Режим | Цель |
|---|---|
| `explore` | Быстро построить карту области и определить направления |
| `evidence` | Получить обоснованный ответ на конкретный вопрос |
| `review` | Построить максимально полный и воспроизводимый корпус |

## Основной цикл

```text
Research brief
→ Pilot map
→ Discovery plan
→ Candidate pool
→ Entity resolution
→ Screening
→ Selective acquisition and reading
→ Evidence extraction
→ Knowledge integration
→ Evidence comparison
→ Coverage audit
→ Synthesis snapshot
↘ при обнаружении пробелов обратно к discovery/hypotheses
```

### 1. Research brief

Фиксируются вопрос, назначение результата, границы, период, языки, допустимые типы источников, критерии включения, необходимая глубина, бюджет и stop conditions.

### 2. Pilot map

Дешёвая разведка выявляет:

- термины и синонимы;
- конкурирующие определения;
- школы и направления;
- типы исследований;
- разнородные seed-источники;
- неоднозначности и первоначальные гипотезы.

Pilot map не считается финальным корпусом: первые найденные источники не должны незаметно закрепить исходную рамку.

### 3. Multi-channel discovery

Поиск строится как матрица:

```text
концепты × каналы × периоды × языки
```

Каналы включают лексический и семантический поиск, backward/forward citations, авторов и лаборатории, обзоры, adversarial search, negative results, grey literature, code/data search и языково-специфические запросы.

Каждый запрос, фильтр, дата, API-ответ и канал обнаружения фиксируются детерминированно.

### 4. Candidate pool и entity resolution

Поисковый агент не должен бесследно отбрасывать кандидатов. Сначала все результаты попадают в общий inbox, затем связываются:

- DOI, arXiv и journal versions;
- разные отчёты одного исследования;
- supplements;
- code и datasets;
- corrections и retractions.

Основная сущность — `ResearchObject`, а не отдельный PDF.

### 5. Screening

Воронка:

```text
metadata → title → abstract → light full text → deep reading
```

Допустимые решения:

```text
include
exclude + reason
borderline
awaiting_fulltext
unavailable
duplicate/report_of_same_object
```

Модель может ранжировать кандидатов, но непроверенные записи не исчезают. В строгом режиме случайная часть исключений перепроверяется.

### 6. Selective acquisition and reading

Глубина обработки зависит от вероятного влияния документа на вывод:

| Роль | Обработка |
|---|---|
| Навигационная | Метаданные и abstract |
| Потенциально релевантная | Full text и нужные разделы |
| Включённая | Структурный разбор и evidence extraction |
| Критическая | Визуальная проверка таблиц, рисунков и формул |
| Опорная | Возможная ручная проверка пользователем |

Система должна поддерживать цифровые документы, сканы, OCR-неопределённость, таблицы, рисунки и недоступные источники. Недоступный источник остаётся в карте, но не считается прочитанным evidence.

### 7. Evidence extraction

Evidence извлекается по схеме конкретного вопроса:

- метод;
- условия;
- выборка или benchmark;
- comparator;
- метрика;
- результат;
- uncertainty;
- limitations;
- точное местоположение;
- способ извлечения и уровень проверки.

### 8. Comparison and knowledge integration

Проверяются сопоставимость условий, независимость исследований, повторное использование datasets, версии, вычислительные бюджеты, variance, противоречия и methodological disagreement.

Отношения не сводятся к `true/false`:

```text
supports
refutes
qualifies
different_scope
methodological_disagreement
supersedes
unresolved
```

### 9. Coverage audit

Перед остановкой проверяются:

- использованные независимые каналы;
- уникальный вклад каждого канала;
- наличие известных контрольных работ;
- альтернативные термины, школы, языки и периоды;
- критика и отрицательные результаты;
- причины исключений и выборочная перепроверка;
- недоступные документы;
- marginal yield последних циклов;
- области, поддержанные единственным источником.

Остановка определяется сочетанием:

```text
evidence sufficiency
+ declining marginal yield
+ cross-channel convergence
+ passed coverage checks
+ exhausted or unjustifiable budget
```

Система не утверждает, что нашла абсолютно все источники. Она явно описывает охват и остаточный риск пропуска.

### 10. Synthesis snapshot

Синтез версионируется и содержит поддержанные выводы, противоречия, пробелы, ограничения охвата и идентификаторы evidence. Новый поиск создаёт новую версию, а не бесследно переписывает прошлую.
