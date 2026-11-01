//! Where the save lives and how it is written: atomically (temp file and
//! rename), keeping the previous save as `<stem>.prev.<ext>`. The undo
//! snapshot lives next to it as `<stem>.undo.<ext>`, since the engine's undo
//! state is not part of a save.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::{CliError, Env};

/// The save file: `--save`, else `$SWARM_SAVE`, else
/// `$XDG_DATA_HOME/swarm/save.txt`, else `~/.local/share/swarm/save.txt`
/// (`%APPDATA%\swarm\save.txt` on Windows when `HOME` is unset).
pub fn save_path(flag: Option<&Path>, env: &Env) -> Result<PathBuf, CliError> {
    if let Some(p) = flag {
        return Ok(p.to_owned());
    }
    if let Some(p) = env.var("SWARM_SAVE") {
        return Ok(PathBuf::from(p));
    }
    let dir = if let Some(x) = env
        .var("XDG_DATA_HOME")
        .filter(|x| Path::new(x).is_absolute())
    {
        PathBuf::from(x)
    } else if let Some(home) = env.var("HOME") {
        Path::new(home).join(".local").join("share")
    } else if let Some(appdata) = env.var("APPDATA") {
        PathBuf::from(appdata)
    } else {
        return Err(CliError::Io(
            "cannot find a data directory: set HOME, XDG_DATA_HOME or SWARM_SAVE, or pass --save"
                .into(),
        ));
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

fn io_err(path: &Path, e: std::io::Error) -> CliError {
    CliError::Io(format!("{}: {e}", path.display()))
}

/// Reads a file; `None` if it doesn't exist.
pub fn read_opt(path: &Path) -> Result<Option<String>, CliError> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_err(path, e)),
    }
}

/// Writes `path` atomically: a temp file in the same directory, synced, then
/// renamed over the target. Creates the parent directory.
pub fn write_atomic(path: &Path, text: &str) -> Result<(), CliError> {
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

/// Writes the save: the current file (if any) becomes the backup, then the
/// new text replaces it, each step atomic.
pub fn write_save(path: &Path, text: &str) -> Result<(), CliError> {
    if let Some(old) = read_opt(path)? {
        write_atomic(&backup_path(path), &old)?;
    }
    write_atomic(path, text)
}

/// Removes a file if it exists.
pub fn remove_opt(path: &Path) -> Result<(), CliError> {
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
    fn siblings() {
        let p = Path::new("/d/save.txt");
        assert_eq!(backup_path(p), Path::new("/d/save.prev.txt"));
        assert_eq!(undo_path(p), Path::new("/d/save.undo.txt"));
        assert_eq!(backup_path(Path::new("game")), Path::new("game.prev"));
    }

    #[test]
    fn resolves_the_save_path() {
        let env = |pairs: &[(&str, &str)]| {
            Env::new(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())))
        };
        let p = |e: &Env| save_path(None, e).unwrap();
        assert_eq!(
            p(&env(&[("HOME", "/h")])),
            Path::new("/h/.local/share/swarm/save.txt")
        );
        assert_eq!(
            p(&env(&[("HOME", "/h"), ("XDG_DATA_HOME", "/x")])),
            Path::new("/x/swarm/save.txt")
        );
        // relative XDG paths are invalid per the spec and ignored
        assert_eq!(
            p(&env(&[("HOME", "/h"), ("XDG_DATA_HOME", "x")])),
            Path::new("/h/.local/share/swarm/save.txt")
        );
        assert_eq!(
            p(&env(&[("HOME", "/h"), ("SWARM_SAVE", "/s.txt")])),
            Path::new("/s.txt")
        );
        assert_eq!(
            save_path(Some(Path::new("/f.txt")), &env(&[("SWARM_SAVE", "/s.txt")])).unwrap(),
            Path::new("/f.txt")
        );
        assert!(matches!(save_path(None, &env(&[])), Err(CliError::Io(_))));
    }
}
