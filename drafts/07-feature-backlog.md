# Feature Backlog

Статус: living document  
Дата фиксации: 2026-08-03

Этот документ превращает целевую архитектуру `kotik-researcher` в
последовательность фич, которые можно по одной делегировать coding-агенту.
Это не сокращённый список возможностей MVP: порядок построен вертикальными
срезами, но ведёт ко всей зафиксированной системе — knowledge graph, памяти,
экспериментам и self-improvement.

## 1. Как пользоваться backlog

Одна карточка должна помещаться в одну изолированную ветку и завершаться
наблюдаемым результатом. Если во время реализации карточка требует нескольких
независимых миграций, экранов или протоколов, агент сначала делит её на
подзадачи, но не расширяет продуктовый scope.

Перед началом задачи агент получает:

- эту карточку и перечисленные зависимости;
- релевантные архитектурные документы;
- текущее состояние репозитория;
- команду запуска проверок;
- запрет незаметно принимать открытые продуктовые решения.

Карточка завершена, только если:

1. реализован описанный пользовательский результат;
2. добавлены автоматические тесты для основной логики и ошибок;
3. существующие проверки проходят;
4. есть короткий ручной сценарий проверки;
5. схема данных, события и публичные интерфейсы документированы;
6. неиспользованные абстракции «на будущее» не добавлены;
7. решение или новая неопределённость занесены в decision log.

Обозначения приоритета:

- **P0** — первый сквозной рабочий продукт;
- **P1** — полноценный исследовательский workflow;
- **P2** — долговременная память и улучшение стратегии;
- **R&D** — экспериментальная функция, продвигаемая только через evals.

## 2. Карта поставки

| Этап | Результат |
|---|---|
| A. Основание | Приложение создаёт, хранит и восстанавливает локальный проект |
| B. Workspace и агент | Пользователь ведёт проект через Pi-агента и трёхпанельный UI |
| C. Первый research loop | Brief превращается в источники, evidence, claims и синтез |
| D. Knowledge workspace | Граф становится редактируемой и проверяемой моделью знания |
| E. Эксперименты | Гипотезы проверяются воспроизводимым Python-кодом |
| F. Долгая работа | Появляются snapshots, branches, resume и четыре вида памяти |
| G. Проверяемый researcher | Coverage, reviewer и provenance защищают качество выводов |
| H. Self-improvement | Trajectories проходят reflection, replay и promotion |
| I. Поставка | Self-contained приложение устанавливается и диагностируется |

## 3. Последовательный backlog

### Этап A. Локальный проект как источник состояния

#### KR-001 — Каркас приложения и единая команда разработки [P0]

Создать TypeScript workspace с Electron, React и отдельными пакетами для
domain, storage, agent runtime и UI. Зафиксировать lint, typecheck, unit tests и
одну команду запуска desktop-приложения.

**Готово, когда:** чистый checkout запускает пустое окно приложения; CI или
локальная проверка выполняет lint, typecheck и tests одной документированной
командой.

#### KR-002 — Создание и открытие локального research project [P0]

Добавить project manifest, стабильный project ID, название, дату создания и
версию формата. Пользователь может создать каталог проекта, закрыть приложение
и снова открыть его.

**Зависит от:** KR-001.  
**Готово, когда:** повторное открытие восстанавливает тот же project ID и
метаданные; повреждённый или более новый manifest выдаёт понятную ошибку без
потери файлов.

#### KR-003 — Встроенное SQLite-хранилище и миграции [P0]

Подключить SQLite внутри проекта, реализовать транзакции, последовательные
миграции и резервное копирование перед несовместимой миграцией.

**Зависит от:** KR-002.  
**Готово, когда:** проект проходит миграцию с предыдущей тестовой схемы;
частично упавшая миграция не оставляет базу в промежуточном состоянии.

#### KR-004 — Типизированный event log [P0]

Сохранять значимые изменения проекта как append-only events с actor, timestamp,
causation ID, correlation ID, версией схемы и ссылками на затронутые объекты.

