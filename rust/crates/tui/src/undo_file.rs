//! The undo snapshot file (`save.undo.txt`), shared by `swarm` and
//! `swarm-tui` so that an undo spans a hand-off between them.
//!
//! Format: a header line `undo <date_ms>` or `redo <date_ms>`, then the
//! state to restore as a v2 save. `date_ms` is the game clock when the
//! command ran. Files from before the date was added (`undo` alone) count as
//! expired.
//!
//! The rule both programs follow:
//! - after a successful mutating command, the pre-command state is written
//!   (kind `undo`); undoing writes the state it replaced (kind `redo`).
//!   `swarm` writes after every command; `swarm-tui` writes after every
//!   command it runs and again when it saves, and only while the window is
//!   open.
//! - both read it when they start, so `swarm buy` then `z` in the TUI (or the
//!   other way round) undoes the purchase.
//! - an `undo` snapshot older than [`WINDOW_MS`] is expired and deleted at the
//!   next opportunity; `redo` snapshots stay until the next command replaces
//!   them (like the engine, which never times out a redo).
//!
//! This file exists twice (`crates/cli/src` and `crates/tui/src`) and the
//! copies MUST stay textually identical; see `store.rs`.

/// How long after a command it can be undone (the engine's
/// `UNDO_LIMIT_SECS`, 30 s).
pub const WINDOW_MS: i64 = 30_000;

/// What restoring the snapshot does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Reverts the last command.
    Undo,
    /// Reverts an undo.
    Redo,
}

/// A parsed undo file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    /// Undo or redo.
    pub kind: Kind,
    /// Game clock (epoch ms) when the command ran.
    pub date_ms: i64,
    /// The state to restore, as a v2 save.
    pub save: String,
}

impl Snapshot {
    /// The file text.
    pub fn encode(&self) -> String {
        let tag = match self.kind {
            Kind::Undo => "undo",
            Kind::Redo => "redo",
        };
        format!("{tag} {}\n{}\n", self.date_ms, self.save)
    }

    /// Parses file text; `None` if it is not an undo file.
    pub fn parse(text: &str) -> Option<Snapshot> {
        let (head, body) = text.split_once('\n')?;
        let mut words = head.split_whitespace();
        let kind = match words.next()? {
            "undo" => Kind::Undo,
            "redo" => Kind::Redo,
            _ => return None,
        };
        // no date (older files): as old as can be, so an undo is expired
        let date_ms = match words.next() {
            Some(d) => d.parse().ok()?,
            None => 0,
        };
        Some(Snapshot {
            kind,
            date_ms,
            save: body.trim().to_owned(),
        })
    }

    /// The undo window has closed at game time `now_ms`. Redo never expires.
    pub fn expired(&self, now_ms: i64) -> bool {
        self.kind == Kind::Undo && now_ms.saturating_sub(self.date_ms) >= WINDOW_MS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for kind in [Kind::Undo, Kind::Redo] {
            let s = Snapshot {
                kind,
                date_ms: 1_700_000_000_123,
                save: "v2:abc".into(),
            };
            assert_eq!(Snapshot::parse(&s.encode()), Some(s));
        }
    }

    #[test]
    fn rejects_garbage_and_expires_old_files() {
        assert_eq!(Snapshot::parse(""), None);
        assert_eq!(Snapshot::parse("nope 1\nbody"), None);
        assert_eq!(Snapshot::parse("undo x\nbody"), None);
        let old = Snapshot::parse("undo\nbody\n").unwrap();
        assert_eq!(old.save, "body");
        assert!(old.expired(1_000_000));
        assert!(!Snapshot::parse("redo\nbody").unwrap().expired(i64::MAX));
    }

    #[test]
    fn the_window_is_thirty_seconds() {
        let s = Snapshot {
            kind: Kind::Undo,
            date_ms: 1000,
            save: String::new(),
        };
        assert!(!s.expired(1000));
        assert!(!s.expired(500)); // clock skew
        assert!(!s.expired(1000 + WINDOW_MS - 1));
        assert!(s.expired(1000 + WINDOW_MS));
    }
}
