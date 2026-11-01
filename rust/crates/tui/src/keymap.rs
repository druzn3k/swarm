//! The keyboard state machine: keys in, [`Action`]s out. Pure (time is an
//! argument), so the numeric prefix and the modes are unit-tested.
//!
//! Digits are both tab numbers and count prefixes (`100b`). A digit 1-9 on
//! its own waits up to [`TAB_DIGIT_TIMEOUT`]: another digit or a key that
//! takes a count (`b`, `u`, `j`, `k`, arrows) makes it a prefix; any other
//! key, Enter or the timeout switches to that tab. `Alt-<digit>` switches at
//! once.

use std::time::{Duration, Instant};

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

/// How long a lone digit waits before it switches tabs.
pub const TAB_DIGIT_TIMEOUT: Duration = Duration::from_millis(400);

/// What a key asks for. The app interprets it in context (an open overlay
/// takes [`Action::Back`] and [`Action::Yes`] first).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Save and quit.
    Quit,
    /// Next tab (Tab).
    NextTab,
    /// Previous tab (Shift-Tab).
    PrevTab,
    /// Tab by number, 1-based.
    GotoTab(usize),
    /// Move the selection by this many rows.
    Move(i64),
    /// First row.
    Top,
    /// Last row.
    Bottom,
    /// Down (or up, negative) by pages.
    Page(i64),
    /// Enter: open the unit, focus its upgrades, confirm.
    Open,
    /// Esc: back out, close, cancel.
    Back,
    /// Buy the selected unit: the count prefix, or 1.
    BuyUnit(Option<String>),
    /// Buy the max of the selected unit.
    BuyUnitMax,
    /// Buy levels of the selected upgrade: the count prefix, or 1.
    BuyUpgrade(Option<String>),
    /// Buy the max of the selected upgrade.
    BuyUpgradeMax,
    /// Open the command line with `buy <unit> ` (any `parse_number` input).
    QtyPrompt,
    /// The ascension panel.
    Ascend,
    /// Respec (asks first).
    Respec,
    /// Undo (or redo).
    Undo,
    /// The help overlay.
    Help,
    /// Toggle mouse capture.
    ToggleMouse,
    /// Toggle animation.
    ToggleAnim,
    /// Toggle short/long numbers.
    ToggleFormat,
    /// `y`: confirm a question.
    Yes,
    /// `n`: refuse a question.
    No,
    /// Repaint everything (Ctrl-L).
    Redraw,
    /// The command line was entered.
    Submit(String),
    /// Tab on the command line: the app completes [`Keymap::line`].
    Complete,
}

/// Normal keys, or typing a command line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Keys are commands.
    Normal,
    /// Typing after `:`.
    Command,
}

/// The keyboard state.
#[derive(Clone, Debug)]
pub struct Keymap {
    /// The mode.
    pub mode: Mode,
    /// Count prefix typed so far.
    pub prefix: String,
    /// A lone digit waiting to become a tab switch or a prefix.
    pending_tab: Option<(u8, Instant)>,
    /// The command line.
    pub line: String,
    /// Cursor in `line`, in chars.
    pub cursor: usize,
    history: Vec<String>,
    hist_pos: Option<usize>,
}

impl Default for Keymap {
    fn default() -> Keymap {
        Keymap::new()
    }
}

fn takes_count(code: KeyCode) -> bool {
    matches!(
        code,
        KeyCode::Char('b' | 'u' | 'j' | 'k') | KeyCode::Down | KeyCode::Up
    )
}

impl Keymap {
    /// Normal mode, nothing pending.
    pub fn new() -> Keymap {
        Keymap {
            mode: Mode::Normal,
            prefix: String::new(),
            pending_tab: None,
            line: String::new(),
            cursor: 0,
            history: Vec::new(),
            hist_pos: None,
        }
    }

    /// What the status bar shows as pending: the prefix or lone digit.
    pub fn pending(&self) -> Option<String> {
        if let Some((d, _)) = self.pending_tab {
            Some(d.to_string())
        } else if !self.prefix.is_empty() {
            Some(self.prefix.clone())
        } else {
            None
        }
    }

    /// Opens the command line, pre-filled.
    pub fn open_line(&mut self, text: &str) {
        self.mode = Mode::Command;
        self.line = text.to_owned();
        self.cursor = self.line.chars().count();
        self.hist_pos = None;
        self.prefix.clear();
        self.pending_tab = None;
    }

    /// Replaces the command line text (after completion).
    pub fn set_line(&mut self, text: String) {
        self.line = text;
        self.cursor = self.line.chars().count();
    }

