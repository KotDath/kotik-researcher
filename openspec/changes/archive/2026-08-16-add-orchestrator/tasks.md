# Tasks: add-orchestrator

## 1. Проверка платформы

- [x] 1.1 Smoke-тест question tool: создать минимального субагента с `question: allow`, перезапустить opencode (реестр агентов фиксируется на старте), вызвать через task — подтвердить, что пользователь видит вопрос и ответ возвращается. При провале — зафиксировать fallback (grill ведёт оркестратор) как основной путь в артефактах
- [x] 1.2 Инвентаризация доступных моделей/провайдеров (opencode.json, глобальный конфиг): выбрать модели для ролей по D6 (implementer — быстрая; spec-writer/implementer-deep/consultant — сильная; reviewer ≠ модель оркестратора при возможности)

## 2. Субагенты исполнения

- [x] 2.1 `.opencode/agents/spec-writer.md`: subagent, question: allow, edit только `openspec/**`; процедура grill по карте покрытия (скоуп, критерии приёмки как наблюдаемые свойства, non-goals, edge cases, UX-состояния, режимы отказа), чтение vision.md, создание артефактов через openspec CLI, контракты возврата (`SPEC_READY`, `NEEDS_RESEARCH`, блокер)
- [x] 2.2 `.opencode/agents/implementer.md`: subagent, быстрая модель; edit `src/**`, `src-tauri/**` + `openspec/changes/**`; чтение артефактов change с диска, работа по tasks.md с чекбоксами, DoD, отчёт с блоком «что проверить руками»; блокер → возврат оркестратору, не «вглубь»
- [x] 2.3 `.opencode/agents/implementer-deep.md`: то же, что 2.2, на сильной модели, без technical-consultant
- [x] 2.4 `.opencode/agents/technical-consultant.md`: subagent, read-only; ответ на точечный вопрос (инвариант + фактическое поведение + вопрос), рекомендация с уровнем уверенности
- [x] 2.5 `.opencode/agents/reviewer.md`: subagent, read-only; ревью диффа против спеки, вердикт `APPROVE`/`CHANGES_REQUESTED` с воспроизводимыми evidence по каждой находке
- [x] 2.6 Проверить вложенное делегирование: implementer вызывает technical-consultant (task permission: deny `*`, allow `technical-consultant`, `explore`) — smoke-тест. Фикс `subagent_depth: 3` + explore на deepseek-v4-flash внесены в opencode.json; конфиг читается при старте — нужен рестарт opencode

## 3. Оркестратор

- [x] 3.1 `.opencode/agents/orchestrator.md`: primary, deny `src/**` и `src-tauri/**`; роутинг (мелочь/change/explore-режим), мини routing card (Profile/Size/Risk/Implementation + сигналы) в proposal, брифинг-контракт (дословно согласованное, отвергнутое, пути к файлам, контракт возврата), Spec review packet (содержательно, не ссылки), гейты, цикл ревью ≤3 итераций с resume, fallback grill из D3, правило vision.md (D4)
- [x] 3.2 Процедура архивации через openspec CLI (`validate`, `archive`) в orchestrator.md

## 4. Документация и пилот

- [x] 4.1 Обновить `AGENTS.md`: карта `.opencode/agents/` (6 ролей + reflector), SDD-цикл через оркестратора, grill-правило — опрос ведёт spec-writer, build-агент как fallback, модели ролей (по итогам 1.2); AGENTS.md указывает на orchestrator.md как источник процедуры, без дублирования
- [x] 4.2 Обновить `openspec/config.yaml` context: упоминание оркестраторного процесса для артефактов
- [x] 4.3 Dogfood-пилот: провести первую мелкую реальную фичу через новый цикл целиком (grill → спека → approve → implementer → reviewer → архив); зафиксировать замечания
- [x] 4.4 Definition of Done: `cargo test`, `cargo clippy --workspace -- -D warnings`, `cargo fmt -- --check`, `npm run lint`, `npm run build` — зелёные (change не трогает код, но DoD обязателен)
