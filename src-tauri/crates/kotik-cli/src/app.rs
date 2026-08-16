//! Состояние TUI-чата: чистая логика без IO.
//!
//! Редьюсеры `App` покрыты юнит-тестами и не зависят от терминала,
//! ratatui здесь не используется — только типы событий клавиатуры crossterm.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use kotik_core::ChatMessage;

/// Приветственная подсказка про клавиши (показывается системной записью при старте).
pub const WELCOME: &str = "kotik-cli · deepseek-v4-flash\n\
Enter — отправить · Alt+Enter / Ctrl+J — новая строка · \
PgUp/PgDown, ↑/↓ — скролл · /exit или Ctrl+C — выход";

/// Сколько строк истории прокручивает PgUp/PgDown.
const PAGE_SCROLL: u16 = 10;

/// Роль записи в области истории.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryRole {
    User,
    Assistant,
    /// Системное сообщение (подсказка, ошибка). В контекст агента не попадает.
    System,
}

/// Одна запись в области истории.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub role: EntryRole,
    pub text: String,
}

/// Действие, которое цикл событий должен выполнить после обработки клавиши.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Отправить сообщение агенту.
    Submit(String),
    /// Выйти из приложения.
    Quit,
}

/// Состояние чата.
pub struct App {
    entries: Vec<Entry>,
    /// Контекст для агента: только завершённые пары «вопрос-ответ».
    history: Vec<ChatMessage>,
    input: String,
    /// Позиция курсора в `input` (байтовое смещение, всегда на границе символа).
    cursor: usize,
    /// Скролл: `None` — прилипли к низу (автопрокрутка), `Some(n)` — на n строк выше низа.
    scroll: Option<u16>,
    streaming: bool,
    /// Идёт накопление ответа ассистента (последняя запись — его черновик).
    reply_open: bool,
    /// Текущий незавершённый запрос; коммитится в `history` при успешном конце стрима.
    pending_prompt: Option<String>,
}