    /// Time passes: a lone digit that waited long enough switches tabs.
    pub fn tick(&mut self, now: Instant) -> Option<Action> {
        match self.pending_tab {
            Some((d, at)) if now.duration_since(at) >= TAB_DIGIT_TIMEOUT => {
                self.pending_tab = None;
                Some(Action::GotoTab(d as usize))
            }
            _ => None,
        }
    }

    /// A key press. May give two actions (a pending tab switch, then the
    /// key's own).
    pub fn key(&mut self, k: KeyEvent, now: Instant) -> Vec<Action> {
        if k.kind == KeyEventKind::Release {
            return Vec::new();
        }
        match self.mode {
            Mode::Normal => self.normal(k, now),
            Mode::Command => self.command(k).into_iter().collect(),
        }
    }

    fn normal(&mut self, k: KeyEvent, now: Instant) -> Vec<Action> {
        let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
        let alt = k.modifiers.contains(KeyModifiers::ALT);
        let mut out = Vec::new();
        if let KeyCode::Char(c @ '0'..='9') = k.code {
            let d = c as u8 - b'0';
            if alt {
                self.prefix.clear();
                self.pending_tab = None;
                return vec![Action::GotoTab(if d == 0 { 10 } else { d as usize })];
            }
            if let Some((p, _)) = self.pending_tab.take() {
                self.prefix = format!("{p}{d}");
            } else if !self.prefix.is_empty() {
                if self.prefix.len() < 18 {
                    self.prefix.push(c);
                }
            } else if d == 0 {
                return vec![Action::GotoTab(10)];
            } else {
                self.pending_tab = Some((d, now));
            }
            return out;
        }
        if let Some((p, _)) = self.pending_tab.take() {
            match k.code {
                KeyCode::Esc => return out,
                KeyCode::Enter => return vec![Action::GotoTab(p as usize)],
                code if takes_count(code) && !ctrl => self.prefix = p.to_string(),
                _ => out.push(Action::GotoTab(p as usize)),
            }
        }
        let count = std::mem::take(&mut self.prefix);
        let count = (!count.is_empty()).then_some(count);
        let n = || {
            count
                .as_deref()
                .and_then(|c| c.parse::<i64>().ok())
                .unwrap_or(1)
        };
        let action = match k.code {
            KeyCode::Char('c') if ctrl => Some(Action::Quit),
            KeyCode::Char('l') if ctrl => Some(Action::Redraw),
            KeyCode::Char('d') if ctrl => Some(Action::Page(1)),
            KeyCode::Char('u') if ctrl => Some(Action::Page(-1)),
            KeyCode::Esc if count.is_some() => None,
            KeyCode::Esc => Some(Action::Back),
            KeyCode::Char('q') => Some(Action::Quit),
            KeyCode::Tab => Some(Action::NextTab),
            KeyCode::BackTab => Some(Action::PrevTab),
            KeyCode::Char('j') | KeyCode::Down => Some(Action::Move(n())),
            KeyCode::Char('k') | KeyCode::Up => Some(Action::Move(-n())),
            KeyCode::Char('g') | KeyCode::Home => Some(Action::Top),
            KeyCode::Char('G') | KeyCode::End => Some(Action::Bottom),
            KeyCode::PageDown => Some(Action::Page(1)),
            KeyCode::PageUp => Some(Action::Page(-1)),
            KeyCode::Enter | KeyCode::Char('l') | KeyCode::Right => Some(Action::Open),
            KeyCode::Char('h') | KeyCode::Left | KeyCode::Backspace => Some(Action::Back),
            KeyCode::Char('b') => Some(Action::BuyUnit(count)),
            KeyCode::Char('B') => Some(Action::BuyUnitMax),
            KeyCode::Char('u') => Some(Action::BuyUpgrade(count)),
            KeyCode::Char('U') => Some(Action::BuyUpgradeMax),
            KeyCode::Char('%') | KeyCode::Char('i') => Some(Action::QtyPrompt),
            KeyCode::Char('a') => Some(Action::Ascend),
            KeyCode::Char('r') => Some(Action::Respec),
            KeyCode::Char('z') => Some(Action::Undo),
            KeyCode::Char('?') | KeyCode::F(1) => Some(Action::Help),
            KeyCode::Char('m') => Some(Action::ToggleMouse),
            KeyCode::Char('A') => Some(Action::ToggleAnim),
            KeyCode::Char('f') => Some(Action::ToggleFormat),
            KeyCode::Char('y') => Some(Action::Yes),
            KeyCode::Char('n') => Some(Action::No),
            KeyCode::Char(':') => {
                self.open_line("");
                None
            }
            _ => None,
        };
        out.extend(action);
        out
    }

