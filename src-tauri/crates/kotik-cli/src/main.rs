//! Терминальный чат с DeepSeek через ядро kotik.
//!
//! Это TUI-first harness: весь функционал продукта должен быть доступен
//! без UI. Сейчас — простой REPL-диалог; сюда же позже лягут команды
//! исследовательского цикла (create project, approve intent, run, resume).

use std::io::{self, BufRead, Write};

use futures::StreamExt;
use kotik_agent_rig::RigChatAgent;
use kotik_core::{ChatAgent, ChatEvent, ChatMessage};

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("\nошибка: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), kotik_core::ChatError> {
    let agent = RigChatAgent::from_env()?;
    let stdin = io::stdin();
    let mut history: Vec<ChatMessage> = Vec::new();

    println!("kotik-cli · deepseek-v4-flash · /exit для выхода");

    loop {
        print!("\n> ");
        io::stdout().flush().ok();

        let mut line = String::new();
        if stdin.lock().read_line(&mut line).unwrap_or(0) == 0 {
            break; // EOF (Ctrl+D)
        }
        let prompt = line.trim();
        if prompt.is_empty() {
            continue;
        }
        if prompt == "/exit" {
            break;
        }

        let mut stream = agent
            .stream_reply(history.clone(), prompt.to_string())
            .await?;

        let mut reply = String::new();
        while let Some(event) = stream.next().await {
            match event? {
                ChatEvent::Chunk(text) => {
                    print!("{text}");
                    io::stdout().flush().ok();
                    reply.push_str(&text);
                }
            }
        }
        println!();

        history.push(ChatMessage::user(prompt));
        history.push(ChatMessage::assistant(reply));
    }

    Ok(())
}
