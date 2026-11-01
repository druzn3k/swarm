//! The advisory lock on a save: `save.lock` next to `save.txt`, holding the
//! owner's pid and start time. `swarm-tui` holds it for its whole session;
//! `swarm` holds it for the duration of each command that writes the save.
//! Without it the last writer silently wins.
//!
//! Taken with `create_new` (atomic). A lock whose pid is no longer running
//! (no `/proc/<pid>`) is stale and taken over silently. Where `/proc` does
//! not exist every pid counts as alive, so a stale lock needs `--force`.
//! Advisory only: it protects against two well-behaved programs, not against
//! a takeover racing another takeover.
//!
//! This file exists twice (`crates/cli/src` and `crates/tui/src`) and the
//! copies MUST stay textually identical; see `store.rs`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::store;

/// Who holds a lock.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Holder {
    /// Process id.
    pub pid: u32,
    /// When it took the lock, epoch ms.
    pub started_ms: i64,
    /// Program name, for messages (`swarm`, `swarm-tui`).
    pub who: String,
}

impl Holder {
    fn encode(&self) -> String {
        format!(
            "pid {}\nstarted {}\nwho {}\n",
            self.pid, self.started_ms, self.who
        )
    }

    fn parse(text: &str) -> Option<Holder> {
        let (mut pid, mut started_ms, mut who) = (None, None, None);
        for line in text.lines() {
            match line.split_once(' ') {
                Some(("pid", v)) => pid = v.trim().parse().ok(),
                Some(("started", v)) => started_ms = v.trim().parse().ok(),
                Some(("who", v)) => who = Some(v.trim().to_owned()),
                _ => {}
            }
        }
        Some(Holder {
            pid: pid?,
            started_ms: started_ms?,
            who: who.unwrap_or_else(|| "another program".into()),
        })
    }
}

impl std::fmt::Display for Holder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let age = now_ms().saturating_sub(self.started_ms).max(0) / 1000;
        let age = match age {
            0..=59 => format!("{age}s"),
            60..=3599 => format!("{}m", age / 60),
            _ => format!("{}h{}m", age / 3600, age % 3600 / 60),
        };
        write!(f, "{} (pid {}, for {age})", self.who, self.pid)
    }
}

/// Why a lock could not be taken.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LockError {
    /// A running program holds it.
    Held(Holder),
    /// The lock file could not be read or written.
    Io(String),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LockError::Held(h) => write!(
                f,
                "the save is in use by {h}; close it, or pass --force to override"
            ),
            LockError::Io(e) => f.write_str(e),
        }
    }
}

impl std::error::Error for LockError {}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// Is a process with this pid running? Always true without `/proc`.
pub fn pid_alive(pid: u32) -> bool {
    if !Path::new("/proc/self").exists() {
        return true;
    }
    Path::new("/proc").join(pid.to_string()).exists()
}

/// A held lock; released (the file removed) when dropped, unless someone
/// took it over with `--force` in the meantime.
#[derive(Debug)]
pub struct Lock {
    path: PathBuf,
    me: Holder,
}

