# Design: add-orchestrator

## Context

См. vision.md (дистиллят explore-сессии: факты, решения, отвергнутое) и
proposal.md — Why. State machine спек — ванильный openspec CLI; change
наслаивает план разделения труда, не трогая инструмент. Backup-ветка —
работавший прототип ролей; берём контракты, не берём масштаб.

## Goals / Non-Goals

**Goals:**

- 6 ролей с контрактами и permission-границами в `.opencode/agents/`.
- Процедура цикла в orchestrator.md (routing, брифы, гейты, ≤3 итераций ревью).
- Smoke-тест question tool + задокументированный fallback.
- Dogfood-пилот цикла на мелкой фиче.

**Non-Goals:**

- Из backup не переносим: консилиум, app-tester, ui-reviewer, fast/deep-сплит
  spec-writer'а, agent-sessions.md, остальной зоопарк (~25 ролей → 6).
- Herdr-интеграция (отвергнута как транспорт, см. vision.md).
- HTML-рендер спек — отдельный будущий change.
- Патч сгенерированных скиллов/команд `/opsx:*`.

## Decisions

### D1: Транспорт — opencode subagents, herdr отвергнут

Task tool даёт: контракт «бриф → вердикт», permissions и pinned-модели в
frontmatter, resume по task_id (KV-кеш), дочерние сессии видны kotik-usage/
kotik-reflect. Herdr лишён этого (чтение alternate screen ненадёжно) и
остаётся слоем наблюдения вне процедуры. Предпосылка — question tool для
кастомных субагентов (проверено пользователем на backup) — верифицируется
первой задачей; fallback см. D3.

### D2: Логика оркестрации — в agents/*.md, ванильные /opsx не патчим

`openspec update` перезаписывает сгенерированные скиллы/команды. Поэтому
процедура живёт в определениях наших агентов (закоммичены, наши), а
openspec CLI используется как есть: `new change`, `status`, `instructions`,
`validate`, `archive`. Оркестратор и spec-writer вызывают CLI напрямую.

### D3: Grill ведёт spec-writer через question tool; fallback — оркестратор

Ожидание пользователя: опрашивает «чел, пишущий спеки». Интервью через
question tool — структурированные диалоги (как на backup). Если smoke-тест
покажет регрессию платформы — процедура переключается на fallback: grill
ведёт оркестратор, spec-writer оформляет согласованное. Fallback
фиксируется в orchestrator.md сразу, не после факта.

### D4: Стык ролей — файлы на диске; стык explore → спека — vision.md

Субагент получает бриф со ссылками на файлы (vision.md, артефакты change),
а не пересказ контекста. vision.md — свободный файл в папке change:
openspec его не трекает, но archive унесёт (как agent-sessions.md в backup).
Порядок: explore → `openspec new change` → vision.md → бриф spec-writer'у.

### D5: Routing card мини; Implementation фиксируется при спеке

Size/Risk/Implementation + сигналы — в proposal. Полная классификация backup
(Contours, эскалаторы, консилиум) избыточна для 6 ролей. `Implementation:
deep` — решение этапа спеки (совместно с пользователем), implementer его не
пересматривает: блокер возвращается оркестратору.

### D6: Модели — после инвентаризации провайдеров

Кандидаты: implementer — deepseek-v4-flash (быстрый, дешёвый); spec-writer,
implementer-deep, technical-consultant — сильная доступная; reviewer —
не модель оркестратора при наличии альтернативы (anchor bias). Итог
закрепляется в frontmatter при реализации и отражается в AGENTS.md.

### D7: Вложенное делегирование — только implementer → technical-consultant

Task permission implementer'а: deny `*`, allow `technical-consultant`,
`explore`. Оркестратор не ретранслирует затыки; consultant read-only,
отвечает на точечный вопрос с инвариантом и фактическим поведением.

### D8: Границы правок — структурные

- orchestrator: deny `src/**`, `src-tauri/**` (ценность в решениях).
- spec-writer: edit только `openspec/**`.
- implementer(-deep): edit `src/**`, `src-tauri/**` + `openspec/changes/**`
  (чекбоксы tasks.md), deny остального `openspec/**`.
- reviewer, technical-consultant: read-only.

### D9: Пользовательские `/opsx:*` — триггеры роутинга, не исполнение

Slash-команды `/opsx:*` вызывает пользователь в любом агенте; развёрнутый
workflow получает текущий агент. В режиме оркестратора он НЕ исполняет
workflow сам, а роутит: propose → оркестратор делает `openspec new change` и
vision.md, затем делегирует spec-writer'у; apply → делегирует implementer'у;
archive → оркестратор выполняет сам (механика: sync спек — это `openspec/**`,
`validate`, перенос в archive). Механические инструкции (граф артефактов,
шаблоны) субагенты получают сами, подгружая ванильные скиллы
`openspec-propose`/`openspec-apply-change` через skill tool, — тексты не
дублируются и всегда свежие после `openspec update`. В build-агенте
(fallback) `/opsx:*` работают ванильно.

## Risks / Trade-offs

- [Question tool недоступен субагентам в текущей версии opencode] →
  smoke-тест — первая задача; fallback из D3 уже в процедуре.
- [Интервью через question tool — структурированные диалоги, не свободный
  чат] → принято (на backup устраивало); при боли — herdr-панель для
  spec-writer'а как отдельный change.
- [Пользователь должен жить в primary-оркестраторе (Tab)] → осознанно
  принято пользователем; build-агент остаётся fallback для мелочи.
- [Холодный контекст субагентов: качество зависит от брифа] → брифинг-
  контракт из backup (дословно согласованное, отвергнутое, пути, контракт
  возврата) — требование спеки.
- [Дублирование процедуры: AGENTS.md и orchestrator.md] → AGENTS.md даёт
  карту и указатель на orchestrator.md как источник процедуры, не дублирует.
- [Зоопарк-риск: соблазн добавлять роли] → новые роли только отдельным
  change; Non-Goals фиксирует, что не переносим.

## Migration Plan

Кода нет — миграция не нужна. Переход процесса: после merge пользователь
переключается на агента orchestrator; старые активные change на момент
перехода отсутствуют (add-orchestrator — единственный). Откат = revert
коммита + переключение обратно на build-агент.

## Open Questions

(нет — перенесены в задачи: инвентаризация моделей, smoke-тест, пилот)
