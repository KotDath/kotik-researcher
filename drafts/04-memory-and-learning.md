# Memory, Reflection and Learning

## Четыре вида памяти

| Вид | Содержание |
|---|---|
| Semantic memory | Concepts, claims, evidence и их связи |
| Episodic memory | История конкретных исследований и действий |
| Procedural memory | Проверенные стратегии, skills и workflows |
| User memory | Предпочтения, критерии и исправления пользователя |

RAG не является памятью целиком. Это лишь один из механизмов извлечения релевантной части памяти в текущий контекст.

## Experience store

Опыт — это не только переписка, а наблюдаемая исследовательская траектория:

```yaml
trajectory:
  research_goal: ...
  initial_state: ...
  policy_version: ...
  actions:
    - type: search
      parameters: ...
      observation: ...
      cost: ...
    - type: read
      parameters: ...
      observation: ...
      cost: ...
  final_state: ...
  evaluation:
    coverage: ...
    evidence_accuracy: ...
    human_corrections: ...
    unsupported_claims: ...
    total_cost: ...
  delayed_feedback:
    missed_sources_found_later: [...]
    revised_conclusions: [...]
```

Особенно ценен delayed feedback: поздно найденный источник, меняющий вывод, сигнализирует о системном пробеле прежней search policy.

## Reflection

Reflection запускается после значимых этапов и завершённых research runs. Она анализирует:

- пропущенные или слишком поздно найденные источники;
- бесполезные и продуктивные запросы;
- ошибки screening и evidence extraction;
- расхождения с пользователем;
- преждевременную остановку;
- unsupported claims;
- избыточную стоимость;
- успешные и провалившиеся стратегии.

Результат reflection — не бесконтрольная правка собственного prompt, а проверяемое предложение:

```yaml
improvement_proposal:
  target: query_generation_policy
  observation: ...
  proposed_change: ...
  supporting_trajectories: [...]
  scope: ...
  risks: [...]
  validation_plan: ...
```

Предложение проверяется replay-evaluation на прошлых проектах и отдельном holdout. Только после отсутствия критических регрессий оно получает новую версию в policy registry.

## Лестница обучения

### 1. Явные правила и LLM policy

Начальная рабочая стратегия сочетает детерминированные ограничения и семантические решения LLM. Все trajectories уже записываются.

### 2. Learning-to-rank и contextual bandits

Локально обучаются:

- выбор следующего запроса;
- ranking кандидатов на чтение;
- выбор evidence для проверки;
- выбор parser/tool/model;
- memory retrieval;
- передача задачи более дорогой модели.

### 3. Offline RL

Многошаговая policy обучается на сохранённых trajectories без рискованного обучения непосредственно на пользователе.

### 4. Controlled online learning

Кандидат сначала работает в shadow mode, затем на ограниченной доле задач и сравнивается с основной policy. Должны поддерживаться versioning и rollback.

## Пространство решений

State:

```text
research brief
+ current knowledge graph snapshot
+ hypotheses and gaps
+ candidate corpus
+ coverage state
+ remaining budget
+ action history
+ user constraints
```

Actions:

```text
search(query, channel)
follow_citations(object)
screen(candidate)
read(document, depth)
extract_evidence(fragment)
verify(evidence)
revise_hypothesis(...)
run_experiment(...)
ask_user(question)
stop()
```

Составная награда может включать:

\[
R =
\alpha \Delta Coverage
+ \beta \Delta EvidenceQuality
+ \gamma \Delta Correctness
+ \delta \Delta UncertaintyReduction
- \lambda Cost
- \mu UnsupportedClaims
- \nu Redundancy
- \rho HumanCorrections
\]

Нельзя оптимизировать только пользовательский лайк, красоту отчёта или длину ответа: это учит систему убеждать, а не исследовать.

## Взаимодействие knowledge, memory и policy

```text
Knowledge graph показывает пробелы
→ policy выбирает действие
→ действие создаёт observation/evidence
→ knowledge graph обновляется
→ coverage и проверки дают feedback
→ episodic memory сохраняет траекторию
→ reflection предлагает обобщение
→ evaluation проверяет его
→ policy registry публикует улучшение
```

Для диссертации `kotik-researcher` служит естественным полигоном исследования консолидации, retrieval, forgetting, provenance и utility-based управления памятью. Эти механизмы должны быть заменяемыми и сравниваться на одинаковых research trajectories.
