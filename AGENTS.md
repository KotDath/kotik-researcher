# AGENTS.md

## Проект

Десктоп-чат с LLM (DeepSeek) на Tauri 2 + Rig — задел под исследовательскую
платформу (см. `docs/adr/0001-stack-rig-tauri-react.md`). Десктоп-приложение,
не веб-сайт: фронтенд работает внутри WebView Tauri, вся работа с LLM — в Rust.

## Архитектурный инвариант (главное правило)

**Ядро отделено от агента и от UI.** `kotik-core` не импортирует Rig, Tauri
и не знает про React. Весь функционал обязан работать через терминал
(`kotik-cli`) без UI. UI и agent runtime — заменяемые адаптеры.
Нарушать это правило нельзя — это ошибка первой итерации (см. ветку `backup`).

## Структура

- `src/` — React + Vite фронтенд (JavaScript, не TypeScript). Точка входа `main.jsx`, весь чат в `App.jsx`.
- `src-tauri/` — Cargo workspace:
  - `src/lib.rs`, `src/main.rs` — Tauri-оболочка (пакет `kotik-researcher`), тонкий IPC-адаптер.
  - `crates/kotik-core/` — контракты (`ChatMessage`, `ChatEvent`, `ChatError`) и порт `ChatAgent`. Чистый Rust, без Rig/Tauri.
  - `crates/kotik-agent-rig/` — адаптер Rig (DeepSeek), реализует `ChatAgent`.
  - `crates/kotik-cli/` — headless терминальный чат (TUI-first harness).
- `src-tauri/tauri.conf.json` — конфиг Tauri (devUrl `:1420`, frontendDist `../dist`).
- `docs/adr/` — архитектурные решения.

## Ключевые решения

- LLM-провайдер: DeepSeek через `rig-core` (в `Cargo.toml` подключён как `rig = { package = "rig-core", ... }`, поэтому в коде `use rig::...`). Модель — `deepseek::DEEPSEEK_V4_FLASH`.
- API-ключ только из переменной окружения `DEEPSEEK_API_KEY` (`deepseek::Client::from_env()`), ключ нигде не храним и не коммитим.
- Стриминг: порт `ChatAgent.stream_reply()` → `ChatEvent::Chunk`; в Tauri чанки шлются во фронт через `tauri::ipc::Channel<String>` (не events).
- История чата живёт в React-состоянии и передаётся в команду целиком; Rust-часть stateless.

## Команды

- `npm run tauri dev` — запуск десктоп-приложения (нужен `DEEPSEEK_API_KEY`).
- `cargo run --manifest-path src-tauri/Cargo.toml -p kotik-cli` — чат в терминале без UI.
- `cargo test --manifest-path src-tauri/Cargo.toml` — тесты (core тестируется мок-агентом, без сети).
- `npm run build` — сборка фронтенда.
- `npm run tauri build` — сборка приложения.

## Ограничения среды

- `create-tauri-app` в этой среде не работает (требует TTY) — структура создана вручную.
