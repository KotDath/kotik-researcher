//! Адаптер Rig → порт [`ChatAgent`] из kotik-core.
//!
//! Всё знание о Rig и DeepSeek сосредоточено здесь. Если agent runtime
//! будет заменён, меняется только этот крейт.

use futures::StreamExt;
use kotik_core::{ChatAgent, ChatError, ChatEvent, ChatMessage, ChatStream, Role, DEFAULT_PREAMBLE};
use rig::prelude::*;
use rig::providers::deepseek;
use rig::streaming::StreamedAssistantContent;

/// Чат-агент на базе Rig + DeepSeek.
pub struct RigChatAgent {
    model: deepseek::CompletionModel,
}

impl RigChatAgent {
    /// Создаёт агента, читая ключ из переменной окружения `DEEPSEEK_API_KEY`.
    pub fn from_env() -> Result<Self, ChatError> {
        let client = deepseek::Client::from_env()
            .map_err(|e| ChatError(format!("не удалось создать DeepSeek-клиент: {e}")))?;
        Ok(Self {
            model: client.completion_model(deepseek::DEEPSEEK_V4_FLASH),
        })
    }
}

impl ChatAgent for RigChatAgent {
    async fn stream_reply(
        &self,
        history: Vec<ChatMessage>,
        prompt: String,
    ) -> Result<ChatStream, ChatError> {
        let messages: Vec<Message> = history
            .into_iter()
            .map(|m| match m.role {
                Role::Assistant => Message::assistant(m.content),
                Role::User => Message::user(m.content),
            })
            .collect();

        let stream = self
            .model
            .completion_request(prompt)
            .preamble(DEFAULT_PREAMBLE.to_string())
            .messages(messages)
            .stream()
            .await
            .map_err(|e| ChatError(format!("ошибка запроса к DeepSeek: {e}")))?;

        // Оставляем только текстовые чанки; тул-коллы, reasoning и служебные
        // события в базовом чате игнорируем.
        let events = stream.filter_map(|item| async move {
            match item {
                Ok(StreamedAssistantContent::Text(text)) => Some(Ok(ChatEvent::Chunk(text.text))),
                Ok(_) => None,
                Err(e) => Some(Err(ChatError(format!("ошибка стрима: {e}")))),
            }
        });

        Ok(Box::pin(events))
    }
}
