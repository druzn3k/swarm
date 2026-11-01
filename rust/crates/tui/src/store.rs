//! Where the save lives and how it is written. The conventions are the
//! `swarm` CLI's (`crates/cli/src/store.rs`), so both binaries share one
//! save: `$SWARM_SAVE`, else `$XDG_DATA_HOME/swarm/save.txt`, else
//! `~/.local/share/swarm/save.txt`; written atomically (temp file, fsync,
//! rename) with the previous save kept as `save.prev.txt`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The save file: `flag`, else `$SWARM_SAVE`, else the XDG data dir.
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

/// The CLI's undo snapshot, which a TUI session makes stale.
pub fn undo_path(path: &Path) -> PathBuf {
    sibling(path, "undo")
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

/// Writes `path` atomically, creating the parent directory.
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

/// Writes the save, keeping the current file as `<stem>.prev.<ext>`.
pub fn write_save(path: &Path, text: &str) -> Result<(), String> {
    if let Some(old) = read_opt(path)? {
        if old == text {
            return Ok(());
        }
        write_atomic(&sibling(path, "prev"), &old)?;
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

    #[test]
    fn same_paths_as_the_cli() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |k: &str| {
                pairs
                    .iter()
                    .find(|(n, _)| *n == k)
                    .map(|(_, v)| v.to_string())
            }
        };
        let p = |e| save_path(None, e).unwrap();
        assert_eq!(
            p(env(&[("HOME", "/h")])),
            Path::new("/h/.local/share/swarm/save.txt")
        );
        assert_eq!(
            p(env(&[("HOME", "/h"), ("XDG_DATA_HOME", "/x")])),
            Path::new("/x/swarm/save.txt")
        );
        assert_eq!(
            p(env(&[("HOME", "/h"), ("XDG_DATA_HOME", "x")])),
            Path::new("/h/.local/share/swarm/save.txt")
        );
        assert_eq!(
            p(env(&[("HOME", "/h"), ("SWARM_SAVE", "/s.txt")])),
            Path::new("/s.txt")
        );
        assert!(save_path(None, env(&[])).is_err());
        assert_eq!(
            undo_path(Path::new("/d/save.txt")),
            Path::new("/d/save.undo.txt")
        );
    }

    #[test]
    fn writes_atomically_with_a_backup() {
        let dir = std::env::temp_dir().join(format!("swarm-tui-store-{}", std::process::id()));
        let p = dir.join("save.txt");
        write_save(&p, "one").unwrap();
        write_save(&p, "two").unwrap();
        assert_eq!(read_opt(&p).unwrap().as_deref(), Some("two"));
        assert_eq!(
            read_opt(&sibling(&p, "prev")).unwrap().as_deref(),
            Some("one")
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