**Зависит от:** KR-003.  
**Готово, когда:** создание и переименование проекта видны в event log, а
повторная обработка команды с тем же idempotency key не создаёт дубль.

#### KR-005 — Artifact store для документов и результатов [P0]

Добавить content-addressed хранение бинарных артефактов: исходных документов,
извлечённого текста, изображений, кода и результатов экспериментов.

**Зависит от:** KR-003.  
**Готово, когда:** два одинаковых файла физически сохраняются один раз, объекты
ссылаются на hash, а удаление ссылки не повреждает артефакты других объектов.

#### KR-006 — Snapshot проекта и диагностический экспорт [P0]

Создавать согласованный snapshot доменного состояния и экспортировать
обезличенный диагностический пакет без секретов и исходных закрытых документов.

**Зависит от:** KR-004, KR-005.  
**Готово, когда:** snapshot можно открыть после перезапуска, а тест проверяет,
что API keys и содержимое исключённых артефактов не попадают в экспорт.

### Этап B. Workspace и управляемый агент

#### KR-010 — Трёхпанельный workspace [P0]

Реализовать Project navigator слева, Content canvas по центру и Agent panel
справа, включая изменение ширины, сворачивание и сохранение layout.

**Зависит от:** KR-002.  
**Готово, когда:** layout восстанавливается после перезапуска, а пустой проект
показывает chat-first onboarding.

#### KR-011 — Вкладки и маршрутизация content canvas [P0]

Добавить типизированные canvas routes, вкладки, recent objects и восстановление
последнего рабочего контекста.

**Зависит от:** KR-010.  
**Готово, когда:** заметка и карточка доменного объекта открываются в разных
вкладках, deep link восстанавливает выбранный объект.

#### KR-012 — Единый Markdown/KaTeX renderer [P0]

Использовать один безопасный renderer для чата, заметок, evidence и отчётов:
Markdown, code blocks, таблицы, inline/display math и внутренние ссылки.

**Зависит от:** KR-011.  
**Готово, когда:** эталонная страница корректно показывает формулы, таблицу,
код и ссылку на объект; опасный HTML/URL не исполняется.

#### KR-013 — Адаптер Pi SDK и потоковый чат [P0]

Подключить Pi agent runtime через собственный adapter, не позволяя UI зависеть
от внутренних типов SDK. Поддержать streaming, cancellation и сохранение
сообщений с model/provider metadata.

**Зависит от:** KR-003, KR-010.  
**Готово, когда:** агент отвечает потоково, запрос можно отменить, а после
перезапуска видна завершённая и корректно помеченная прерванная сессия.

#### KR-014 — Реестр tools, skills, plugins и hooks [P0]

Создать минимальные контракты расширений, lifecycle и capability metadata.
Первым инструментом сделать чтение разрешённых файлов проекта.

**Зависит от:** KR-013.  
**Готово, когда:** расширение можно зарегистрировать и отключить без изменения
agent loop; tool call и результат появляются в event log.

#### KR-015 — Политика разрешений и подтверждение действий [P0]

Классифицировать read, write, network, compute и destructive actions. UI должен
показывать понятное подтверждение для рискованных операций и запоминать только
явно выбранный scope разрешения.

**Зависит от:** KR-014.  
**Готово, когда:** запрещённое действие не выполняется, отмена работает, а
разрешение на один каталог не даёт доступ к соседнему.

#### KR-016 — Видимый план, прогресс и остановка работы агента [P0]

Показать активную задачу, текущий шаг, tool calls, ожидаемые решения и бюджет.
Пользователь может остановить выполнение без повреждения project state.

**Зависит от:** KR-013, KR-014.  
**Готово, когда:** многошаговая тестовая задача отображает переходы состояний,
а stop оставляет последний согласованный commit и помечает незавершённый run.

### Этап C. Первый сквозной research loop

#### KR-020 — Research Brief wizard [P0]

