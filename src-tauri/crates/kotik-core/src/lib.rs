//! Ядро kotik: контракты и порты.
//!
//! Главное правило архитектуры: этот крейт не знает ни про agent runtime
//! (Rig), ни про UI (Tauri/React), ни про хранилище. Все внешние миры
//! подключаются через порты (трейты), реализуемые адаптерами.

use std::fmt;
use std::future::Future;
use std::pin::Pin;

use futures_core::Stream;

/// Системный промпт по умолчанию.
pub const DEFAULT_PREAMBLE: &str = "Ты — полезный ассистент. Отвечай на языке пользователя.";

/// Роль участника диалога.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

/// Одно сообщение в истории диалога.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

impl ChatMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
        }
    }
}

/// Событие, которое ядро эмитит наружу во время ответа агента.
///
/// Сейчас — только текстовые чанки. По мере роста платформы сюда добавятся
/// события tool calls, approval requests и т.д. — UI и CLI будут зависеть
/// от этого перечисления, а не от типов конкретного agent runtime.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatEvent {
    /// Очередной фрагмент текста ответа.
    Chunk(String),
}

/// Ошибка взаимодействия с агентом.
#[derive(Debug)]
pub struct ChatError(pub String);

impl fmt::Display for ChatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ChatError {}

impl From<String> for ChatError {
    fn from(message: String) -> Self {
        Self(message)
    }
}

/// Поток событий ответа агента.
pub type ChatStream = Pin<Box<dyn Stream<Item = Result<ChatEvent, ChatError>> + Send>>;

/// Порт «агент, умеющий отвечать в чате».
///
/// Реализуется адаптерами (`kotik-agent-rig`, мок-агенты в тестах).
/// Ядро, CLI и UI работают только через этот трейт.
pub trait ChatAgent: Send + Sync {
    /// Начать стриминг ответа на `prompt` с учётом `history`.
    fn stream_reply(
        &self,
        history: Vec<ChatMessage>,
        prompt: String,
    ) -> impl Future<Output = Result<ChatStream, ChatError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_core::Stream;
    use std::pin::Pin;
    use std::task::{Context, Poll};

    /// Мок-агент: отвечает заранее заданными чанками.
    /// Демонстрирует, что весь цикл тестируется без API-ключа и сети.
    struct MockChatAgent {
        chunks: Vec<String>,
    }

    struct MockStream {
        chunks: std::vec::IntoIter<String>,
    }

    impl Stream for MockStream {
        type Item = Result<ChatEvent, ChatError>;

        fn poll_next(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            Poll::Ready(self.chunks.next().map(|c| Ok(ChatEvent::Chunk(c))))
        }
    }

    impl ChatAgent for MockChatAgent {
        async fn stream_reply(
            &self,
            history: Vec<ChatMessage>,
            prompt: String,
        ) -> Result<ChatStream, ChatError> {
            assert!(!prompt.is_empty());
            let _ = history;
            Ok(Box::pin(MockStream {
                chunks: self.chunks.clone().into_iter(),
            }))
        }
    }

    #[tokio::test]
    async fn mock_agent_streams_chunks() {
        let agent = MockChatAgent {
            chunks: vec!["При".into(), "вет".into()],
        };
        let stream = agent
            .stream_reply(vec![ChatMessage::user("hi")], "как дела?".into())
            .await
            .unwrap();

        let collected: Vec<_> = futures_util::StreamExt::collect(stream).await;
        let text: String = collected
            .into_iter()
            .map(|r| match r.unwrap() {
                ChatEvent::Chunk(t) => t,
            })
            .collect();

        assert_eq!(text, "Привет");
    }
}
