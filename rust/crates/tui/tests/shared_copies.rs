//! `swarm` and `swarm-tui` share one save, and these files exist in both
//! crates (depending on `swarm-cli` would pull `clap` into the TUI). They
//! must stay identical.

use std::path::Path;

#[test]
fn shared_files_are_identical() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    for f in ["store.rs", "lock.rs", "undo_file.rs"] {
        let tui = std::fs::read_to_string(root.join("tui/src").join(f)).unwrap();
        let cli = std::fs::read_to_string(root.join("cli/src").join(f)).unwrap();
        assert!(
            tui == cli,
            "crates/tui/src/{f} and crates/cli/src/{f} differ; keep them identical"
        );
    }
}