Превращать исходный вопрос пользователя в редактируемый `ResearchBrief`:
question, purpose, scope, languages, source criteria, depth mode, budget и stop
conditions. Ничего не начинать до подтверждения brief.

**Зависит от:** KR-012, KR-013.  
**Готово, когда:** CS test case создаёт валидный brief, пользователь меняет
поля, подтверждённая версия сохраняется как доменный объект и event.

#### KR-021 — Agenda и конечный автомат research run [P0]

Реализовать кодовые состояния pilot, discovery, screening, reading, evidence,
integration, coverage и synthesis с допустимыми переходами и resumability.

**Зависит от:** KR-004, KR-020.  
**Готово, когда:** run проходит демонстрационный happy path, недопустимый
переход отклоняется, а прерванный run возобновляется с последнего commit.

#### KR-022 — Provider interface для поиска источников [P0]

Определить нормализованный интерфейс discovery provider и реализовать первый
реальный либо fixture-provider. Сохранять запрос, канал, время, параметры,
сырой ответ и стоимость.

**Зависит от:** KR-014, KR-021.  
**Готово, когда:** одинаковая fixture выдаёт воспроизводимый набор кандидатов,
а ошибка или rate limit не уничтожает результаты других запросов.

#### KR-023 — Candidate inbox [P0]

Показывать все найденные кандидаты до screening: metadata, канал обнаружения,
query provenance и предварительное ранжирование. Автоматически не удалять
кандидатов.

**Зависит от:** KR-022, KR-011.  
**Готово, когда:** пользователь фильтрует inbox, открывает provenance и видит,
почему каждый кандидат появился.

#### KR-024 — ResearchObject и базовый entity resolution [P0]

Объединять DOI, arXiv, published version, supplement, code и dataset в один
`ResearchObject`, сохраняя отдельные reports и происхождение merge.

**Зависит от:** KR-023.  
**Готово, когда:** fixture с preprint и journal version создаёт один object с
двумя reports; сомнительный merge остаётся предложением для пользователя.

#### KR-025 — Импорт локального PDF и извлечение текста [P0]

Импортировать PDF, сохранить оригинал, страницы, извлечённый текст и качество
извлечения. Не считать документ прочитанным при неудачном parsing.

**Зависит от:** KR-005, KR-024.  
**Готово, когда:** digital PDF доступен в source view с постраничным текстом;
scan помечается как требующий OCR.

#### KR-026 — Screening workflow [P0]

Поддержать статусы include, exclude+reason, borderline, awaiting_fulltext,
unavailable и duplicate с ручным исправлением и audit trail.

**Зависит от:** KR-023, KR-024.  
**Готово, когда:** ни одно решение не удаляет кандидата; смена статуса и причина
видны в timeline.

#### KR-027 — Evidence Card с точной привязкой к источнику [P0]

Создавать evidence по вопросу: method, conditions, sample/benchmark, comparator,
metric, result, uncertainty, limitations, page/fragment, extraction method и
verification status.

**Зависит от:** KR-025, KR-026.  
**Готово, когда:** клик по evidence открывает нужную страницу и подсвечивает
фрагмент; изменение текста не теряет ссылку на исходную версию документа.

#### KR-028 — Claims и связи с evidence [P0]

Создавать scoped claims, связывать supporting/contradicting evidence,
qualifications, confidence и статусы proposed/supported/contested/superseded/
retracted/unresolved.

**Зависит от:** KR-027.  
**Готово, когда:** claim без evidence визуально помечается как unsupported, а
два противоположных evidence переводят его в contested без потери обоих.

#### KR-029 — Версионированный synthesis snapshot [P0]

Генерировать связный Markdown-синтез только из выбранного snapshot, с
внутренними ссылками на claims/evidence, ограничениями и unresolved gaps.

**Зависит от:** KR-028, KR-012.  
**Готово, когда:** каждое проверяемое утверждение отчёта ведёт к evidence либо
явно помечено как гипотеза; повторный синтез создаёт новую версию и diff.

