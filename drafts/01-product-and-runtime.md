# Product and Runtime

## Закреплённые решения

### Линейка продуктов

- `kotik` — небольшое универсальное агентное ядро.
- `kotik-researcher` — первый реальный потребитель ядра и основной полигон его развития.
- `kotik-coder` — возможный следующий продукт поверх того же ядра, памяти и learning infrastructure.

`kotik` не должен заранее превращаться в универсальный клон Pi со всеми возможными абстракциями. Его интерфейсы извлекаются из реальных потребностей `kotik-researcher`, но ядро остаётся предметно-независимым.

### Граница ядра

```text
kotik-core
├── agent loop
├── model providers and routing
├── tool protocol and tool manager
├── hooks
├── context construction and compaction
├── event log
├── session/task runtime
├── branching context
├── sandbox interface
├── memory interface
└── policy interface
```

Ядро отвечает за исполнение действий и жизненный цикл агента. Оно не является хранилищем научной истины и не содержит предметную онтологию исследователя.

### Граница исследовательского продукта

```text
kotik-researcher
├── research brief
├── hypothesis management
├── source discovery
├── screening
├── document acquisition and parsing
├── evidence extraction and verification
├── knowledge integration
├── contradiction and gap analysis
├── coverage audit
├── synthesis
└── research UI
```

### Управление исполнением

- Один основной supervisor ведёт исследовательскую сессию.
- План не является разовым документом: manager of hypotheses и agenda непрерывно обновляются по мере поступления evidence.
- Параллельные workers — временные профили задач, а не обязательный зоопарк постоянных агентов.
- Для workers предпочтительно ветвление от общего неизменяемого контекста, чтобы не пересобирать контекст с нуля и не терять KV-cache без необходимости.
- Состояния, допустимые переходы, бюджеты, журнал и проверки контролируются обычным кодом.
- LLM принимает семантические решения внутри установленных границ.

### Runtime и learning разделены

Research runtime должен оставаться полностью работоспособным при выключенном learning layer. Это позволяет:

- воспроизводить старые исследования;
- сравнивать разные policies;
- откатывать ухудшения;
- отделять обновление знания от обновления поведения;
- проверять реальный эффект самоулучшения.

## Закреплённый технологический фундамент

- `kotik-core` и agent runtime: TypeScript на базе Pi SDK.
- UI: React + TypeScript.
- Desktop shell: Electron.
- Вычислительные эксперименты: отдельная изолированная Python-песочница.
- Расширение агента: tools, plugins, skills и hooks.
- Базовый режим поставки: self-contained local-first приложение без обязательного внешнего backend и без ручной установки системных зависимостей пользователем.

Python не является вторым agent runtime. Он используется для вычислений,
обработки данных и воспроизводимых экспериментов.

Физическая модель локального хранения, пакетирование Python и границы процессов
ещё требуют прототипирования. Они не должны нарушать разделение runtime,
research state, knowledge, memory и learning.
