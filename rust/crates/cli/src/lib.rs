//! `swarm`: Swarm Simulator on the command line (`rust/PLAN.md` M3).
//!
//! Every command loads the save, runs, and (if it changed the game) writes
//! it back as a v2 save. There is no live loop: the game clock is the wall
//! clock at each invocation, so time passes between commands like it does
//! while the browser game is closed. `swarm advance 3h` moves the game clock
//! ahead of the wall clock; later commands then resume from that point
//! until the wall clock catches up.
//!
//! The binary is a thin wrapper over [`run`], which takes the arguments and
//! an [`Env`] (environment variables, stdin, and an optional fixed clock)
//! and returns an [`Output`], so tests run sessions in-process.
//!
//! Exit codes: 0 ok, 1 a game rule refused the action (can't afford, nothing
//! to undo, ...), 2 usage or parse error, 3 I/O or unreadable save.
#![forbid(unsafe_code)]

pub mod duration;
mod game;
mod render;
pub mod store;

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

/// Exit status: success.
pub const EXIT_OK: i32 = 0;
/// Exit status: a game rule refused the action.
pub const EXIT_RULE: i32 = 1;
/// Exit status: usage or parse error.
pub const EXIT_USAGE: i32 = 2;
/// Exit status: I/O error or unreadable save.
pub const EXIT_IO: i32 = 3;

/// Why a command failed, by exit code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CliError {
    /// A game rule refused the action ([`EXIT_RULE`]).
    Rule(String),
    /// Bad arguments ([`EXIT_USAGE`]).
    Usage(String),
    /// Files and saves ([`EXIT_IO`]).
    Io(String),
}