**Вертикальный срез P0 считается готовым после KR-029:** пользователь создаёт
проект, формулирует brief, находит/импортирует источник, проводит screening,
создаёт evidence и claim и получает версионированный синтез.

### Этап D. Knowledge graph как центральный workspace

#### KR-030 — Полная доменная схема knowledge layer [P1]

Зафиксировать идентичность и версии `ResearchObject`, `Report`, `Concept`,
`Evidence`, `Claim`, `Hypothesis`, `Gap`, `Experiment` и допустимых relations.

**Зависит от:** KR-024, KR-028.  
**Готово, когда:** схема выражена типами и миграцией; fixtures покрывают
versioning, correction, retraction и conflicting evidence.

#### KR-031 — Query API типизированного графа [P1]

Реализовать nodes/edges поверх локального store, traversal, neighbourhood,
фильтры по snapshot и provenance без зависимости domain-кода от конкретной
визуализации.

**Зависит от:** KR-030.  
**Готово, когда:** API отвечает на эталонные вопросы о поддержке, противоречиях,
зависимостях и изменениях между snapshots.

#### KR-032 — Concept map и aliases [P1]

Добавить concepts, определения, aliases, competing terminology и disciplinary
context. Merge/split понятия должны быть обратимыми решениями.

**Зависит от:** KR-031.  
**Готово, когда:** два термина можно связать как aliases без потери исходных
формулировок, а competing definitions остаются раздельными.

#### KR-033 — Интерактивная graph view [P1]

Отображать локальный subgraph выбранного объекта, типы рёбер, фильтры, search и
переход к карточкам. Не пытаться одновременно рисовать весь граф проекта.

**Зависит от:** KR-011, KR-031.  
**Готово, когда:** CS fixture остаётся читаемой, выбор узла синхронизируется с
canvas и graph view работает на заранее заданном performance dataset.

#### KR-034 — Совместное редактирование графа пользователем и агентом [P1]

Все предложенные агентом merge, split, relation и status changes показывать как
diff с accept/reject/edit; ручные изменения становятся first-class events.

**Зависит от:** KR-032, KR-033.  
**Готово, когда:** reject не меняет граф, accept атомарно меняет snapshot, undo
восстанавливает прошлое состояние и provenance решения сохраняется.

#### KR-035 — Hypothesis и Gap lifecycle [P1]

Добавить формулировку, scope, predictions, required evidence, falsification
criteria, dependencies и статусы гипотез; gaps связывать с отсутствующим
evidence или coverage.

**Зависит от:** KR-031.  
**Готово, когда:** гипотеза не может стать supported только по тексту агента;
интерфейс объясняет, какие obligations закрыты и какие остались.

#### KR-036 — Propagation corrections/retractions [P1]

При correction, retraction или смене evidence пересчитывать затронутые claims,
hypotheses и synthesis как impacted, но не менять выводы бесследно.

**Зависит от:** KR-030, KR-035.  
**Готово, когда:** тестовая retraction показывает полный impact path и создаёт
задачу на пересмотр синтеза.

### Этап E. Воспроизводимые вычислительные эксперименты

#### KR-040 — Контракт Python sandbox [P1]

Определить isolated process API: inputs, files, environment, limits, stdout,
stderr, outputs, timeout, cancellation и запрет доступа вне разрешённого scope.

**Зависит от:** KR-005, KR-015.  
**Готово, когда:** простой скрипт выполняется, timeout завершается корректно, а
попытка чтения файла за пределами mount отклоняется.

#### KR-041 — Experiment manifest и воспроизводимый run [P1]

Хранить код, зависимости, seed, inputs, model/tool versions, resource limits и
outputs каждого запуска.

**Зависит от:** KR-040.  
**Готово, когда:** один run можно повторить из manifest и получить ожидаемый
детерминированный результат либо явный diff окружения.

#### KR-042 — Experiment view [P1]

Показать manifest, код, ход выполнения, логи, таблицы, графики, артефакты и
сравнение runs в content canvas.

