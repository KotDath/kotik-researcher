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

- `src/` — React UI: список сообщений, поле ввода, рендер markdown, стриминг чанков через `Channel` из `@tauri-apps/api`.
- `src-tauri/src/lib.rs` — Tauri-команда `send_message(history, prompt, on_chunk)`: создаёт DeepSeek-клиент Rig (ключ из `DEEPSEEK_API_KEY`), шлёт запрос к модели `deepseek-v4-flash` и стримит текстовые чанки во фронтенд.
- История чата хранится на фронтенде и передаётся в команду целиком.

## Сборка

```bash
npm run tauri build
```
