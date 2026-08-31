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
use tokio::task::JoinHandle;

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
/// `generation` — номер поколения стрима (инкремент на каждом submit):
/// по нему цикл событий отличает запоздавшие сообщения прерванного стрима
/// от сообщений текущего (design D3).
enum StreamMsg {
    Chunk { generation: u64, text: String },
    Done { generation: u64 },
    Error { generation: u64, error: String },
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
    // Хэндл активной задачи стриминга (design D1): по нему `abort()` при Cancel.
    let mut stream_handle: Option<JoinHandle<()>> = None;
    // Номер поколения текущего стрима (design D3): инкремент на каждом submit,
    // сообщения старых поколений отбрасываются циклом событий.
    let mut generation: u64 = 0;

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
                                generation = generation.wrapping_add(1);
                                let gen = generation;
                                stream_handle = Some(spawn_stream(
                                    Arc::clone(&agent),
                                    app.history().to_vec(),
                                    text,
                                    tx.clone(),
                                    gen,
                                ));
                            }
                            Some(Action::Cancel) => {
                                // Дизайн D1, D3: abort дропает задачу и её стрим;
                                // запоздалые сообщения из канала отбрасываются
                                // циклом событий по поколению либо состоянием
                                // (`on_*` — no-op при streaming == false).
                                if let Some(handle) = stream_handle.take() {
                                    handle.abort();
                                }
                                app.on_cancel();
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
                    Some(msg) => handle_stream_msg(&mut app, msg, generation, &mut stream_handle),
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
/// Возвращает `JoinHandle`, по которому цикл событий отменяет стрим (D1).
/// Все сообщения несут `generation` текущего стрима (design D3).
fn spawn_stream(
    agent: Arc<RigChatAgent>,
    history: Vec<kotik_core::ChatMessage>,
    prompt: String,
    tx: mpsc::UnboundedSender<StreamMsg>,
    generation: u64,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut stream = match agent.stream_reply(history, prompt).await {
            Ok(stream) => stream,
            Err(e) => {
                let _ = tx.send(StreamMsg::Error {
                    generation,
                    error: e.to_string(),
                });
                return;
            }
        };
        while let Some(item) = stream.next().await {
            match item {
                Ok(ChatEvent::Chunk(text)) => {
                    if tx.send(StreamMsg::Chunk { generation, text }).is_err() {
                        return; // приложение закрывается
                    }
                }
                Err(e) => {
                    let _ = tx.send(StreamMsg::Error {
                        generation,
                        error: e.to_string(),
                    });
                    return;
                }
            }
        }
        let _ = tx.send(StreamMsg::Done { generation });
    })
}

/// Обработать сообщение из канала стрима (design D3): сообщения чужих
/// поколений отбрасываются здесь, до вызова редьюсеров `App`, чтобы
/// запоздавший Chunk/Done прерванного стрима не попал в новый запрос.
/// `Done`/`Error` текущего поколения обнуляют хэндл задачи.
fn handle_stream_msg(
    app: &mut App,
    msg: StreamMsg,
    generation: u64,
    stream_handle: &mut Option<JoinHandle<()>>,
) {
    match msg {
        StreamMsg::Chunk {
            generation: gen,
            text,
        } if gen == generation => app.on_chunk(&text),
        StreamMsg::Done { generation: gen } if gen == generation => {
            app.on_stream_done();
            *stream_handle = None;
        }
        StreamMsg::Error {
            generation: gen,
            error,
        } if gen == generation => {
            app.on_stream_error(&error);
            *stream_handle = None;
        }
        // Чужие поколения: запоздалые сообщения отменённого/старого стрима.
        StreamMsg::Chunk { .. } | StreamMsg::Done { .. } | StreamMsg::Error { .. } => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app::App;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn type_text(app: &mut App, text: &str) {
        for c in text.chars() {
            app.on_key(key(KeyCode::Char(c)));
        }
    }

    /// Регрессия на гонку «отмена → новый запрос» (design D3): запоздалые
    /// Chunk/Done/Error отменённого стрима (старое поколение) не должны
    /// попасть в новый стрим. Воспроизводит последовательность из ревью:
    /// submit(old) → on_cancel() → submit(new) → on_chunk("old late")
    /// → on_stream_done().
    #[test]
    fn late_messages_from_cancelled_stream_do_not_affect_new_stream() {
        let mut app = App::new();
        let mut stream_handle: Option<JoinHandle<()>> = None;

        // submit(old): поколение 1.
        let mut generation = 0u64;
        generation = generation.wrapping_add(1);
        type_text(&mut app, "old");
        app.on_key(key(KeyCode::Enter));
        app.on_chunk("old part");
        app.on_cancel();

        // submit(new): поколение 2, стрим жив.
        generation = generation.wrapping_add(1);
        type_text(&mut app, "new");
        app.on_key(key(KeyCode::Enter));
        assert!(app.streaming());

        // Запоздалые сообщения старого стрима: отбрасываются до редьюсеров.
        handle_stream_msg(
            &mut app,
            StreamMsg::Chunk {
                generation: 1,
                text: "old late".into(),
            },
            generation,
            &mut stream_handle,
        );
        handle_stream_msg(
            &mut app,
            StreamMsg::Done { generation: 1 },
            generation,
            &mut stream_handle,
        );
        handle_stream_msg(
            &mut app,
            StreamMsg::Error {
                generation: 1,
                error: "old err".into(),
            },
            generation,
            &mut stream_handle,
        );

        // Новый стрим не тронут: история не загрязнена, стриминг продолжается.
        assert!(app.streaming(), "новый стрим жив");
        assert!(app.history().is_empty(), "старый Done не закоммитил пару");

        // Новый стрим (поколение 2) завершается штатно.
        handle_stream_msg(
            &mut app,
            StreamMsg::Chunk {
                generation: 2,
                text: "new chunk".into(),
            },
            generation,
            &mut stream_handle,
        );
        handle_stream_msg(
            &mut app,
            StreamMsg::Done { generation: 2 },
            generation,
            &mut stream_handle,
        );

        assert!(!app.streaming());
        assert_eq!(app.history().len(), 2);
        assert_eq!(app.history()[0].content, "new");
        assert_eq!(app.history()[1].content, "new chunk");
    }
}