**Зависит от:** KR-011, KR-041.  
**Готово, когда:** пользователь запускает fixture, отменяет его, сравнивает два
runs и открывает сохранённый output.

#### KR-043 — Связь hypothesis → experiment → evidence [P1]

Эксперимент должен закрывать конкретные predictions/obligations и создавать
evidence только после проверки результата и provenance.

**Зависит от:** KR-035, KR-041.  
**Готово, когда:** CS baseline experiment обновляет карточку гипотезы, но не
превращает finite result в универсальный claim.

#### KR-044 — Экспорт HTML/PDF-отчёта [P1]

Рендерить synthesis, bibliography, formulas, figures и evidence references в
standalone HTML и PDF через общий pipeline.

**Зависит от:** KR-012, KR-029, KR-042.  
**Готово, когда:** эталонный CS-отчёт визуально проверен, формулы и ссылки не
ломаются, а экспорт фиксирует project snapshot.

### Этап F. Многомесячная работа и память

#### KR-050 — Timeline и сравнение snapshots [P1]

Показывать значимые события и semantic diff между версиями brief, claims,
hypotheses, graph и synthesis.

**Зависит от:** KR-006, KR-030.  
**Готово, когда:** пользователь отвечает на «что изменилось и почему» без чтения
сырого event log.

#### KR-051 — Branches для альтернативных трактовок [P1]

Создавать branch от snapshot, независимо менять гипотезы/эксперименты и
сливать изменения через domain-aware diff с сохранением расхождений.

**Зависит от:** KR-050.  
**Готово, когда:** две несовместимые трактовки не перезаписывают друг друга, а
merge conflict требует явного решения.

#### KR-052 — Episodic memory и trajectories [P1]

Группировать actions, observations, решения, стоимость и outcome в
воспроизводимые research episodes, отличные от истории чата.

**Зависит от:** KR-004, KR-021.  
**Готово, когда:** episode объясняет, какие действия привели к найденному
источнику или изменению гипотезы.

#### KR-053 — Resume после длительного перерыва [P1]

Строить краткое resume: последнее устойчивое состояние, изменения, текущие
выводы, открытые gaps, незавершённые runs и рекомендуемые действия.

**Зависит от:** KR-050, KR-052.  
**Готово, когда:** resume генерируется из project state, а не только chat
history, и каждая рекомендация ведёт к соответствующему объекту.

#### KR-054 — User memory с управляемым scope [P2]

Хранить подтверждённые предпочтения, критерии качества, ограничения и
исправления отдельно на уровне project/workspace/global. Предоставить просмотр,
редактирование и удаление.

**Зависит от:** KR-015.  
**Готово, когда:** проектное правило не протекает в другой проект, а агент
показывает, какое воспоминание повлияло на решение.

#### KR-055 — Semantic retrieval из knowledge state [P2]

Собирать контекст из graph neighbourhood, lexical/full-text и при необходимости
vector retrieval, сохраняя причины выбора каждого элемента.

**Зависит от:** KR-031, KR-032.  
**Готово, когда:** eval fixture сравнивает retrieval с baseline и ни один
фрагмент без project provenance не попадает в контекст.

#### KR-056 — Procedural memory и версионированный registry [P2]

Хранить проверенные workflows, skills и локальные эвристики с областью
применимости, версией, evidence, eval result и rollback.

**Зависит от:** KR-014, KR-052.  
**Готово, когда:** runtime выбирает закреплённую версию процедуры, а смена
версии воспроизводима и не переписывает прошлые trajectories.

#### KR-057 — Consolidation, utility и forgetting sandbox [R&D]

Реализовать сменные memory policies: no-forgetting, FIFO, recency decay и
utility-based forgetting, не удаляя канонические события и evidence.

**Зависит от:** KR-052, KR-054, KR-055.  
**Готово, когда:** одинаковая сохранённая trajectory проигрывается на всех
policies при фиксированном memory budget и даёт сравнимые метрики.

