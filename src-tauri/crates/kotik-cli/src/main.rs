//! Терминальный чат с DeepSeek через ядро kotik: полноценный TUI на ratatui.
//!
//! Это TUI-first harness: весь функционал продукта должен быть доступен
//! без десктоп-окна. Сюда же позже лягут команды исследовательского цикла
//! (create project, approve intent, run, resume).

mod app;
mod ui;

use std::error::Error;
use std::io::{self, stdout};
use std::sync::Arc;

use crossterm::event::{Event, EventStream, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use futures::StreamExt;
use kotik_agent_rig::RigChatAgent;
use kotik_core::{ChatAgent, ChatEvent};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use tokio::sync::mpsc;

use app::{Action, App};

/// RAII-guard терминала: восстанавливает raw mode и alternate screen
/// при выходе из `run`, в том числе при размотке стека после паники.
struct TerminalGuard;

impl TerminalGuard {
    fn enter() -> io::Result<Self> {
        enable_raw_mode()?;
        execute!(stdout(), EnterAlternateScreen)?;
        Ok(Self)
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(stdout(), LeaveAlternateScreen);
    }
}

/// Сообщения от задачи стриминга в цикл событий.
enum StreamMsg {
    Chunk(String),
    Done,
    Error(String),
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("ошибка: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn Error>> {
    // Агент создаётся до поднятия TUI: без DEEPSEEK_API_KEY падаем сразу.
    let agent = Arc::new(RigChatAgent::from_env()?);

    let _guard = TerminalGuard::enter()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    let mut app = App::new();
    let mut events = EventStream::new();
    let (tx, mut rx) = mpsc::unbounded_channel::<StreamMsg>();

    loop {
        terminal.draw(|f| ui::draw(f, &app))?;

        tokio::select! {
            maybe_event = events.next() => {
                match maybe_event {
                    Some(Ok(Event::Key(key))) => {
                        if key.kind != KeyEventKind::Press {
                            continue;
                        }
                        match app.on_key(key) {
                            Some(Action::Quit) => break,
                            Some(Action::Submit(text)) => {
                                spawn_stream(Arc::clone(&agent), app.history().to_vec(), text, tx.clone());
                            }
                            None => {}
                        }
                    }
                    Some(Ok(_)) => {} // resize и прочие события: кадр перерисуется на след. итерации
                    Some(Err(e)) => return Err(e.into()),
                    None => break, // stdin закрыт (EOF)
                }
            }
            msg = rx.recv() => {
                match msg {
                    Some(StreamMsg::Chunk(text)) => app.on_chunk(&text),
                    Some(StreamMsg::Done) => app.on_stream_done(),
                    Some(StreamMsg::Error(e)) => app.on_stream_error(&e),
                    // Все отправители закрыты; tx живёт в этом цикле, так что unreachable,
                    // но выходить по закрытому каналу безопасно.
                    None => break,
                }
            }
        }
    }

    Ok(())
}

/// Запустить стрим ответа агента в отдельной задаче (D3): задача гонит
/// `stream_reply` и шлёт события в канал; владелец `App` — цикл событий.
fn spawn_stream(
    agent: Arc<RigChatAgent>,
    history: Vec<kotik_core::ChatMessage>,
    prompt: String,
    tx: mpsc::UnboundedSender<StreamMsg>,
) {
    tokio::spawn(async move {
        let mut stream = match agent.stream_reply(history, prompt).await {
            Ok(stream) => stream,
            Err(e) => {
                let _ = tx.send(StreamMsg::Error(e.to_string()));
                return;
            }
        };
        while let Some(item) = stream.next().await {
            match item {
                Ok(ChatEvent::Chunk(text)) => {
                    if tx.send(StreamMsg::Chunk(text)).is_err() {
                        return; // приложение закрывается
                    }
                }
                Err(e) => {
                    let _ = tx.send(StreamMsg::Error(e.to_string()));
                    return;
                }
            }
        }
        let _ = tx.send(StreamMsg::Done);
    });
}
