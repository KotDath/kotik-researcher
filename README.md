# kotik-researcher

Agentic AI system to assist in research tasks

Сейчас — базовый десктоп-чат с DeepSeek: Tauri 2 + Rig (Rust-бэкенд) + React/Vite (фронтенд), ответы стримятся в реальном времени.

## Запуск

Требуется ключ DeepSeek в окружении:

```bash
export DEEPSEEK_API_KEY=sk-...
npm install
npm run tauri dev
```

## Как устроено

Архитектурный инвариант: **ядро отделено от агента и от UI** (подробности — в `AGENTS.md`).

- `src-tauri/crates/kotik-core` — контракты и порт `ChatAgent`; не зависит от Rig/Tauri, тестируется мок-агентом.
- `src-tauri/crates/kotik-agent-rig` — адаптер Rig: DeepSeek-клиент (ключ из `DEEPSEEK_API_KEY`), модель `deepseek-v4-flash`, стриминг.
- `src-tauri/crates/kotik-cli` — чат в терминале (TUI-first harness, весь функционал доступен без UI).
- `src-tauri/src/lib.rs` — Tauri-команда `send_message`, тонкий IPC-адаптер поверх ядра.
- `src/` — React UI: список сообщений, рендер markdown, стриминг чанков через `Channel` из `@tauri-apps/api`.
- История чата хранится на фронтенде и передаётся в команду целиком.

Чат в терминале без UI:

```bash
cargo run --manifest-path src-tauri/Cargo.toml -p kotik-cli
```

## Сборка

```bash
npm run tauri build
```