### Этап G. Проверяемость research workflow

#### KR-060 — Многомерный quality profile источника [P1]

Оценивать type/status, provenance, evidence directness, methodology,
verifiability, independence, replication, relevance и verification state с
объяснениями и ссылками на основание.

**Зависит от:** KR-024, KR-027.  
**Готово, когда:** отсутствующий признак остаётся unknown, общий балл не скрывает
профиль, а ручная коррекция сохраняется.

#### KR-061 — Reviewer evidence extraction [P1]

Независимый review-pass проверяет numbers, units, conditions, tables/figures и
цитатные anchors критических evidence cards.

**Зависит от:** KR-027, KR-060.  
**Готово, когда:** специально искажённое число обнаруживается, расхождение
создаёт issue, а reviewer не может молча исправить первичную карточку.

#### KR-062 — Contradiction analysis [P1]

Находить потенциальные противоречия, различать genuine conflict, different
scope и methodological disagreement и передавать решение пользователю.

**Зависит от:** KR-031, KR-060, KR-061.  
**Готово, когда:** эталонные пары классифицируются с объяснением условий, а
неуверенный случай остаётся unresolved.

#### KR-063 — Coverage dashboard и audit [P1]

Показывать coverage по concepts, channels, periods, languages, schools,
criticism/negative results, unavailable sources и independent evidence.

**Зависит от:** KR-022, KR-026, KR-032, KR-060.  
**Готово, когда:** dashboard объясняет каждый gap данными discovery/screening и
не заявляет абсолютную полноту.

#### KR-064 — Stop recommendation [P1]

Рекомендовать продолжить или остановить поиск по evidence sufficiency,
marginal yield, cross-channel convergence, coverage checks и бюджету.

**Зависит от:** KR-063.  
**Готово, когда:** рекомендация содержит причины и uncertainty, пользователь
может её отклонить, а решение и последствия сохраняются.

#### KR-065 — Второй математический end-to-end benchmark [P2]

Провести кейс canonical coin systems через definitions, proofs,
counterexamples, exhaustive search и report, чтобы выявить привязку системы к
LLM-memory domain.

**Зависит от:** KR-043, KR-044, KR-062.  
**Готово, когда:** система явно различает проверенный конечный диапазон и общее
доказательство; результат сравнен с заранее закреплённым ground truth.

### Этап H. Self-improvement и learning architecture

#### KR-070 — Полная telemetry исследовательской trajectory [P2]

Фиксировать state, action, observation, cost, latency, policy/model/tool
versions, immediate outcome и delayed feedback в пригодном для replay формате.

**Зависит от:** KR-052, KR-063.  
**Готово, когда:** trajectory можно валидировать по схеме и воспроизвести без
обращения к исходному чату.

#### KR-071 — Evals harness и baseline policies [P2]

Создать datasets и метрики для discovery recall, screening, extraction,
citations, contradiction detection, coverage, cost и end-to-end quality.

**Зависит от:** KR-029, KR-061, KR-063, KR-070.  
**Готово, когда:** одна команда сравнивает candidate policy с закреплённым
baseline и сохраняет machine-readable report.

#### KR-072 — Reflection → ImprovementProposal [P2]

После run формировать структурированное предложение: observation, target,
change, evidence, scope, risk и validation plan. Не менять активную policy
непосредственно из reflection.

**Зависит от:** KR-070, KR-071.  
**Готово, когда:** proposal ссылается на конкретные trajectory events и может
быть принят, отклонён или отправлен на replay.

#### KR-073 — Replay environment [P2]

Проигрывать старые проекты/fixtures с замороженными provider responses и
сравнивать candidate strategy с baseline при одинаковых inputs и budgets.

**Зависит от:** KR-071, KR-072.  
**Готово, когда:** replay детерминирован, формирует regression report и не
изменяет пользовательские проекты.

#### KR-074 — Policy registry, promotion и rollback [P2]

