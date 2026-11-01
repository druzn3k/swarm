//! Where the save lives and how it is written: atomically (temp file, fsync,
//! rename), keeping the previous save as `<stem>.prev.<ext>`. The undo
//! snapshot lives next to it as `<stem>.undo.<ext>` (see `undo_file`), and
//! the advisory lock as `<stem>.lock` (see `lock`).
//!
//! The `swarm` CLI (`crates/cli`) and `swarm-tui` (`crates/tui`) share one
//! save and must agree on all of this, but depending on `swarm-cli` would
//! pull `clap` into the TUI. So this file exists twice, and the two copies
//! MUST stay textually identical (`crates/tui/tests/shared_copies.rs`
//! checks it). Same for `lock.rs` and `undo_file.rs`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The save file: `flag` (`--save`), else `$SWARM_SAVE`, else
/// `$XDG_DATA_HOME/swarm/save.txt`, else `~/.local/share/swarm/save.txt`
/// (`%APPDATA%\swarm\save.txt` on Windows when `HOME` is unset).
/// `var` reads an environment variable (empty counts as unset).
pub fn save_path(
    flag: Option<&Path>,
    var: impl Fn(&str) -> Option<String>,
) -> Result<PathBuf, String> {
    let var = |k: &str| var(k).filter(|v| !v.is_empty());
    if let Some(p) = flag {
        return Ok(p.to_owned());
    }
    if let Some(p) = var("SWARM_SAVE") {
        return Ok(PathBuf::from(p));
    }
    let dir = if let Some(x) = var("XDG_DATA_HOME").filter(|x| Path::new(x).is_absolute()) {
        PathBuf::from(x)
    } else if let Some(home) = var("HOME") {
        Path::new(&home).join(".local").join("share")
    } else if let Some(appdata) = var("APPDATA") {
        PathBuf::from(appdata)
    } else {
        return Err(
            "cannot find a data directory: set HOME, XDG_DATA_HOME or SWARM_SAVE, or pass --save"
                .into(),
        );
    };
    Ok(dir.join("swarm").join("save.txt"))
}

/// `dir/stem.<tag>.ext` next to `path`.
pub fn sibling(path: &Path, tag: &str) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "save".into());
    let name = match path.extension() {
        Some(ext) => format!("{stem}.{tag}.{}", ext.to_string_lossy()),
        None => format!("{stem}.{tag}"),
    };
    path.with_file_name(name)
}

/// The rotating backup of the previous save.
pub fn backup_path(path: &Path) -> PathBuf {
    sibling(path, "prev")
}

/// The undo snapshot.
pub fn undo_path(path: &Path) -> PathBuf {
    sibling(path, "undo")
}

/// The advisory lock: `save.lock` next to `save.txt`.
pub fn lock_path(path: &Path) -> PathBuf {
    path.with_extension("lock")
}

fn io_err(path: &Path, e: std::io::Error) -> String {
    format!("{}: {e}", path.display())
}

/// Reads a file; `None` if it doesn't exist.
pub fn read_opt(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_err(path, e)),
    }
}

/// Writes `path` atomically: a temp file in the same directory, synced, then
/// renamed over the target. Creates the parent directory.
pub fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        fs::create_dir_all(dir).map_err(|e| io_err(dir, e))?;
    }
    let tmp = sibling(path, &format!("tmp{}", std::process::id()));
    let res = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(io_err(path, e));
    }
    Ok(())
}

/// Writes the save: the current file (if any, and if different) becomes the
/// backup, then the new text replaces it, each step atomic.
pub fn write_save(path: &Path, text: &str) -> Result<(), String> {
    if let Some(old) = read_opt(path)? {
        if old == text {
            return Ok(());
        }
        write_atomic(&backup_path(path), &old)?;
    }
    write_atomic(path, text)
}

/// Removes a file if it exists.
pub fn remove_opt(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_err(path, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |k: &str| {
            pairs
                .iter()
                .find(|(n, _)| *n == k)
                .map(|(_, v)| v.to_string())
        }
    }

    #[test]
    fn siblings() {
        let p = Path::new("/d/save.txt");
        assert_eq!(backup_path(p), Path::new("/d/save.prev.txt"));
        assert_eq!(undo_path(p), Path::new("/d/save.undo.txt"));
        assert_eq!(lock_path(p), Path::new("/d/save.lock"));
        assert_eq!(backup_path(Path::new("game")), Path::new("game.prev"));
        assert_eq!(lock_path(Path::new("game")), Path::new("game.lock"));
    }

    #[test]
    fn xdg_data_home() {
        let p = |e| save_path(None, e).unwrap();
        assert_eq!(
            p(env(&[("HOME", "/h"), ("XDG_DATA_HOME", "/x")])),
            Path::new("/x/swarm/save.txt")
        );
        // relative XDG paths are invalid per the spec and ignored
        assert_eq!(
            p(env(&[("HOME", "/h"), ("XDG_DATA_HOME", "x")])),
            Path::new("/h/.local/share/swarm/save.txt")
        );
        // so are empty ones
        assert_eq!(
            p(env(&[("HOME", "/h"), ("XDG_DATA_HOME", "")])),
            Path::new("/h/.local/share/swarm/save.txt")
        );
    }

    #[test]
    fn home_fallback() {
        let p = |e| save_path(None, e);
        assert_eq!(
            p(env(&[("HOME", "/h")])).unwrap(),
            Path::new("/h/.local/share/swarm/save.txt")
        );
        assert_eq!(
            p(env(&[("APPDATA", "/a")])).unwrap(),
            Path::new("/a/swarm/save.txt")
        );
        assert!(p(env(&[])).is_err());
    }

    #[test]
    fn swarm_save_and_the_flag_win() {
        assert_eq!(
            save_path(None, env(&[("HOME", "/h"), ("SWARM_SAVE", "/s.txt")])).unwrap(),
            Path::new("/s.txt")
        );
        assert_eq!(
            save_path(
                Some(Path::new("/f.txt")),
                env(&[("HOME", "/h"), ("SWARM_SAVE", "/s.txt")])
            )
            .unwrap(),
            Path::new("/f.txt")
        );
        // no data directory needed when the path is given
        assert!(save_path(Some(Path::new("/f.txt")), env(&[])).is_ok());
    }

    #[test]
    fn writes_atomically_with_a_backup() {
        let dir = std::env::temp_dir().join(format!("swarm-store-{}", std::process::id()));
        let p = dir.join("save.txt");
        write_save(&p, "one").unwrap();
        write_save(&p, "two").unwrap();
        write_save(&p, "two").unwrap();
        assert_eq!(read_opt(&p).unwrap().as_deref(), Some("two"));
        assert_eq!(read_opt(&backup_path(&p)).unwrap().as_deref(), Some("one"));
        remove_opt(&p).unwrap();
        remove_opt(&p).unwrap();
        assert_eq!(read_opt(&p).unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