    fn byte_at(&self, char_idx: usize) -> usize {
        self.line
            .char_indices()
            .nth(char_idx)
            .map_or(self.line.len(), |(i, _)| i)
    }

    fn leave(&mut self) {
        self.mode = Mode::Normal;
        self.line.clear();
        self.cursor = 0;
        self.hist_pos = None;
    }

    fn command(&mut self, k: KeyEvent) -> Option<Action> {
        let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
        match k.code {
            KeyCode::Esc => self.leave(),
            KeyCode::Char('c') if ctrl => self.leave(),
            KeyCode::Enter => {
                let line = self.line.trim().to_owned();
                self.leave();
                if line.is_empty() {
                    return None;
                }
                if self.history.last() != Some(&line) {
                    self.history.push(line.clone());
                }
                return Some(Action::Submit(line));
            }
            KeyCode::Tab => return Some(Action::Complete),
            KeyCode::Backspace => {
                if self.line.is_empty() {
                    self.leave();
                } else if self.cursor > 0 {
                    let at = self.byte_at(self.cursor - 1);
                    self.line.remove(at);
                    self.cursor -= 1;
                }
            }
            KeyCode::Delete => {
                if self.cursor < self.line.chars().count() {
                    let at = self.byte_at(self.cursor);
                    self.line.remove(at);
                }
            }
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(self.line.chars().count()),
            KeyCode::Home => self.cursor = 0,
            KeyCode::Char('a') if ctrl => self.cursor = 0,
            KeyCode::End => self.cursor = self.line.chars().count(),
            KeyCode::Char('e') if ctrl => self.cursor = self.line.chars().count(),
            KeyCode::Char('u') if ctrl => {
                let at = self.byte_at(self.cursor);
                self.line.replace_range(..at, "");
                self.cursor = 0;
            }
            KeyCode::Char('w') if ctrl => {
                let at = self.byte_at(self.cursor);
                let head = self.line[..at].trim_end();
                let start = head.rfind(' ').map_or(0, |i| i + 1);
                self.line.replace_range(start..at, "");
                self.cursor = self.line[..start].chars().count();
            }
            KeyCode::Up => {
                if !self.history.is_empty() {
                    let i = match self.hist_pos {
                        None => self.history.len() - 1,
                        Some(i) => i.saturating_sub(1),
                    };
                    self.hist_pos = Some(i);
                    self.set_line(self.history[i].clone());
                }
            }
            KeyCode::Down => match self.hist_pos {
                Some(i) if i + 1 < self.history.len() => {
                    self.hist_pos = Some(i + 1);
                    self.set_line(self.history[i + 1].clone());
                }
                Some(_) => {
                    self.hist_pos = None;
                    self.set_line(String::new());
                }
                None => {}
            },
            KeyCode::Char(c) if !ctrl => {
                let at = self.byte_at(self.cursor);
                self.line.insert(at, c);
                self.cursor += 1;
            }
            _ => {}
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(c: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE)
    }
    fn code(c: KeyCode) -> KeyEvent {
        KeyEvent::new(c, KeyModifiers::NONE)
    }
    fn typed(km: &mut Keymap, s: &str, now: Instant) -> Vec<Action> {
        s.chars().flat_map(|c| km.key(key(c), now)).collect()
    }

    #[test]
    fn numeric_prefix_buys_that_many() {
        let t = Instant::now();
        let mut km = Keymap::new();
        assert_eq!(
            typed(&mut km, "100b", t),
            vec![Action::BuyUnit(Some("100".into()))]
        );
        assert_eq!(
            typed(&mut km, "5b", t),
            vec![Action::BuyUnit(Some("5".into()))]
        );
        assert_eq!(typed(&mut km, "b", t), vec![Action::BuyUnit(None)]);
        assert_eq!(
            typed(&mut km, "25u", t),
            vec![Action::BuyUpgrade(Some("25".into()))]
        );
        assert_eq!(typed(&mut km, "B", t), vec![Action::BuyUnitMax]);
        assert_eq!(typed(&mut km, "U", t), vec![Action::BuyUpgradeMax]);
        assert_eq!(typed(&mut km, "3j", t), vec![Action::Move(3)]);
        assert_eq!(typed(&mut km, "12k", t), vec![Action::Move(-12)]);
        assert!(km.pending().is_none());
    }

    #[test]
    fn lone_digits_switch_tabs() {
        let t = Instant::now();
        let mut km = Keymap::new();
        assert_eq!(typed(&mut km, "2", t), vec![]);
        assert_eq!(km.pending().as_deref(), Some("2"));
        assert_eq!(km.tick(t + Duration::from_millis(100)), None);
        assert_eq!(km.tick(t + TAB_DIGIT_TIMEOUT), Some(Action::GotoTab(2)));
        assert!(km.pending().is_none());
        // a non-count key right away switches first, then acts
        assert_eq!(
            typed(&mut km, "3?", t),
            vec![Action::GotoTab(3), Action::Help]
        );
        assert_eq!(typed(&mut km, "4", t), vec![]);
        assert_eq!(km.key(code(KeyCode::Enter), t), vec![Action::GotoTab(4)]);
        // Esc cancels a pending digit or prefix
        typed(&mut km, "4", t);
        assert_eq!(km.key(code(KeyCode::Esc), t), vec![]);
        typed(&mut km, "40", t);
        assert_eq!(km.pending().as_deref(), Some("40"));
        assert_eq!(km.key(code(KeyCode::Esc), t), vec![]);
        assert!(km.pending().is_none());
        // 0 is tab 10; Alt-digit is immediate
        assert_eq!(typed(&mut km, "0", t), vec![Action::GotoTab(10)]);
        assert_eq!(
            km.key(KeyEvent::new(KeyCode::Char('5'), KeyModifiers::ALT), t),
            vec![Action::GotoTab(5)]
        );
        // a multi-digit prefix before a non-count key is dropped
        assert_eq!(
            km.key(code(KeyCode::Char('1')), t)
                .into_iter()
                .chain(km.key(code(KeyCode::Char('2')), t))
                .chain(km.key(code(KeyCode::Tab), t))
                .collect::<Vec<_>>(),
            vec![Action::NextTab]
        );
    }

    #[test]
    fn keys_map_to_actions() {
        let t = Instant::now();
        let mut km = Keymap::new();
        for (k, a) in [
            (code(KeyCode::Tab), Action::NextTab),
            (code(KeyCode::BackTab), Action::PrevTab),
            (code(KeyCode::Down), Action::Move(1)),
            (code(KeyCode::Up), Action::Move(-1)),
            (code(KeyCode::Enter), Action::Open),
            (code(KeyCode::Esc), Action::Back),
            (key('a'), Action::Ascend),
            (key('r'), Action::Respec),
            (key('z'), Action::Undo),
            (key('?'), Action::Help),
            (key('q'), Action::Quit),
            (key('m'), Action::ToggleMouse),
            (key('A'), Action::ToggleAnim),
            (key('%'), Action::QtyPrompt),
            (
                KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL),
                Action::Quit,
            ),
        ] {
            assert_eq!(km.key(k, t), vec![a], "{k:?}");
        }
    }

