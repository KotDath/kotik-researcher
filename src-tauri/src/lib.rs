//! Tauri-адаптер kotik: тонкий IPC-мост между React UI и kotik-core.
//!
//! Бизнес-логики здесь нет: команда маппит DTO в контракты ядра,
//! вызывает порт `ChatAgent` и стримит события во фронтенд.

use futures::StreamExt;
use kotik_agent_rig::RigChatAgent;
use kotik_core::{ChatAgent, ChatEvent, ChatMessage};
use serde::Deserialize;
use tauri::ipc::Channel;

/// DTO сообщения, как оно приходит с фронтенда.
#[derive(Deserialize)]
struct ChatMessageDto {
    role: String,
    content: String,
}

/// Отправляет сообщение агенту и стримит текстовые чанки ответа
/// во фронтенд через `on_chunk`.
#[tauri::command]
async fn send_message(
    history: Vec<ChatMessageDto>,
    prompt: String,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let agent = RigChatAgent::from_env().map_err(|e| e.to_string())?;

    let history: Vec<ChatMessage> = history
        .into_iter()
        .map(|m| match m.role.as_str() {
            "assistant" => ChatMessage::assistant(m.content),
            _ => ChatMessage::user(m.content),
        })
        .collect();

    let mut stream = agent
        .stream_reply(history, prompt)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(event) = stream.next().await {
        match event {
            Ok(ChatEvent::Chunk(text)) => on_chunk
                .send(text)
                .map_err(|e| format!("не удалось отправить чанк во фронтенд: {e}"))?,
            Err(e) => return Err(e.to_string()),
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![send_message])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