Хранить candidate/shadow/active/retired policies, eval evidence, scope и
promotion criteria. Продвижение требует прохождения заданных gates.

**Зависит от:** KR-056, KR-073.  
**Готово, когда:** policy с regression не продвигается, успешная ограничивается
заявленным scope, а rollback воспроизводим.

#### KR-075 — Learning-to-rank кандидатов [R&D]

Обучить или настроить ranker для выбора источника на чтение, используя только
зафиксированные features/labels и сравнение с deterministic baseline.

**Зависит от:** KR-071, KR-074.  
**Готово, когда:** ranker улучшает заранее выбранную метрику на held-out topics
без недопустимого ухудшения recall или cost.

#### KR-076 — Contextual bandit в shadow mode [R&D]

Оценивать выбор query/provider/parser/model на сохранённых локальных решениях,
не передавая bandit управление критическими действиями.

**Зависит от:** KR-074.  
**Готово, когда:** shadow recommendations логируются, сравниваются с active
policy и не влияют на runtime до отдельного promotion decision.

#### KR-077 — Offline RL research track [R&D]

Определить state/action/reward dataset, off-policy evaluation и защиту от
reward hacking для многошаговой search/read/verify policy.

**Зависит от:** KR-070, KR-071, достаточный объём trajectories.  
**Готово, когда:** эксперимент воспроизводим на held-out projects и candidate
остаётся вне production runtime до прохождения тех же promotion gates.

### Этап I. Поставка и эксплуатация

#### KR-080 — Model/provider settings и secrets [P1]

Добавить локальные и облачные providers через adapter, capability discovery,
per-task routing, budgets и безопасное хранение credentials.

**Зависит от:** KR-013, KR-015.  
**Готово, когда:** provider меняется без миграции domain state, secret не
попадает в project files/log/export, а отсутствие сети обрабатывается явно.

#### KR-081 — Git-backed история человекочитаемых файлов [P1]

Версионировать notes, reports, experiment code и выбранные manifests, не
используя Git как замену SQLite/event store.

**Зависит от:** KR-006, KR-029, KR-041.  
**Готово, когда:** значимое изменение создаёт объяснимый commit, пользовательские
внешние изменения обнаруживаются и не перезаписываются молча.

#### KR-082 — Backup, restore и перенос проекта [P1]

Экспортировать полный переносимый проект и восстанавливать его с проверкой
hashes, schema version и отсутствующих внешних ресурсов.

**Зависит от:** KR-005, KR-006.  
**Готово, когда:** проект переносится на чистое окружение с тем же snapshot и
явно перечисляет недоступные network-only ресурсы.

#### KR-083 — Пакетирование управляемого Python runtime [P1]

Поставлять совместимый Python runtime и базовое окружение без ручной установки,
поддержать проверку целостности и версионирование environments.

**Зависит от:** KR-040, KR-041.  
**Готово, когда:** sandbox запускается на чистой целевой машине из packaged app,
а несовместимая dependency создаёт отдельное окружение или понятную ошибку.

#### KR-084 — Desktop packaging и first-run diagnostics [P1]

Собрать устанавливаемое Electron-приложение, диагностировать storage, sandbox,
network/provider и renderer без отправки данных наружу по умолчанию.

**Зависит от:** KR-080, KR-083.  
**Готово, когда:** release artifact устанавливается на целевой ОС, создаёт
проект и выполняет P0 demo без системного Node/Python/DB.

#### KR-085 — Security и recovery test suite [P1]

Проверить path traversal, prompt/tool permission boundaries, malicious
documents, renderer injection, secret leakage, database corruption, crash и
recovery незавершённых runs.

**Зависит от:** KR-015, KR-025, KR-040, KR-084.  
**Готово, когда:** зафиксированный threat suite проходит, а recovery не
маскирует потерю или расхождение данных.

#### KR-086 — Performance budgets и release gate [P1]

Задать бюджеты startup, large project open, graph query/render, import, memory
и токен/денежную стоимость типового research loop.

