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
    /// Tab (or Shift-Tab, `back`) on the command line with no completion
    /// menu open: the app finds the matches for the text before the cursor
    /// and calls [`Keymap::begin_completion`].
    Complete {
        /// Shift-Tab or Ctrl-P.
        back: bool,
    },
}

/// Normal keys, or typing a command line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Keys are commands.
    Normal,
    /// Typing after `:`.
    Command,
}

/// The completion menu (vim's wildmenu) while it is open.
///
/// The completed text is `line[start..cursor]` (in chars); the text after
/// the cursor is kept as it is. Tab cycles through `items`, then back to
/// `base` (what was typed, extended to the matches' common prefix).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wild {
    /// Where the completed text starts, in chars.
    pub start: usize,
    /// The text before cycling: typed, extended to the common prefix.
    pub base: String,
    /// The full matches.
    pub items: Vec<String>,
    /// The match in the line; `None` while `base` is.
    pub sel: Option<usize>,
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
    /// The completion menu, when open.
    pub wild: Option<Wild>,
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
            wild: None,
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
        self.wild = None;
        self.prefix.clear();
        self.pending_tab = None;
    }

    /// Replaces the command line text (cursor at the end).
    pub fn set_line(&mut self, text: String) {
        self.line = text;
        self.cursor = self.line.chars().count();
    }

    /// The command line up to the cursor: what Tab completes.
    pub fn head(&self) -> &str {
        &self.line[..self.byte_at(self.cursor)]
    }

    /// Replaces the chars from `start` to the cursor with `text` and puts
    /// the cursor after it.
    fn replace_to_cursor(&mut self, start: usize, text: &str) {
        let start = start.min(self.cursor);
        let (a, b) = (self.byte_at(start), self.byte_at(self.cursor));
        self.line.replace_range(a..b, text);
        self.cursor = start + text.chars().count();
    }

    /// Inserts a whole match: the text, then a space unless one follows.
    fn insert_match(&mut self, start: usize, text: &str) {
        self.replace_to_cursor(start, text);
        let next = self.line[self.byte_at(self.cursor)..].chars().next();
        if next.is_none_or(|c| !c.is_whitespace()) {
            let at = self.byte_at(self.cursor);
            self.line.insert(at, ' ');
        }
        self.cursor += 1;
        self.wild = None;
    }

    /// The first Tab: with one match, inserts it and a space; with several,
    /// extends the text from `start` (chars) to the cursor to their common
    /// prefix (when `prefix`: they all start with it) and opens the menu.
    /// Does nothing without matches.
    pub fn begin_completion(&mut self, start: usize, items: Vec<String>, prefix: bool) {
        self.hist_pos = None;
        match items.len() {
            0 => self.wild = None,
            1 => self.insert_match(start, &items[0]),
            _ => {
                let typed: String = self.head().chars().skip(start).collect();
                let lcp = crate::cmdline::common_prefix(&items);
                let base = if prefix && lcp.chars().count() > typed.chars().count() {
                    lcp
                } else {
                    typed
                };
                self.replace_to_cursor(start, &base);
                self.wild = Some(Wild {
                    start,
                    base,
                    items,
                    sel: None,
                });
            }
        }
    }

    /// Moves through the open menu: the next (or previous) match, then the
    /// base text, then around again.
    pub fn cycle_completion(&mut self, by: i64) {
        let Some(w) = self.wild.as_mut() else {
            return;
        };
        let n = w.items.len() as i64;
        let at = w.sel.map_or(n, |i| i as i64);
        let next = (at + by).rem_euclid(n + 1);
        w.sel = (next < n).then_some(next as usize);
        let text = w.sel.map_or_else(|| w.base.clone(), |i| w.items[i].clone());
        let start = w.start;
        self.replace_to_cursor(start, &text);
    }

    /// Inserts match `i` of the open menu (a click) and closes it.
    pub fn pick_completion(&mut self, i: usize) {
        if let Some(w) = self.wild.clone() {
            if let Some(text) = w.items.get(i) {
                self.insert_match(w.start, text);
            }
        }
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
        self.wild = None;
    }

    fn command(&mut self, k: KeyEvent) -> Option<Action> {
        let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
        if let Some(w) = &self.wild {
            match k.code {
                KeyCode::Tab | KeyCode::Down => {
                    self.cycle_completion(1);
                    return None;
                }
                KeyCode::Char('n') if ctrl => {
                    self.cycle_completion(1);
                    return None;
                }
                KeyCode::BackTab | KeyCode::Up => {
                    self.cycle_completion(-1);
                    return None;
                }
                KeyCode::Char('p') if ctrl => {
                    self.cycle_completion(-1);
                    return None;
                }
                KeyCode::Esc => {
                    // back to what was there before cycling; Esc again leaves
                    let (start, base) = (w.start, w.base.clone());
                    self.replace_to_cursor(start, &base);
                    self.wild = None;
                    return None;
                }
                // anything else accepts the text in the line and goes on
                _ => self.wild = None,
            }
        }
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
            KeyCode::Tab => return Some(Action::Complete { back: false }),
            KeyCode::BackTab => return Some(Action::Complete { back: true }),
            KeyCode::Char('n') if ctrl => return Some(Action::Complete { back: false }),
            KeyCode::Char('p') if ctrl => return Some(Action::Complete { back: true }),
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
    fn ctrl(c: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(c), KeyModifiers::CONTROL)
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
        assert_eq!(
            km.key(code(KeyCode::Tab), t),
            vec![Action::Complete { back: false }]
        );
        assert_eq!(
            km.key(code(KeyCode::BackTab), t),
            vec![Action::Complete { back: true }]
        );
        assert_eq!(km.key(ctrl('n'), t), vec![Action::Complete { back: false }]);
        assert_eq!(km.key(ctrl('p'), t), vec![Action::Complete { back: true }]);
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

    fn items(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    /// A command line with `text`, the cursor after `at` chars.
    fn line(text: &str, at: usize) -> Keymap {
        let mut km = Keymap::new();
        km.open_line(text);
        km.cursor = at;
        km
    }

    fn state(km: &Keymap) -> (&str, usize, Option<Option<usize>>) {
        (km.line.as_str(), km.cursor, km.wild.as_ref().map(|w| w.sel))
    }

    #[test]
    fn completion_extends_to_the_common_prefix_and_cycles() {
        let t = Instant::now();
        let mut km = line("buy hi", 6);
        let hives = items(&["hive", "hive queen", "hive empress"]);
        km.begin_completion(4, hives.clone(), true);
        // "hi" extends to "hive"; the menu opens with nothing selected
        assert_eq!(state(&km), ("buy hive", 8, Some(None)));
        assert_eq!(km.wild.as_ref().unwrap().items, hives);
        km.key(code(KeyCode::Tab), t);
        assert_eq!(state(&km), ("buy hive", 8, Some(Some(0))));
        km.key(code(KeyCode::Tab), t);
        assert_eq!(state(&km), ("buy hive queen", 14, Some(Some(1))));
        km.key(ctrl('n'), t);
        assert_eq!(state(&km), ("buy hive empress", 16, Some(Some(2))));
        // past the last: back to the text before cycling, then around
        km.key(code(KeyCode::Tab), t);
        assert_eq!(state(&km), ("buy hive", 8, Some(None)));
        km.key(code(KeyCode::Tab), t);
        assert_eq!(state(&km), ("buy hive", 8, Some(Some(0))));
        // backwards
        km.key(code(KeyCode::BackTab), t);
        assert_eq!(state(&km), ("buy hive", 8, Some(None)));
        km.key(ctrl('p'), t);
        assert_eq!(state(&km), ("buy hive empress", 16, Some(Some(2))));
        km.key(code(KeyCode::Up), t);
        assert_eq!(state(&km), ("buy hive queen", 14, Some(Some(1))));
        km.key(code(KeyCode::Down), t);
        assert_eq!(state(&km), ("buy hive empress", 16, Some(Some(2))));
    }

    #[test]
    fn completion_returns_to_the_typed_text() {
        let t = Instant::now();
        // no longer common prefix: the typed text is the base
        let mut km = line("buy qu", 6);
        km.begin_completion(4, items(&["queen", "Quux"]), true);
        assert_eq!(state(&km), ("buy qu", 6, Some(None)));
        km.key(code(KeyCode::Tab), t);
        km.key(code(KeyCode::Tab), t);
        assert_eq!(state(&km), ("buy Quux", 8, Some(Some(1))));
        km.key(code(KeyCode::Tab), t);
        assert_eq!(state(&km), ("buy qu", 6, Some(None)));
    }

    #[test]
    fn a_single_match_is_inserted_with_a_space() {
        let mut km = line("buy greater q", 13);
        km.begin_completion(4, items(&["greater queen"]), true);
        assert_eq!(state(&km), ("buy greater queen ", 18, None));
        // no matches: nothing happens
        let mut km = line("buy zz", 6);
        km.begin_completion(4, Vec::new(), true);
        assert_eq!(state(&km), ("buy zz", 6, None));
    }

    #[test]
    fn completion_keeps_the_text_after_the_cursor() {
        let t = Instant::now();
        // cursor right after "cul" in "buy cul 10"
        let mut km = line("buy cul 10", 7);
        km.begin_completion(4, items(&["culicimorph"]), true);
        assert_eq!(state(&km), ("buy culicimorph 10", 16, None));
        // with a menu: cycling replaces only the argument before the cursor
        let mut km = line("buy giant 10", 9);
        km.begin_completion(4, items(&["giant arachnomorph", "giantess"]), true);
        assert_eq!(state(&km), ("buy giant 10", 9, Some(None)));
        km.key(code(KeyCode::Tab), t);
        assert_eq!(state(&km), ("buy giant arachnomorph 10", 22, Some(Some(0))));
        km.key(code(KeyCode::Tab), t);
        assert_eq!(state(&km), ("buy giantess 10", 12, Some(Some(1))));
        // a click inserts a match; a space already follows: the cursor skips it
        km.pick_completion(0);
        assert_eq!(state(&km), ("buy giant arachnomorph 10", 23, None));
    }

    #[test]
    fn substring_matches_do_not_extend() {
        let mut km = line("buy morph", 9);
        km.begin_completion(4, items(&["arachnomorph", "arachnomorphs"]), false);
        assert_eq!(state(&km), ("buy morph", 9, Some(None)));
    }

    #[test]
    fn other_keys_accept_and_close_the_menu() {
        let t = Instant::now();
        let mut km = line("buy hi", 6);
        km.begin_completion(4, items(&["hive", "hive queen"]), true);
        km.key(code(KeyCode::Tab), t);
        km.key(code(KeyCode::Tab), t);
        assert_eq!(km.line, "buy hive queen");
        typed(&mut km, " 5", t);
        assert_eq!(state(&km), ("buy hive queen 5", 16, None));
        // Up/Down are history again once the menu is closed
        assert_eq!(
            km.key(code(KeyCode::Enter), t),
            vec![Action::Submit("buy hive queen 5".into())]
        );
        typed(&mut km, ":", t);
        km.key(code(KeyCode::Up), t);
        assert_eq!(km.line, "buy hive queen 5");
        // Enter accepts and runs
        let mut km = line("buy hi", 6);
        km.begin_completion(4, items(&["hive", "hive queen"]), true);
        km.key(code(KeyCode::Tab), t);
        km.key(code(KeyCode::Tab), t);
        assert_eq!(
            km.key(code(KeyCode::Enter), t),
            vec![Action::Submit("buy hive queen".into())]
        );
        assert!(km.wild.is_none());
        // Backspace edits the accepted text
        let mut km = line("buy hi", 6);
        km.begin_completion(4, items(&["hive", "hive queen"]), true);
        km.key(code(KeyCode::Tab), t);
        km.key(code(KeyCode::Tab), t);
        km.key(code(KeyCode::Backspace), t);
        assert_eq!(state(&km), ("buy hive quee", 13, None));
    }

    #[test]
    fn esc_closes_the_menu_then_leaves() {
        let t = Instant::now();
        let mut km = line("buy hi", 6);
        km.begin_completion(4, items(&["hive", "hive queen"]), true);
        km.key(code(KeyCode::Tab), t);
        km.key(code(KeyCode::Tab), t);
        assert_eq!(km.line, "buy hive queen");
        assert_eq!(km.key(code(KeyCode::Esc), t), vec![]);
        assert_eq!(state(&km), ("buy hive", 8, None));
        assert_eq!(km.mode, Mode::Command);
        km.key(code(KeyCode::Esc), t);
        assert_eq!(km.mode, Mode::Normal);
    }
}