impl CliError {
    /// The process exit code.
    pub fn code(&self) -> i32 {
        match self {
            CliError::Rule(_) => EXIT_RULE,
            CliError::Usage(_) => EXIT_USAGE,
            CliError::Io(_) => EXIT_IO,
        }
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::Rule(m) | CliError::Usage(m) | CliError::Io(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for CliError {}

/// What a command printed, and its exit code.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Output {
    /// The exit code.
    pub code: i32,
    /// Standard output.
    pub stdout: String,
    /// Standard error.
    pub stderr: String,
}

/// The process environment, injectable for tests.
#[derive(Clone, Debug, Default)]
pub struct Env {
    vars: HashMap<String, String>,
    /// Standard input, for `import -` and `convert - ...`. `None` reads the
    /// real stdin.
    pub stdin: Option<String>,
}

impl Env {
    /// An environment with these variables.
    pub fn new(vars: impl IntoIterator<Item = (String, String)>) -> Env {
        Env {
            vars: vars.into_iter().collect(),
            stdin: None,
        }
    }

    /// The real process environment.
    pub fn from_process() -> Env {
        Env::new(std::env::vars())
    }

    /// A variable, if set and not empty.
    pub fn var(&self, key: &str) -> Option<&str> {
        self.vars
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    }

    /// Sets a variable.
    pub fn set(&mut self, key: &str, value: impl Into<String>) {
        self.vars.insert(key.to_owned(), value.into());
    }

    /// The wall clock, epoch ms: `$SWARM_NOW_MS` if set (for reproducible
    /// sessions and tests), else the system clock.
    pub fn now_ms(&self) -> Result<i64, CliError> {
        if let Some(v) = self.var("SWARM_NOW_MS") {
            return v
                .parse()
                .map_err(|_| CliError::Usage(format!("SWARM_NOW_MS: not an integer: {v}")));
        }
        let d = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| CliError::Io("the system clock is before 1970".into()))?;
        Ok(i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
    }
}

/// Swarm Simulator, on the command line.
///
/// The save lives in $XDG_DATA_HOME/swarm/save.txt (default
/// ~/.local/share/swarm/save.txt); override it with --save or $SWARM_SAVE.
/// Each command that changes the game rewrites the save (v2) and keeps the
/// previous one as save.prev.txt.
///
/// Exit codes: 0 ok, 1 refused by a game rule, 2 usage error, 3 I/O error.
#[derive(Debug, Parser)]
#[command(name = "swarm", version, about, long_about, max_term_width = 100)]
pub struct Cli {
    /// The save file.
    #[arg(long, global = true, value_name = "PATH")]
    pub save: Option<PathBuf>,
    /// Long number names ("1.23456 million") instead of short ("1.23M").
    #[arg(long, global = true)]
    pub long: bool,
    /// What to do.
    #[command(subcommand)]
    pub command: Cmd,
}

/// The subcommands.
#[derive(Debug, Subcommand)]
pub enum Cmd {
    /// Start a new game.
    New {
        /// Replace an existing save (it is kept as the backup).
        #[arg(long)]
        force: bool,
    },
    /// Show units, upgrades and tabs.
    Show(ShowArgs),
    /// Buy units.
    ///
    /// AMOUNT is game input: 100, 1.5k, 1.5 billion, 50% (of what you can
    /// afford), =12 (exactly 12 units, counting twins), @1e6 (enough to
    /// have 1e6). Buys at most what you can afford.
    Buy {
        /// Unit name (see `swarm show`).
        unit: String,
        /// How many.
        #[arg(allow_hyphen_values = true)]
        amount: String,
    },
    /// Buy as many units as you can afford.
    BuyMax {
        /// Unit name.
        unit: String,
        /// Spend only this share of the resources: 25% or 0.25.
        #[arg(long, value_name = "PERCENT", default_value = "100%")]
        percent: String,
    },
    /// Buy upgrade or ability levels.
    Upgrade {
        /// Upgrade name.
        name: String,
        /// How many levels: a number like 3 or 1.5k.
        #[arg(default_value = "1")]
        amount: String,
    },
    /// Buy as many levels of an upgrade as you can afford.
    UpgradeMax {
        /// Upgrade name.
        name: String,
        /// Spend only this share of the resources: 25% or 0.25.
        #[arg(long, value_name = "PERCENT", default_value = "100%")]
        percent: String,
    },
    /// Buy every affordable, watched upgrade (the game's "buy all upgrades").
    UpgradeAll {
        /// Spend only this share of the resources: 25% or 0.25.
        #[arg(long, value_name = "PERCENT", default_value = "100%")]
        percent: String,
    },
    /// Ascend: trade energy for mutagen and start over.
    Ascend,
    /// Respec mutations: uses a free respec if you have one, else energy.
    Respec {
        /// Pay energy even if a free respec is available.
        #[arg(long)]
        pay: bool,
    },
    /// Undo the last command; run again to redo.
    Undo,
    /// Let game time pass: 90s, 3h, 2d, 1h30m.
    ///
    /// The game clock moves ahead of the wall clock; later commands resume
    /// from there (no offline time accrues until the wall clock catches up).
    Advance {
        /// How long.
        duration: String,
    },
    /// Print the save.
    Export {
        /// Write the legacy (v1) format the TypeScript/Coffee game reads.
        #[arg(long)]
        legacy: bool,
    },
    /// Replace the game with a save from a file (v1 or v2; `-` is stdin).
    Import {
        /// The file.
        file: String,
    },
    /// Convert a save file between formats without touching your game.
    Convert {
        /// Input file (v1 or v2; `-` is stdin).
        input: String,
        /// Output file (`-` is stdout).
        output: String,
        /// Output format.
        #[arg(long, value_enum, default_value = "v2")]
        to: SaveFormat,
    },
    /// Run and compare parity scenarios (swarm-scenario).
    #[cfg(feature = "scenario")]
    Scenario {
        /// What to run.
        #[command(subcommand)]
        cmd: ScenarioCmd,
    },
    /// Time engine operations.
    Bench {
        /// Ticks (100 ms each, plus the per-tick unit queries) to time.
        #[arg(long, default_value_t = 10_000)]
        ticks: u32,
        /// Rounds of "advance 1 min, buy-max every buyable unit" to time.
        #[arg(long, default_value_t = 200)]
        buys: u32,
        /// Start from the save instead of a new game (the save isn't changed).
        #[arg(long)]
        from_save: bool,
    },
    /// Show statistics: time played, purchases.
    Stats {
        /// Machine-readable output.
        #[arg(long)]
        json: bool,
    },
    /// Show achievements.
    Achievements {
        /// Include masked (not yet revealed) achievements.
        #[arg(long)]
        all: bool,
        /// Machine-readable output.
        #[arg(long)]
        json: bool,
    },
}

/// `swarm show` options.
#[derive(Debug, Args)]
pub struct ShowArgs {
    /// Machine-readable output.
    #[arg(long)]
    pub json: bool,
    /// Include hidden units and upgrades.
    #[arg(long)]
    pub all: bool,
    /// Only this tab (meat, larva, energy, mutagen, ...).
    #[arg(long)]
    pub tab: Option<String>,
}

/// A save format for `convert`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum SaveFormat {
    /// The TypeScript/Coffee format.
    V1,
    /// The Rust port's format.
    V2,
}

/// `swarm scenario` subcommands.
#[cfg(feature = "scenario")]
#[derive(Debug, Subcommand)]
pub enum ScenarioCmd {
    /// Run a scenario and print its result (goldenJson).
    Run {
        /// Scenario JSON.
        scenario: PathBuf,
    },
    /// Run a scenario and compare with the TS engine's result; exit 1 on
    /// differences.
    Compare {
        /// Scenario JSON.
        scenario: PathBuf,
        /// Expected result JSON.
        expected: PathBuf,
        /// Differences to list.
        #[arg(long, default_value_t = 40)]
        max: usize,
        /// Resync from the TS state at each full snapshot.
        #[arg(long)]
        lockstep: bool,
    },
    /// Replay a golden file and compare; exit 1 on differences.
    Golden {
        /// Golden JSON.
        golden: PathBuf,
        /// Differences to list.
        #[arg(long, default_value_t = 40)]
        max: usize,
    },
}

/// Runs `swarm` with these arguments (the first is the program name).
pub fn run<I, T>(args: I, env: &Env) -> Output
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(e) => {
            let text = e.render().to_string();
            return if e.use_stderr() {
                Output {
                    code: EXIT_USAGE,
                    stdout: String::new(),
                    stderr: text,
                }
            } else {
                Output {
                    code: EXIT_OK,
                    stdout: text,
                    stderr: String::new(),
                }
            };
        }
    };
    let mut out = Output::default();
    match game::dispatch(&cli, env, &mut out) {
        Ok(code) => out.code = code,
        Err(e) => {
            out.code = e.code();
            out.stderr.push_str(&format!("error: {e}\n"));
        }
    }
    out
}