**Зависит от:** KR-033, KR-063, KR-084.  
**Готово, когда:** benchmark запускается автоматически, сохраняет baseline и
блокирует release при согласованной существенной регрессии.

## 4. Первые задачи, которые следует делегировать

Не стоит отдавать агенту весь этот документ с командой «реализуй». Первые
делегирования должны идти строго так:

1. **KR-001** — каркас и проверки.
2. **KR-002** — создание/открытие проекта.
3. **KR-003** — SQLite и migrations.
4. **KR-004** — event log.
5. **KR-010** — трёхпанельный shell.
6. **KR-013** — Pi adapter и streaming chat.
7. **KR-020** — Research Brief.
8. **KR-021** — resumable research state machine.
9. **KR-022** — discovery provider interface на fixtures.
10. **KR-023** — candidate inbox.
11. **KR-024** — ResearchObject/entity resolution.
12. **KR-025** — импорт PDF.

После KR-004 полезно выполнять KR-005 и KR-010 параллельно только в разных
ветках и при заранее зафиксированных интерфейсах. Если работа идёт одним
агентом последовательно, используется порядок выше с добавлением KR-005 перед
KR-025 и KR-011/012/014–016 перед теми карточками, которым они нужны.

## 5. Шаблон задания coding-агенту

```markdown
Реализуй фичу <ID и название> из `07-feature-backlog.md`.

Перед реализацией:
1. прочитай `README.md`, `05-decision-log.md`, карточку фичи и перечисленные в
   ней архитектурные документы;
2. изучи существующий код и проверки;
3. перечисли затрагиваемые интерфейсы, данные и риски;
4. если acceptance criteria нельзя выполнить без нового продуктового решения,
   остановись и задай один конкретный вопрос.

Ограничения:
- не реализуй соседние карточки;
- не меняй зафиксированный стек и архитектурные границы;
- domain logic не должна зависеть от Electron/React или конкретного Pi SDK;
- все значимые изменения state проходят через типизированные команды/events;
- сохраняй local-first и воспроизводимость;
- не делай необратимых миграций без backup/recovery path.

Результат:
- код и миграции;
- автоматические тесты;
- короткий manual verification scenario;
- обновление документации и decision log при необходимости;
- итоговый отчёт: что сделано, что проверено, известные ограничения.
```

## 6. Контрольные release-срезы

| Срез | Включённые карточки | Пользовательский результат |
|---|---|---|
| R0 — Project shell | KR-001…006, KR-010…012 | Локальный проект и устойчивый workspace |
| R1 — Agent brief | KR-013…016, KR-020…021 | Управляемый агент создаёт и продолжает brief |
| R2 — Evidence loop | KR-022…029 | Источник превращается в проверяемый синтез |
| R3 — Knowledge workspace | KR-030…036, KR-050 | Редактируемый версионированный граф знания |
| R4 — Experimental research | KR-040…044 | Воспроизводимое вычислительное исследование |
| R5 — Long-lived researcher | KR-051…064 | Память, resume, reviewer и coverage |
| R6 — Learning researcher | KR-070…077 | Проверяемое улучшение policy через replay |
| R7 — Distributable product | KR-080…086 | Self-contained безопасная desktop-поставка |

## 7. Открытые решения, которые не надо прятать внутри реализации

До соответствующих карточек нужно отдельно принять или экспериментально
проверить:

1. точную package/module structure репозитория;
2. конкретную Pi SDK integration boundary;
3. библиотеки SQLite/ORM и graph visualization;
4. PDF parser и OCR pipeline;
5. формат domain commands/events и snapshot cadence;
6. packaged Python distribution и OS targets;
7. первый набор научных search providers;
8. ground truth и масштаб двух end-to-end benchmarks;
9. формулу confidence/independence и promotion thresholds;
10. количественные performance и security release gates.

Эти решения оформляются отдельными ADR или короткими spikes. Агент не должен
закреплять их случайно только потому, что первая попавшаяся библиотека была
удобной.