impl Lock {
    /// Takes the lock for the save at `save`, naming `who` in the file.
    /// With `force`, takes it even from a running holder.
    pub fn acquire(save: &Path, who: &str, force: bool) -> Result<Lock, LockError> {
        let path = store::lock_path(save);
        let me = Holder {
            pid: std::process::id(),
            started_ms: now_ms(),
            who: who.to_owned(),
        };
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            fs::create_dir_all(dir)
                .map_err(|e| LockError::Io(format!("{}: {e}", dir.display())))?;
        }
        for _ in 0..5 {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut f) => {
                    f.write_all(me.encode().as_bytes())
                        .and_then(|()| f.sync_all())
                        .map_err(|e| LockError::Io(format!("{}: {e}", path.display())))?;
                    return Ok(Lock { path, me });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(LockError::Io(format!("{}: {e}", path.display()))),
            }
            let text = match fs::read_to_string(&path) {
                Ok(t) => t,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(LockError::Io(format!("{}: {e}", path.display()))),
            };
            let mut holder = Holder::parse(&text);
            if holder.is_none() && !force {
                // maybe the owner is between creating and writing the file
                std::thread::sleep(std::time::Duration::from_millis(50));
                let again = fs::read_to_string(&path).unwrap_or_default();
                holder = Holder::parse(&again);
            }
            match holder {
                Some(h) if !force && pid_alive(h.pid) => return Err(LockError::Held(h)),
                _ => {
                    // stale, unreadable or forced: remove it, but only if it
                    // is still the file we looked at
                    if fs::read_to_string(&path).is_ok_and(|now| now == text) {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
        Err(LockError::Io(format!(
            "{}: could not take the lock (it keeps changing)",
            path.display()
        )))
    }

    /// Where the lock file is.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let ours = fs::read_to_string(&self.path)
            .ok()
            .and_then(|t| Holder::parse(&t))
            .is_some_and(|h| h == self.me);
        if ours {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("swarm-lock-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write_lock(save: &Path, pid: u32, who: &str) {
        let h = Holder {
            pid,
            started_ms: now_ms(),
            who: who.into(),
        };
        fs::write(store::lock_path(save), h.encode()).unwrap();
    }

    /// Above any real pid (`pid_max` is at most 2^22).
    const DEAD_PID: u32 = 4_000_000_000;

    #[test]
    fn acquire_and_release() {
        let d = dir("basic");
        let save = d.join("save.txt");
        let lock = Lock::acquire(&save, "swarm-test", false).unwrap();
        let text = fs::read_to_string(lock.path()).unwrap();
        let h = Holder::parse(&text).unwrap();
        assert_eq!((h.pid, h.who.as_str()), (std::process::id(), "swarm-test"));
        drop(lock);
        assert!(!store::lock_path(&save).exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_live_holder_refuses_a_second_taker() {
        let d = dir("refuse");
        let save = d.join("save.txt");
        let first = Lock::acquire(&save, "swarm-tui", false).unwrap();
        let err = Lock::acquire(&save, "swarm", false).unwrap_err();
        let LockError::Held(h) = &err else {
            panic!("{err:?}")
        };
        assert_eq!((h.pid, h.who.as_str()), (std::process::id(), "swarm-tui"));
        let msg = err.to_string();
        assert!(
            msg.contains(&format!("pid {}", std::process::id())),
            "{msg}"
        );
        assert!(msg.contains("--force"), "{msg}");
        // the refused attempt must not have removed the lock
        assert!(first.path().exists());
        drop(first);
        Lock::acquire(&save, "swarm", false).unwrap();
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_dead_holder_is_taken_over() {
        let d = dir("stale");
        let save = d.join("save.txt");
        write_lock(&save, DEAD_PID, "swarm-tui");
        let lock = Lock::acquire(&save, "swarm", false).unwrap();
        let h = Holder::parse(&fs::read_to_string(lock.path()).unwrap()).unwrap();
        assert_eq!(h.pid, std::process::id());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_garbled_lock_is_stale() {
        let d = dir("garbled");
        let save = d.join("save.txt");
        fs::write(store::lock_path(&save), "not a lock").unwrap();
        Lock::acquire(&save, "swarm", false).unwrap();
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_running_child_holds_the_lock() {
        let d = dir("child");
        let save = d.join("save.txt");
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        write_lock(&save, child.id(), "swarm-tui");
        assert!(matches!(
            Lock::acquire(&save, "swarm", false),
            Err(LockError::Held(h)) if h.pid == child.id()
        ));
        child.kill().unwrap();
        child.wait().unwrap();
        // once it is gone the lock is stale
        Lock::acquire(&save, "swarm", false).unwrap();
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn force_overrides_and_the_old_holder_does_not_unlock_the_new() {
        let d = dir("force");
        let save = d.join("save.txt");
        let old = Lock::acquire(&save, "swarm-tui", false).unwrap();
        // same pid in this test, so make the new lock distinguishable
        std::thread::sleep(std::time::Duration::from_millis(5));
        let new = Lock::acquire(&save, "swarm", true).unwrap();
        drop(old);
        assert!(new.path().exists(), "the old holder removed the new lock");
        drop(new);
        assert!(!store::lock_path(&save).exists());
        let _ = fs::remove_dir_all(&d);
    }
}
