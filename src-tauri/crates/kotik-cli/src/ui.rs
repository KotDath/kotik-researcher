//! Отрисовка кадра TUI из состояния [`App`].
//!
//! Чистая функция состояния: никакого IO, легко тестируется через TestBackend.

use ratatui::layout::{Constraint, Layout, Position};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::{App, EntryRole};

/// Максимальная высота поля ввода (включая рамку).
const MAX_INPUT_HEIGHT: u16 = 10;

/// Отрисовать кадр: область истории + поле ввода.
pub fn draw(frame: &mut Frame, app: &App) {
    let input_height = (app.input().split('\n').count() as u16 + 2).clamp(3, MAX_INPUT_HEIGHT);
    let layout = Layout::vertical([Constraint::Min(1), Constraint::Length(input_height)])
        .split(frame.area());

    draw_history(frame, app, layout[0]);
    draw_input(frame, app, layout[1]);
}

fn draw_history(frame: &mut Frame, app: &App, area: ratatui::layout::Rect) {
    let mut lines: Vec<Line> = Vec::new();
    for entry in app.entries() {
        let (prefix, color) = match entry.role {
            EntryRole::User => ("вы", Color::Cyan),
            EntryRole::Assistant => ("ассистент", Color::Green),
            EntryRole::System => ("система", Color::Yellow),
        };
        lines.push(Line::from(Span::styled(
            prefix,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        )));
        for text_line in entry.text.lines() {
            lines.push(Line::from(text_line.to_owned()));
        }
        lines.push(Line::from(""));
    }

    let paragraph = Paragraph::new(lines)
        .block(Block::bordered().title("история"))
        .wrap(Wrap { trim: false });

    // Скролл: `Some(n)` — на n строк выше низа, `None` — прилипли к низу.
    let inner_width = area.width.saturating_sub(2);
    let inner_height = area.height.saturating_sub(2);
    let total = paragraph.line_count(inner_width) as u16;
    let bottom = total.saturating_sub(inner_height);
    let offset = match app.scroll() {
        Some(from_bottom) => bottom.saturating_sub(from_bottom),
        None => bottom,
    };

    frame.render_widget(paragraph.scroll((offset, 0)), area);
}

fn draw_input(frame: &mut Frame, app: &App, area: ratatui::layout::Rect) {
    let title = if app.streaming() {
        "ввод · идёт ответ…"
    } else {
        "ввод"
    };
    let input = Paragraph::new(app.input()).block(Block::bordered().title(title));
    frame.render_widget(input, area);

    // Курсор: строка/колонка внутри многострочного буфера ввода.
    let before_cursor = &app.input()[..app.cursor()];
    let row = before_cursor.matches('\n').count() as u16;
    let col = before_cursor
        .rsplit('\n')
        .next()
        .unwrap_or_default()
        .chars()
        .count() as u16;
    frame.set_cursor_position(Position::new(
        area.x + 1 + col,
        area.y + 1 + row,
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    /// Содержимое буфера одной строкой (для поиска подстрок).
    fn buffer_text(terminal: &Terminal<TestBackend>) -> String {
        let buffer = terminal.backend().buffer();
        let area = buffer.area;
        let mut text = String::new();
        for y in 0..area.height {
            for x in 0..area.width {
                text.push_str(buffer[(x, y)].symbol());
            }
            text.push('\n');
        }
        text
    }

    fn type_text(app: &mut App, text: &str) {
        for c in text.chars() {
            app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
        }
    }

    #[test]
    fn frame_shows_history_and_input() {
        let mut app = App::new();
        type_text(&mut app, "привет");
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        app.on_chunk("от");
        app.on_chunk("вет");
        app.on_stream_done();
        type_text(&mut app, "следующее");

        let backend = TestBackend::new(80, 24);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| draw(f, &app)).unwrap();

        let text = buffer_text(&terminal);
        assert!(text.contains("привет"), "сообщение пользователя на кадре");
        assert!(text.contains("ответ"), "ответ ассистента на кадре");
        assert!(text.contains("следующее"), "буфер ввода на кадре");
        assert!(text.contains("вы"), "роль пользователя на кадре");
        assert!(text.contains("ассистент"), "роль ассистента на кадре");
        assert!(text.contains("Enter"), "подсказка про клавиши на кадре");
    }

    #[test]
    fn history_sticks_to_bottom() {
        let mut app = App::new();
        for i in 0..30 {
            type_text(&mut app, &format!("вопрос {i}"));
            app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            app.on_chunk(&format!("ответ {i}"));
            app.on_stream_done();
        }

        let backend = TestBackend::new(80, 24);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| draw(f, &app)).unwrap();

        let text = buffer_text(&terminal);
        assert!(
            text.contains("ответ 29"),
            "без ручного скролла виден конец истории"
        );
    }
}
