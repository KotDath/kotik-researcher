use futures::StreamExt;
use rig::prelude::*;
use rig::providers::deepseek;
use rig::streaming::StreamedAssistantContent;
use serde::Deserialize;
use tauri::ipc::Channel;

const PREAMBLE: &str = "Ты — полезный ассистент. Отвечай на языке пользователя.";

#[derive(Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// Отправляет сообщение в DeepSeek и стримит текстовые чанки ответа
/// во фронтенд через `on_chunk`.
#[tauri::command]
async fn send_message(
    history: Vec<ChatMessage>,
    prompt: String,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let client = deepseek::Client::from_env()
        .map_err(|e| format!("не удалось создать DeepSeek-клиент: {e}"))?;
    let model = client.completion_model(deepseek::DEEPSEEK_V4_FLASH);

    let messages: Vec<Message> = history
        .into_iter()
        .map(|m| match m.role.as_str() {
            "assistant" => Message::assistant(m.content),
            _ => Message::user(m.content),
        })
        .collect();

    let mut stream = model
        .completion_request(prompt)
        .preamble(PREAMBLE.to_string())
        .messages(messages)
        .stream()
        .await
        .map_err(|e| format!("ошибка запроса к DeepSeek: {e}"))?;

    while let Some(item) = stream.next().await {
        match item {
            Ok(StreamedAssistantContent::Text(text)) => {
                on_chunk
                    .send(text.text)
                    .map_err(|e| format!("не удалось отправить чанк во фронтенд: {e}"))?;
            }
            // Тул-коллы, reasoning и служебные события в базовом чате игнорируем
            Ok(_) => {}
            Err(e) => return Err(format!("ошибка стрима: {e}")),
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