    #[test]
    fn command_mode() {
        let t = Instant::now();
        let mut km = Keymap::new();
        assert_eq!(typed(&mut km, ":", t), vec![]);
        assert_eq!(km.mode, Mode::Command);
        // keys are text now, not commands
        assert_eq!(typed(&mut km, "buy drone 10q", t), vec![]);
        km.key(code(KeyCode::Backspace), t);
        assert_eq!(km.line, "buy drone 10");
        assert_eq!(km.key(code(KeyCode::Tab), t), vec![Action::Complete]);
        assert_eq!(
            km.key(code(KeyCode::Enter), t),
            vec![Action::Submit("buy drone 10".into())]
        );
        assert_eq!(km.mode, Mode::Normal);
        // history
        typed(&mut km, ":", t);
        km.key(code(KeyCode::Up), t);
        assert_eq!(km.line, "buy drone 10");
        // ctrl-w deletes a word, Esc leaves without submitting
        km.key(KeyEvent::new(KeyCode::Char('w'), KeyModifiers::CONTROL), t);
        assert_eq!(km.line, "buy drone ");
        assert_eq!(km.key(code(KeyCode::Esc), t), vec![]);
        assert_eq!(km.mode, Mode::Normal);
        // backspace on an empty line leaves too; cursor editing
        typed(&mut km, ":", t);
        km.key(code(KeyCode::Backspace), t);
        assert_eq!(km.mode, Mode::Normal);
        km.open_line("buy  5");
        km.key(code(KeyCode::Left), t);
        km.key(code(KeyCode::Left), t);
        typed(&mut km, "x", t);
        assert_eq!(km.line, "buy x 5");
    }
}
