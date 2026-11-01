//! Save files: atomic writes (temp file in the same directory, synced, then
//! renamed) keeping the previous save as `<stem>.prev.<ext>`. Copied from
//! `swarm-cli`'s `store.rs` (not a dependency: the shell shouldn't pull in
//! the engine), with `String` errors for Tauri commands.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// `save.txt` -> `save.<tag>.txt`; `game` -> `game.<tag>`.
fn sibling(path: &Path, tag: &str) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
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

/// Writes the save: the current file (if any) becomes the backup, then the
/// new text replaces it, each step atomic. Writing the same text again leaves
/// the backup alone, so an unchanged autosave doesn't wipe the older save.
pub fn write_save(path: &Path, text: &str) -> Result<(), String> {
    match read_opt(path)? {
        Some(old) if old == text => return Ok(()),
        Some(old) => write_atomic(&backup_path(path), &old)?,
        None => {}
    }
    write_atomic(path, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_backup() {
        assert_eq!(
            backup_path(Path::new("/d/save.txt")),
            Path::new("/d/save.prev.txt")
        );
        assert_eq!(backup_path(Path::new("game")), Path::new("game.prev"));
    }

    #[test]
    fn writes_and_keeps_one_backup() {
        let dir = tempfile::tempdir().unwrap();
        let save = dir.path().join("sub/save.txt");
        assert_eq!(read_opt(&save).unwrap(), None);
        write_save(&save, "one").unwrap();
        assert_eq!(read_opt(&save).unwrap().as_deref(), Some("one"));
        assert_eq!(read_opt(&backup_path(&save)).unwrap(), None);
        write_save(&save, "two").unwrap();
        write_save(&save, "two").unwrap();
        assert_eq!(read_opt(&save).unwrap().as_deref(), Some("two"));
        assert_eq!(
            read_opt(&backup_path(&save)).unwrap().as_deref(),
            Some("one")
        );
        write_save(&save, "three").unwrap();
        assert_eq!(
            read_opt(&backup_path(&save)).unwrap().as_deref(),
            Some("two")
        );
        let names: Vec<_> = fs::read_dir(save.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names.len(), 2, "no temp files left: {names:?}");
    }
}
