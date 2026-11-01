//! Scripted `swarm` sessions, run in-process through `swarm_cli::run`
//! against a temporary save directory.

use std::path::{Path, PathBuf};

use clap::CommandFactory;
use swarm_cli::{run, Cli, Env, Output, EXIT_IO, EXIT_OK, EXIT_RULE, EXIT_USAGE};

const T0: i64 = 1_700_000_000_000;
const SESSION_SAVES: &str = include_str!("../../../../engine/test/fixtures/session-saves.json");

/// A temp dir with a save path and a fixed clock.
struct Sandbox {
    dir: PathBuf,
    env: Env,
}

impl Sandbox {
    fn new(name: &str) -> Sandbox {
        let dir = std::env::temp_dir().join(format!("swarm-cli-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut env = Env::default();
        env.set("XDG_DATA_HOME", dir.to_str().unwrap());
        env.set("SWARM_NOW_MS", T0.to_string());
        Sandbox { dir, env }
    }

    fn save(&self) -> PathBuf {
        self.dir.join("swarm").join("save.txt")
    }

    fn at(&mut self, ms: i64) {
        self.env.set("SWARM_NOW_MS", ms.to_string());
    }

    fn run(&self, args: &[&str]) -> Output {
        run(
            std::iter::once("swarm").chain(args.iter().copied()),
            &self.env,
        )
    }

    /// Runs and expects exit 0.
    fn ok(&self, args: &[&str]) -> Output {
        let o = self.run(args);
        assert_eq!(o.code, EXIT_OK, "{args:?}: {o:?}");
        o
    }

    fn code(&self, args: &[&str]) -> i32 {
        self.run(args).code
    }

    fn scrub(&self, s: &str) -> String {
        s.replace(self.dir.to_str().unwrap(), "<dir>")
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// A transcript: each command, its exit code and output.
#[derive(Default)]
struct Transcript(String);

impl Transcript {
    fn push(&mut self, sb: &Sandbox, args: &[&str], o: &Output) {
        let cmd = sb.scrub(&args.join(" "));
        self.0
            .push_str(&format!("$ swarm {cmd}  # exit {}\n", o.code));
        self.0.push_str(&sb.scrub(&o.stdout));
        if !o.stderr.is_empty() {
            self.0.push_str("[stderr]\n");
            self.0.push_str(&sb.scrub(&o.stderr));
        }
        self.0.push('\n');
    }

    fn run(&mut self, sb: &Sandbox, args: &[&str]) -> Output {
        let o = sb.run(args);
        self.push(sb, args, &o);
        o
    }
}

#[test]
fn scripted_session() {
    let mut sb = Sandbox::new("session");
    let mut t = Transcript::default();
    t.run(&sb, &["new"]);
    t.run(&sb, &["show"]);
    t.run(&sb, &["buy", "drone", "3"]);
    sb.at(T0 + 1000);
    t.run(&sb, &["advance", "1h"]);
    t.run(&sb, &["show"]);
    t.run(&sb, &["buy", "drone", "50%"]);
    t.run(&sb, &["buy", "drone", "@200"]);
    t.run(&sb, &["upgrade-all"]);
    t.run(&sb, &["show", "--long"]);
    let export = t.run(&sb, &["export"]);
    assert!(export.stdout.starts_with("SW2|"));
    let file = sb.dir.join("exported.txt");
    std::fs::write(&file, &export.stdout).unwrap();
    // a different game in between, then the import brings the old one back
    t.run(&sb, &["new", "--force"]);
    t.run(&sb, &["import", file.to_str().unwrap()]);
    t.run(&sb, &["show"]);
    t.run(&sb, &["stats"]);
    t.run(&sb, &["achievements"]);
    insta::assert_snapshot!("session", t.0);

    // export → import is lossless
    let again = sb.ok(&["export"]);
    assert_eq!(again.stdout, export.stdout);
    assert!(store_backup(&sb.save()).exists());
}

fn store_backup(save: &Path) -> PathBuf {
    swarm_cli::store::backup_path(save)
}

#[test]
fn json_show() {
    let mut sb = Sandbox::new("json");
    sb.ok(&["new"]);
    sb.at(T0 + 3_600_000);
    sb.ok(&["buy-max", "drone", "--percent", "50%"]);
    let o = sb.ok(&["show", "--json"]);
    let v: serde_json::Value = serde_json::from_str(&o.stdout).unwrap();
    assert!(v["tabs"].is_array());
    insta::assert_snapshot!("show_json", o.stdout);
    let a: serde_json::Value =
        serde_json::from_str(&sb.ok(&["achievements", "--json"]).stdout).unwrap();
    assert_eq!(a["points"], 10);
    let s: serde_json::Value = serde_json::from_str(&sb.ok(&["stats", "--json"]).stdout).unwrap();
    assert_eq!(s["by_unit"]["drone"]["clicks"], 1);
}

#[test]
fn undo_and_redo() {
    let sb = Sandbox::new("undo");
    sb.ok(&["new"]);
    assert_eq!(sb.code(&["undo"]), EXIT_RULE);
    let drones = |sb: &Sandbox| {
        let v: serde_json::Value =
            serde_json::from_str(&sb.ok(&["show", "--json"]).stdout).unwrap();
        v["tabs"][0]["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["name"] == "drone")
            .unwrap()["count"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    sb.ok(&["buy", "drone", "2"]);
    assert_eq!(drones(&sb), "2");
    assert!(sb.ok(&["undo"]).stdout.starts_with("Undone"));
    assert_eq!(drones(&sb), "0");
    assert!(sb.ok(&["undo"]).stdout.starts_with("Redone"));
    assert_eq!(drones(&sb), "2");
}

#[test]
fn amounts_go_through_parse_number() {
    let mut sb = Sandbox::new("amounts");
    sb.ok(&["new"]);
    sb.ok(&["buy", "drone", "3"]);
    // offline time: the wall clock moves a day
    sb.at(T0 + 24 * 3_600_000);
    for (amount, expect) in [
        ("100", "Bought 100 drone"),
        ("=12", "Bought 12 drone"),
        ("@1000", "Bought 885 drone"),
        ("1.5k", "Bought 1,500 drone"),
        ("10%", "Bought "),
    ] {
        let o = sb.ok(&["buy", "drone", amount]);
        assert!(o.stdout.starts_with(expect), "{amount}: {}", o.stdout);
    }
    // "1.5 billion" parses; it is clamped to what is affordable
    sb.ok(&["buy", "drone", "1.5 billion"]);
    assert_eq!(sb.code(&["buy", "drone", "lots"]), EXIT_USAGE);
}

#[test]
fn exit_codes() {
    let sb = Sandbox::new("codes");
    // no save yet
    assert_eq!(sb.code(&["show"]), EXIT_IO);
    assert_eq!(sb.code(&["undo"]), EXIT_IO);
    sb.ok(&["new"]);
    assert_eq!(sb.code(&["new"]), EXIT_USAGE);
    // game rules
    assert_eq!(sb.code(&["buy", "queen", "1"]), EXIT_RULE);
    assert_eq!(sb.code(&["upgrade", "hatchery"]), EXIT_RULE);
    assert_eq!(sb.code(&["upgrade-all"]), EXIT_RULE);
    assert_eq!(sb.code(&["ascend"]), EXIT_RULE);
    assert_eq!(sb.code(&["undo"]), EXIT_RULE);
    // usage
    assert_eq!(sb.code(&["buy", "nosuchunit", "1"]), EXIT_USAGE);
    assert_eq!(sb.code(&["upgrade", "nosuchupgrade"]), EXIT_USAGE);
    assert_eq!(sb.code(&["buy", "drone", "x1"]), EXIT_USAGE);
    assert_eq!(
        sb.code(&["buy-max", "drone", "--percent", "150%"]),
        EXIT_USAGE
    );
    assert_eq!(sb.code(&["advance", "3 fortnights"]), EXIT_USAGE);
    assert_eq!(sb.code(&["show", "--tab", "nosuchtab"]), EXIT_USAGE);
    assert_eq!(sb.code(&["frobnicate"]), EXIT_USAGE);
    assert_eq!(sb.code(&["buy", "drone"]), EXIT_USAGE);
    assert_eq!(sb.code(&["--help"]), EXIT_OK);
    assert_eq!(sb.code(&["--version"]), EXIT_OK);
    // I/O and unreadable saves
    assert_eq!(sb.code(&["import", "/nonexistent/save.txt"]), EXIT_IO);
    let junk = sb.dir.join("junk.txt");
    std::fs::write(&junk, "not a save").unwrap();
    assert_eq!(sb.code(&["import", junk.to_str().unwrap()]), EXIT_IO);
    std::fs::write(sb.save(), "garbage").unwrap();
    assert_eq!(sb.code(&["show"]), EXIT_IO);
    // a refused command leaves the save alone
    let sb = Sandbox::new("codes2");
    sb.ok(&["new"]);
    let before = std::fs::read_to_string(sb.save()).unwrap();
    assert_eq!(sb.code(&["buy", "queen", "1"]), EXIT_RULE);
    assert_eq!(std::fs::read_to_string(sb.save()).unwrap(), before);
}

#[test]
fn every_subcommand_has_help() {
    let sb = Sandbox::new("help");
    let cmd = Cli::command();
    let mut names = Vec::new();
    for sub in cmd.get_subcommands() {
        names.push(vec![sub.get_name().to_owned()]);
        for subsub in sub.get_subcommands() {
            names.push(vec![
                sub.get_name().to_owned(),
                subsub.get_name().to_owned(),
            ]);
        }
    }
    assert!(names.len() >= 19, "{names:?}");
    for n in names {
        let mut args: Vec<&str> = n.iter().map(String::as_str).collect();
        args.push("--help");
        let o = sb.ok(&args);
        assert!(o.stdout.contains("Usage: swarm"), "{args:?}: {}", o.stdout);
    }
    insta::assert_snapshot!("help", sb.ok(&["--help"]).stdout);
}

fn session_save(name: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(SESSION_SAVES).unwrap();
    v[name].as_str().unwrap().to_owned()
}

/// Every accepted v1 fixture converts to v2, loads, and plays; the counts
/// survive both directions.
#[test]
fn v1_fixtures_convert_and_play() {
    for name in ["v02", "v1", "whitespace"] {
        let mut sb = Sandbox::new(&format!("v1-{name}"));
        let v1 = sb.dir.join("v1.txt");
        let v2 = sb.dir.join("v2.txt");
        let back = sb.dir.join("back.txt");
        std::fs::write(&v1, session_save(name)).unwrap();
        let (v1s, v2s, backs) = (
            v1.to_str().unwrap(),
            v2.to_str().unwrap(),
            back.to_str().unwrap(),
        );
        sb.ok(&["convert", v1s, v2s]);
        let text = std::fs::read_to_string(&v2).unwrap();
        assert!(text.starts_with("SW2|"), "{name}");
        let expected = swarm_save::decode_any(&session_save(name)).unwrap().state;
        let converted = swarm_save::decode_any(&text).unwrap().state;
        assert_eq!(converted, expected, "{name}: v1 -> v2 changed the state");

        // back to v1 and again to v2: same state
        sb.ok(&["convert", v2s, backs, "--to", "v1"]);
        let v1_again = std::fs::read_to_string(&back).unwrap();
        assert_eq!(
            swarm_save::detect(&v1_again),
            Some(swarm_save::Format::V1),
            "{name}"
        );
        let state = swarm_save::decode_any(&v1_again).unwrap().state;
        assert_eq!(state.units, expected.units, "{name}");
        assert_eq!(state.upgrades, expected.upgrades, "{name}");

        // load and play: import at the save's own time, then buy and advance
        sb.at(expected
            .dates
            .reified
            .max(expected.dates.closed.unwrap_or(0)));
        let o = sb.ok(&["import", v2s]);
        assert!(o.stdout.contains("Imported a v2 save"), "{name}: {o:?}");
        let show: serde_json::Value =
            serde_json::from_str(&sb.ok(&["show", "--json", "--all"]).stdout).unwrap();
        let count = |show: &serde_json::Value, unit: &str| -> String {
            show["tabs"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|t| t["units"].as_array().unwrap())
                .find(|u| u["name"] == unit)
                .map(|u| u["count"].as_str().unwrap().to_owned())
                .unwrap()
        };
        let drones = count(&show, "drone");
        let expected_drones = expected
            .units
            .get("drone")
            .map_or("0".into(), |n| n.to_string());
        assert_eq!(drones, expected_drones, "{name}");
        sb.ok(&["advance", "1h"]);
        sb.ok(&["buy-max", "drone"]);
        sb.ok(&["stats"]);
        // the v1 import path directly too
        sb.ok(&["import", v1s]);
    }
}

#[test]
fn rejects_broken_fixture() {
    let sb = Sandbox::new("broken");
    let f = sb.dir.join("broken.txt");
    std::fs::write(&f, session_save("publictestBroken")).unwrap();
    let o = sb.run(&["convert", f.to_str().unwrap(), "-"]);
    assert_eq!(o.code, EXIT_IO, "{o:?}");
}

#[test]
fn import_from_stdin_and_legacy_export() {
    let mut sb = Sandbox::new("stdin");
    sb.env.stdin = Some(session_save("v1"));
    let o = sb.ok(&["import", "-"]);
    assert!(o.stdout.contains("Imported a v1 save"), "{o:?}");
    let legacy = sb.ok(&["export", "--legacy"]).stdout;
    assert_eq!(swarm_save::detect(&legacy), Some(swarm_save::Format::V1));
    let v2 = sb.ok(&["export"]).stdout;
    let a = swarm_save::decode_any(&legacy).unwrap().state;
    let b = swarm_save::decode_any(&v2).unwrap().state;
    assert_eq!(a.units, b.units);
}

#[test]
fn bench_runs() {
    let sb = Sandbox::new("bench");
    let o = sb.ok(&["bench", "--ticks", "50", "--buys", "5"]);
    assert!(
        o.stdout.contains("ms/tick") && o.stdout.contains("ms/buy"),
        "{o:?}"
    );
    // the bench never writes a save
    assert!(!sb.save().exists());
}

#[cfg(feature = "scenario")]
#[test]
fn scenario_golden() {
    let sb = Sandbox::new("scenario");
    let golden =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../engine/test/golden/early-game-1.json");
    let o = sb.ok(&["scenario", "golden", golden.to_str().unwrap()]);
    assert!(o.stdout.starts_with("0 differences"), "{}", o.stdout);
    assert_eq!(sb.code(&["scenario", "run", "/nonexistent.json"]), EXIT_IO);
}

#[test]
fn long_number_names() {
    let mut sb = Sandbox::new("long");
    sb.ok(&["new"]);
    sb.ok(&["buy", "drone", "3"]);
    sb.at(T0 + 30 * 86_400_000);
    let short = sb.ok(&["show"]).stdout;
    let long = sb.ok(&["show", "--long"]).stdout;
    assert!(short.contains("7.77M"), "{short}");
    assert!(long.contains("7.776 million"), "{long}");
}