impl App {
    pub fn new() -> Self {
        Self {
            entries: vec![Entry {
                role: EntryRole::System,
                text: WELCOME.to_string(),
            }],
            history: Vec::new(),
            input: String::new(),
            cursor: 0,
            scroll: None,
            streaming: false,
            reply_open: false,
            pending_prompt: None,
        }
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn input(&self) -> &str {
        &self.input
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn scroll(&self) -> Option<u16> {
        self.scroll
    }

    pub fn streaming(&self) -> bool {
        self.streaming
    }

    /// Завершённая история диалога — контекст для агента.
    pub fn history(&self) -> &[ChatMessage] {
        &self.history
    }

    /// Обработать нажатие клавиши. Возвращает действие для цикла событий.
    pub fn on_key(&mut self, key: KeyEvent) -> Option<Action> {
        match (key.code, key.modifiers) {
            (KeyCode::Char('c'), m) if m.contains(KeyModifiers::CONTROL) => Some(Action::Quit),
            // Многострочный ввод: Shift+Enter (если терминал различает), Alt+Enter, Ctrl+J.
            (KeyCode::Enter, m) if m.intersects(KeyModifiers::SHIFT | KeyModifiers::ALT) => {
                self.insert('\n');
                None
            }
            (KeyCode::Char('j'), m) if m.contains(KeyModifiers::CONTROL) => {
                self.insert('\n');
                None
            }
            (KeyCode::Enter, _) => {
                // Пока идёт стриминг, отправка заблокирована (ввод редактируется).
                if self.streaming {
                    return None;
                }
                let text = self.input.trim();
                if text.is_empty() {
                    return None;
                }
                if text == "/exit" {
                    return Some(Action::Quit);
                }
                Some(Action::Submit(self.submit()))
            }
            (KeyCode::Char(c), m) if !m.contains(KeyModifiers::CONTROL) => {
                self.insert(c);
                None
            }
            (KeyCode::Backspace, _) => {
                self.backspace();
                None
            }
            (KeyCode::Delete, _) => {
                self.delete();
                None
            }
            (KeyCode::Left, _) => {
                self.move_cursor_left();
                None
            }
            (KeyCode::Right, _) => {
                self.move_cursor_right();
                None
            }
            (KeyCode::Home, _) => {
                self.cursor = 0;
                None
            }
            (KeyCode::End, _) => {
                self.cursor = self.input.len();
                None
            }
            (KeyCode::Up, _) => {
                self.scroll_up(1);
                None
            }
            (KeyCode::Down, _) => {
                self.scroll_down(1);
                None
            }
            (KeyCode::PageUp, _) => {
                self.scroll_up(PAGE_SCROLL);
                None
            }
            (KeyCode::PageDown, _) => {
                self.scroll_down(PAGE_SCROLL);
                None
            }
            _ => None,
        }
    }

    /// Очередной чанк ответа ассистента.
    pub fn on_chunk(&mut self, text: &str) {
        if !self.streaming {
            return;
        }
        if !self.reply_open {
            self.entries.push(Entry {
                role: EntryRole::Assistant,
                text: String::new(),
            });
            self.reply_open = true;
        }
        if let Some(last) = self.entries.last_mut() {
            last.text.push_str(text);
        }
    }

    /// Стрим завершился успешно: коммитим пару «вопрос-ответ» в историю агента.
    pub fn on_stream_done(&mut self) {
        if !self.streaming {
            return;
        }
        self.streaming = false;
        if self.reply_open {
            let reply = self.entries.last().map(|e| e.text.clone()).unwrap_or_default();
            if let Some(prompt) = self.pending_prompt.take() {
                self.history.push(ChatMessage::user(prompt));
                self.history.push(ChatMessage::assistant(reply));
            }
        } else {
            self.pending_prompt = None;
        }
        self.reply_open = false;
    }

    /// Стрим завершился ошибкой: системное сообщение, история агента не меняется.
    pub fn on_stream_error(&mut self, error: &str) {
        if !self.streaming {
            return;
        }
        self.streaming = false;
        self.reply_open = false;
        self.pending_prompt = None;
        self.entries.push(Entry {
            role: EntryRole::System,
            text: format!("ошибка: {error}"),
        });
    }

    /// Зафиксировать отправку: запись в историю экрана, сброс ввода, прилипание к низу.
    fn submit(&mut self) -> String {
        let text = std::mem::take(&mut self.input);
        self.cursor = 0;
        self.streaming = true;
        self.scroll = None;
        self.pending_prompt = Some(text.clone());
        self.entries.push(Entry {
            role: EntryRole::User,
            text: text.clone(),
        });
        text
    }

    fn insert(&mut self, c: char) {
        self.input.insert(self.cursor, c);
        self.cursor += c.len_utf8();
    }

    fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let prev = self.input[..self.cursor]
            .char_indices()
            .last()
            .map(|(i, _)| i)
            .unwrap_or(0);
        self.input.replace_range(prev..self.cursor, "");
        self.cursor = prev;
    }

    fn delete(&mut self) {
        if self.cursor >= self.input.len() {
            return;
        }
        let next = self.cursor + self.input[self.cursor..].chars().next().map_or(0, char::len_utf8);
        self.input.replace_range(self.cursor..next, "");
    }

    fn move_cursor_left(&mut self) {
        if self.cursor > 0 {
            self.cursor = self.input[..self.cursor]
                .char_indices()
                .last()
                .map(|(i, _)| i)
                .unwrap_or(0);
        }
    }

    fn move_cursor_right(&mut self) {
        if self.cursor < self.input.len() {
            self.cursor += self.input[self.cursor..]
                .chars()
                .next()
                .map_or(0, char::len_utf8);
        }
    }

    fn scroll_up(&mut self, lines: u16) {
        self.scroll = Some(self.scroll.unwrap_or(0).saturating_add(lines));
    }

    fn scroll_down(&mut self, lines: u16) {
        if let Some(current) = self.scroll {
            let next = current.saturating_sub(lines);
            // Достигли низа — снова прилипаем (автопрокрутка за чанками).
            self.scroll = if next == 0 { None } else { Some(next) };
        }
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kotik_core::Role;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn key_mod(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
        KeyEvent::new(code, modifiers)
    }

    fn type_text(app: &mut App, text: &str) {
        for c in text.chars() {
            app.on_key(key(KeyCode::Char(c)));
        }
    }

    /// Прогон полного успешного обмена: ввод → submit → чанки → done.
    fn exchange(app: &mut App, prompt: &str, chunks: &[&str]) {
        type_text(app, prompt);
        let action = app.on_key(key(KeyCode::Enter));
        assert_eq!(action, Some(Action::Submit(prompt.to_string())));
        for chunk in chunks {
            app.on_chunk(chunk);
        }
        app.on_stream_done();
    }

    #[test]
    fn typing_and_multiline_input() {
        let mut app = App::new();
        type_text(&mut app, "привет");

        // Alt+Enter и Ctrl+J вставляют перевод строки, не отправляют.
        assert_eq!(
            app.on_key(key_mod(KeyCode::Enter, KeyModifiers::ALT)),
            None
        );
        assert_eq!(
            app.on_key(key_mod(KeyCode::Char('j'), KeyModifiers::CONTROL)),
            None
        );
        // Shift+Enter — тоже перевод строки (терминалы с kitty protocol).
        assert_eq!(
            app.on_key(key_mod(KeyCode::Enter, KeyModifiers::SHIFT)),
            None
        );
        type_text(&mut app, "мир");

        assert_eq!(app.input(), "привет\n\n\nмир");
        assert!(app.entries().iter().all(|e| e.role != EntryRole::User));
    }

    #[test]
    fn editing_cursor_and_backspace() {
        let mut app = App::new();
        type_text(&mut app, "абв");
        app.on_key(key(KeyCode::Left));
        app.on_key(key(KeyCode::Backspace));
        assert_eq!(app.input(), "ав");
        app.on_key(key(KeyCode::Right));
        app.on_key(key(KeyCode::Delete)); // в конце — no-op
        assert_eq!(app.input(), "ав");
    }

    #[test]
    fn enter_on_empty_input_does_nothing() {
        let mut app = App::new();
        assert_eq!(app.on_key(key(KeyCode::Enter)), None);
        assert!(!app.streaming());
    }

    #[test]
    fn exit_command_and_ctrl_c_quit() {
        let mut app = App::new();
        type_text(&mut app, "/exit");
        assert_eq!(app.on_key(key(KeyCode::Enter)), Some(Action::Quit));
        assert_eq!(
            app.on_key(key_mod(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            Some(Action::Quit)
        );
    }

    #[test]
    fn successful_exchange_commits_history() {
        let mut app = App::new();
        exchange(&mut app, "как дела?", &["хоро", "шо"]);

        let roles: Vec<_> = app.entries().iter().map(|e| e.role).collect();
        assert_eq!(
            roles,
            vec![EntryRole::System, EntryRole::User, EntryRole::Assistant]
        );
        assert_eq!(app.entries()[2].text, "хорошо");
        assert!(!app.streaming());

        let history = app.history();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, Role::User);
        assert_eq!(history[0].content, "как дела?");
        assert_eq!(history[1].role, Role::Assistant);
        assert_eq!(history[1].content, "хорошо");
    }

    #[test]
    fn enter_is_ignored_while_streaming() {
        let mut app = App::new();
        type_text(&mut app, "первый");
        assert!(matches!(
            app.on_key(key(KeyCode::Enter)),
            Some(Action::Submit(_))
        ));
        // Стрим идёт: Enter не отправляет, но ввод продолжает редактироваться.
        type_text(&mut app, "второй");
        assert_eq!(app.on_key(key(KeyCode::Enter)), None);
        assert_eq!(app.input(), "второй");
        app.on_stream_done();
    }

    #[test]
    fn stream_error_becomes_system_entry_and_keeps_history_clean() {
        let mut app = App::new();
        type_text(&mut app, "вопрос");
        app.on_key(key(KeyCode::Enter));
        app.on_chunk("частичный");
        app.on_stream_error("сеть упала");

        let last = app.entries().last().unwrap();
        assert_eq!(last.role, EntryRole::System);
        assert!(last.text.contains("сеть упала"));
        assert!(!app.streaming());
        assert!(app.history().is_empty(), "история агента не загрязнена");

        // Диалог можно продолжить.
        exchange(&mut app, "ещё раз", &["ок"]);
        assert_eq!(app.history().len(), 2);
    }

    #[test]
    fn scroll_detaches_and_reattaches_to_bottom() {
        let mut app = App::new();
        assert_eq!(app.scroll(), None, "по умолчанию прилипли к низу");

        app.on_key(key(KeyCode::PageUp));
        assert_eq!(app.scroll(), Some(10));
        app.on_key(key(KeyCode::Up));
        assert_eq!(app.scroll(), Some(11));

        app.on_key(key(KeyCode::Down));
        assert_eq!(app.scroll(), Some(10));
        app.on_key(key(KeyCode::PageDown));
        assert_eq!(app.scroll(), None, "достигли низа — снова прилипли");

        // Прокрутка вниз при прилипании — no-op.
        app.on_key(key(KeyCode::Down));
        assert_eq!(app.scroll(), None);
    }

    #[test]
    fn submit_reattaches_scroll() {
        let mut app = App::new();
        app.on_key(key(KeyCode::PageUp));
        assert!(app.scroll().is_some());
        exchange(&mut app, "привет", &["ок"]);
        assert_eq!(app.scroll(), None);
    }
}
