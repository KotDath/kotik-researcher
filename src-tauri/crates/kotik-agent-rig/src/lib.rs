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

    /// Создаёт агента с явным base_url и ключом (для тестов с локальным сервером).
    pub fn with_base_url(base_url: &str, api_key: &str) -> Result<Self, ChatError> {
        let client = deepseek::Client::builder()
            .api_key(api_key)
            .base_url(base_url)
            .build()
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

        // Базовый чат отключает thinking: иначе deepseek-v4-flash сначала
        // стримит reasoning_content до минуты, а видимый ответ приходит
        // короткой очередью в конце — пользователь не видит стриминга.
        let stream = self
            .model
            .completion_request(prompt)
            .preamble(DEFAULT_PREAMBLE.to_string())
            .messages(messages)
            .additional_params(serde_json::json!({"thinking": {"type": "disabled"}}))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Прочитать один HTTP-запрос целиком (заголовки + тело по Content-Length).
    fn read_http_request(stream: &mut std::net::TcpStream) -> String {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        let mut content_length = None;
        loop {
            let n = stream.read(&mut chunk).unwrap();
            assert!(n > 0, "соединение закрыто до конца запроса");
            buf.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&buf);
            if let Some(head_end) = text.find("\r\n\r\n") {
                if content_length.is_none() {
                    content_length = text[..head_end].lines().find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    });
                    if content_length.is_none() {
                        return text.into_owned();
                    }
                }
                if buf.len() >= head_end + 4 + content_length.unwrap() {
                    return text.into_owned();
                }
            }
        }
    }

    fn sse_chunk(delta: &str) -> String {
        format!(
            "data: {{\"id\":\"x\",\"object\":\"chat.completion.chunk\",\"created\":0,\
             \"model\":\"deepseek-v4-flash\",\"choices\":[{{\"index\":0,\"delta\":{{{delta}}},\
             \"finish_reason\":null}}]}}\n\n"
        )
    }

    /// Регрессия: запрос обязан отключать thinking (`"thinking":{"type":"disabled"}`),
    /// иначе deepseek-v4-flash стримит reasoning_content до минуты, а видимый
    /// ответ приходит в конце — пользователь не видит стриминга.
    #[tokio::test]
    async fn disables_thinking_and_streams_text() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            let body = format!(
                "{}{}{}data: [DONE]\n\n",
                sse_chunk("\"role\":\"assistant\",\"reasoning_content\":\"думаю\""),
                sse_chunk("\"content\":\"При\""),
                sse_chunk("\"content\":\"вет\""),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\
                 cache-control: no-cache\r\nconnection: close\r\n\r\n{body}"
            );
            stream.write_all(response.as_bytes()).unwrap();
            stream.flush().unwrap();
            request
        });

        let agent = RigChatAgent::with_base_url(&format!("http://{addr}"), "test-key").unwrap();
        let stream = agent.stream_reply(vec![], "привет".into()).await.unwrap();
        let events: Vec<_> = futures::StreamExt::collect(stream).await;
        let text: String = events
            .into_iter()
            .map(|r| match r.unwrap() {
                ChatEvent::Chunk(t) => t,
            })
            .collect();

        let request = server.join().unwrap();
        let body = request.split("\r\n\r\n").nth(1).unwrap_or("");
        assert!(
            body.contains(r#""thinking":{"type":"disabled"}"#),
            "в теле запроса нет отключения thinking: {body}"
        );
        assert_eq!(text, "Привет", "reasoning-чанки не должны попадать в вывод");
    }
}
