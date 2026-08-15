# AGENTS.md

## Проект

Десктоп-чат с LLM (DeepSeek) на Tauri 2 + Rig. Десктоп-приложение, не веб-сайт: фронтенд работает внутри WebView Tauri, вся работа с LLM — в Rust.

## Структура

- `src/` — React + Vite фронтенд (JavaScript, не TypeScript). Точка входа `main.jsx`, весь чат в `App.jsx`.
- `src-tauri/` — Rust-бэкенд. Команды Tauri в `src/lib.rs`.
- `src-tauri/tauri.conf.json` — конфиг Tauri (devUrl `:1420`, frontendDist `../dist`).

## Ключевые решения

- LLM-провайдер: DeepSeek через `rig-core` (в `Cargo.toml` подключён как `rig = { package = "rig-core", ... }`, поэтому в коде `use rig::...`). Модель — `deepseek::DEEPSEEK_V4_FLASH`.
- API-ключ только из переменной окружения `DEEPSEEK_API_KEY` (`deepseek::Client::from_env()`), ключ нигде не храним и не коммитим.
- Стриминг: Rig `stream()` → чанки `StreamedAssistantContent::Text` шлются во фронт через `tauri::ipc::Channel<String>` (не events).
- История чата живёт в React-состоянии и передаётся в команду целиком; Rust-часть stateless.

## Команды

- `npm run tauri dev` — запуск в dev-режиме (нужен `DEEPSEEK_API_KEY` в окружении).
- `npm run build` — сборка фронтенда.
- `cargo check --manifest-path src-tauri/Cargo.toml` — проверка Rust-части.
- `npm run tauri build` — сборка приложения.

## Ограничения среды

- `create-tauri-app` в этой среде не работает (требует TTY) — структура создана вручную.
