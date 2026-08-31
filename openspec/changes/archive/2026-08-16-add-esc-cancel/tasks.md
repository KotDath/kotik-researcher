# Tasks: add-esc-cancel

## 1. Состояние App (app.rs)

- [x] 1.1 Добавить вариант `Action::Cancel` и ветку `(KeyCode::Esc, _)` в `on_key`: возвращает `Some(Action::Cancel)` только при `streaming == true`, вне стриминга Esc игнорируется (design D4)
- [x] 1.2 Реализовать редьюсер `App::on_cancel()`: `streaming = false`, `reply_open = false`, `pending_prompt = None` (без коммита в `history`), `scroll = None`, системная запись «ответ отменён» в `entries`; частичный ответ (последняя запись Assistant) сохраняется (design D2)
- [x] 1.3 Дополнить константу `WELCOME` упоминанием «Esc — отменить ответ» (design D5)

## 2. Цикл событий (main.rs)

- [x] 2.1 `spawn_stream` возвращает `JoinHandle<()>`; цикл событий хранит `Option<JoinHandle<()>>` активного стрима, обнуляет при `Done`/`Error` (design D1)
- [x] 2.2 Обработать `Action::Cancel` в цикле событий: `abort()` активного хэндла + `app.on_cancel()` (design D1, D3)
- [x] 2.3 Механизм поколений стрима (fix по ревью): `generation: u64` в `StreamMsg`, инкремент на каждом `Submit`; `handle_stream_msg` отбрасывает сообщения чужих поколений до редьюсеров `App`, `Done`/`Error` текущего поколения обнуляют хэндл (design D3)

## 3. Тесты (app.rs)

- [x] 3.1 Тест: Esc в середине стриминга → `Action::Cancel`; после `on_cancel()` частичный ответ и системная запись в `entries`, `streaming == false`, `history` пуста, диалог можно продолжить
- [x] 3.2 Тест: отмена до первого чанка → записи Assistant нет, есть сообщение пользователя и системная запись; `history` пуста
- [x] 3.3 Тест: Esc вне стриминга → `None`, ввод не изменяется; повторный Esc после завершения/отмены стрима → без эффекта
- [x] 3.4 Тест: набранный во время стриминга ввод сохраняется после `on_cancel()`; скролл прилипает к низу (`scroll() == None`)
- [x] 3.5 Тест: запоздалый `on_chunk`/`on_stream_done` после `on_cancel()` — no-op (design D3)
- [x] 3.6 Регрессионный тест на гонку «отмена → новый запрос»: после `on_cancel()` и нового `submit` запоздалые Chunk/Done/Error старого поколения отбрасываются, новый стрим жив и коммитит только свою пару (design D3)

## 4. Проверки DoD

- [x] 4.1 `cargo test --manifest-path src-tauri/Cargo.toml` — зелёный
- [x] 4.2 `cargo clippy --manifest-path src-tauri/Cargo.toml --workspace -- -D warnings` — зелёный
- [x] 4.3 `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` — зелёный
- [x] 4.4 `npm run lint` и `npm run build` — зелёные (фронтенд не менялся, проверка на регресс)
- [ ] 4.5 Ручная проверка в `kotik-cli`: отправить запрос, нажать Esc в середине стрима — стрим останавливается, пометка видна, диалог продолжается
