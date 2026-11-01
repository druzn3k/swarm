//! Command dispatch: load the save, run, write it back.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use swarm_data::{json_num, GameData};
use swarm_engine::{Amount, Command, CommandError, CommandOutcome, Engine, UpgradeSet};
use swarm_num::Num;
use swarm_save::{decode_any, encode_v2, export_v2, legacy, prepare_save, Format};

use crate::duration::{format_duration, parse_duration};
use crate::lock::{Lock, LockError};
use crate::render::{self, Fmt};
use crate::undo_file::{Kind, Snapshot};
use crate::{store, Cli, CliError, Cmd, Env, Output, SaveFormat, EXIT_OK};

/// A loaded game and where it came from.
struct Session {
    path: PathBuf,
    engine: Engine,
}

impl Session {
    /// Loads the save at `path` at the wall clock. A save whose game clock
    /// is ahead of the wall clock (after `advance`) resumes at its own time.
    fn open(path: PathBuf, env: &Env, out: &mut Output) -> Result<Session, CliError> {
        let text = store::read_opt(&path)?.ok_or_else(|| {
            CliError::Io(format!(
                "no save at {}; start a game with `swarm new`",
                path.display()
            ))
        })?;
        let engine = load_text(&text, &path.display().to_string(), env, out)?;
        Ok(Session { path, engine })
    }

    /// The game clock, which is never behind the save's.
    fn clock(&self) -> i64 {
        self.engine.now_ms()
    }

    /// Marks the game closed and writes it as a v2 save.
    fn commit(&mut self) -> Result<(), CliError> {
        let now = self.clock();
        self.engine.mark_closed(now);
        store::write_save(&self.path, &export_v2(&self.engine, now))?;
        // an undo whose window has closed (an `advance`, say) is dropped
        read_undo(&self.path, now)?;
        Ok(())
    }

    /// Applies a command; on success writes the undo snapshot (the save as
    /// loaded) and the save. A refused command changes nothing on disk.
    fn apply(&mut self, cmd: Command) -> Result<CommandOutcome, CliError> {
        let before = self.engine.exported_state().clone();
        let outcome = self.engine.apply(cmd).map_err(command_error)?;
        write_undo(&self.path, Kind::Undo, self.clock(), &encode_v2(&before))?;
        self.commit()?;
        Ok(outcome)
    }
}

/// Decodes and loads a save of either format.
fn load_text(text: &str, what: &str, env: &Env, out: &mut Output) -> Result<Engine, CliError> {
    let decoded = decode_any(text).map_err(|e| CliError::Io(format!("{what}: {e}")))?;
    let now = env.now_ms()?.max(decoded.state.dates.reified);
    let loaded = Engine::load(GameData::embedded(), decoded.state, now, None)
        .map_err(|e| CliError::Io(format!("{what}: {e}")))?;
    for w in decoded.warnings.iter().chain(&loaded.warnings) {
        out.stderr.push_str(&format!("warning: {w}\n"));
    }
    Ok(loaded.engine)
}

/// Writes the undo snapshot (`date_ms`: the game clock of the command).
fn write_undo(save: &Path, kind: Kind, date_ms: i64, text: &str) -> Result<(), CliError> {
    let snap = Snapshot {
        kind,
        date_ms,
        save: text.to_owned(),
    };
    Ok(store::write_atomic(
        &store::undo_path(save),
        &snap.encode(),
    )?)
}

/// Reads the undo snapshot, which `swarm-tui` may have written. An undo
/// whose window has closed at game time `now_ms` is deleted and not
/// returned.
fn read_undo(save: &Path, now_ms: i64) -> Result<Option<Snapshot>, CliError> {
    let file = store::undo_path(save);
    let Some(text) = store::read_opt(&file)? else {
        return Ok(None);
    };
    match Snapshot::parse(&text) {
        Some(snap) if !snap.expired(now_ms) => Ok(Some(snap)),
        _ => {
            store::remove_opt(&file)?;
            Ok(None)
        }
    }
}

/// Which commands write the save, and so take its lock. Read-only commands
/// (and `convert`, `scenario`, `bench`) see an atomically written file and
/// need none.
fn writes_save(cmd: &Cmd) -> bool {
    matches!(
        cmd,
        Cmd::New
            | Cmd::Buy { .. }
            | Cmd::BuyMax { .. }
            | Cmd::Upgrade { .. }
            | Cmd::UpgradeMax { .. }
            | Cmd::UpgradeAll { .. }
            | Cmd::Ascend
            | Cmd::Respec { .. }
            | Cmd::Undo
            | Cmd::Advance { .. }
            | Cmd::Import { .. }
    )
}

fn lock_error(e: LockError) -> CliError {
    CliError::Io(e.to_string())
}

/// Game rules are exit 1; names and numbers the player typed are usage
/// errors.
fn command_error(e: CommandError) -> CliError {
    match e {
        CommandError::UnknownUnit(n) => {
            CliError::Usage(format!("no such unit: {n} (see `swarm show --all`)"))
        }
        CommandError::UnknownUpgrade(n) => {
            CliError::Usage(format!("no such upgrade: {n} (see `swarm show --all`)"))
        }
        CommandError::BadNumber(_) => CliError::Usage(e.to_string()),
        _ => CliError::Rule(e.to_string()),
    }
}

/// `25%`, `0.25`, `100%` -> 0..=1.
pub fn parse_percent(text: &str) -> Result<f64, CliError> {
    let t = text.trim();
    let v = match t.strip_suffix('%') {
        Some(p) => p.trim().parse::<f64>().map(|x| x / 100.0),
        None => t.parse::<f64>(),
    };
    match v {
        Ok(x) if (0.0..=1.0).contains(&x) => Ok(x),
        _ => Err(CliError::Usage(format!(
            "bad percent {text:?}: use 0%..100% or 0..1"
        ))),
    }
}

fn read_input(path: &str, env: &Env) -> Result<String, CliError> {
    if path == "-" {
        if let Some(s) = &env.stdin {
            return Ok(s.clone());
        }
        let mut s = String::new();
        std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)
            .map_err(|e| CliError::Io(format!("stdin: {e}")))?;
        return Ok(s);
    }
    std::fs::read_to_string(path).map_err(|e| CliError::Io(format!("{path}: {e}")))
}

fn line(out: &mut Output, s: impl AsRef<str>) {
    out.stdout.push_str(s.as_ref());
    out.stdout.push('\n');
}

pub(crate) fn dispatch(cli: &Cli, env: &Env, out: &mut Output) -> Result<i32, CliError> {
    let fmt = Fmt { long: cli.long };
    let path = || store::save_path(cli.save.as_deref(), |k| env.var(k).map(str::to_owned));
    let data = GameData::embedded();
    // held for the whole command
    let _lock = if writes_save(&cli.command) {
        let lock = Lock::acquire(&path()?, "swarm", cli.force).map_err(lock_error)?;
        Some(lock)
    } else {
        None
    };
    match &cli.command {
        Cmd::New => {
            let path = path()?;
            if !cli.force && store::read_opt(&path)?.is_some() {
                return Err(CliError::Usage(format!(
                    "a save exists at {}; use `swarm new --force` to replace it",
                    path.display()
                )));
            }
            let now = env.now_ms()?;
            let engine = Engine::new_game(data, now);
            let mut s = Session { path, engine };
            store::remove_opt(&store::undo_path(&s.path))?;
            s.commit()?;
            line(out, format!("New game saved to {}", s.path.display()));
        }
        Cmd::Show(args) => {
            let s = Session::open(path()?, env, out)?;
            let view = render::show(&s.engine, args.all, args.tab.as_deref())?;
            if args.json {
                line(out, render::to_json(&view.json()));
            } else {
                out.stdout.push_str(&view.text(&fmt));
            }
        }
        Cmd::Buy { unit, amount } => {
            let mut s = Session::open(path()?, env, out)?;
            let o = s.apply(Command::BuyUnit {
                unit: unit.as_str().into(),
                amount: Amount::Input(amount.clone()),
                ui: None,
            })?;
            report_bought(out, &fmt, &s.engine, unit, &o);
        }
        Cmd::BuyMax { unit, percent } => {
            let percent = parse_percent(percent)?;
            let mut s = Session::open(path()?, env, out)?;
            let o = s.apply(Command::BuyMaxUnit {
                unit: unit.as_str().into(),
                percent,
                ui: None,
            })?;
            report_bought(out, &fmt, &s.engine, unit, &o);
        }
        Cmd::Upgrade { name, amount } => {
            let mut s = Session::open(path()?, env, out)?;
            let o = s.apply(Command::BuyUpgrade {
                upgrade: name.as_str().into(),
                amount: Amount::Input(amount.clone()),
                ui: None,
            })?;
            report_levels(out, &fmt, &s.engine, name, &o);
        }
        Cmd::UpgradeMax { name, percent } => {
            let percent = parse_percent(percent)?;
            let mut s = Session::open(path()?, env, out)?;
            let o = s.apply(Command::BuyMaxUpgrade {
                upgrade: name.as_str().into(),
                percent,
                ui: None,
            })?;
            report_levels(out, &fmt, &s.engine, name, &o);
        }
        Cmd::UpgradeAll { percent } => {
            let percent = parse_percent(percent)?;
            let mut s = Session::open(path()?, env, out)?;
            if s.engine
                .available_autobuy_upgrades(Some(json_num(percent)))
                .is_empty()
            {
                return Err(CliError::Rule("no upgrades to buy".into()));
            }
            let o = s.apply(Command::BuyAllUpgrades {
                percent,
                which: UpgradeSet::Autobuyable,
            })?;
            let bought: Vec<_> = o
                .commands
                .iter()
                .filter(|c| c.name == "buyMaxUpgrade")
                .collect();
            for c in bought {
                let n = c.num.unwrap_or(Num::ZERO);
                let name = c.upgradename.as_deref().unwrap_or("?");
                let level = data.upgrade_id(name).map(|g| s.engine.upgrade_count(g));
                line(
                    out,
                    format!(
                        "Bought {} level(s) of {name} (now level {}).",
                        fmt.num(&n),
                        level.map_or("?".into(), |l| fmt.num(&l))
                    ),
                );
            }
        }
        Cmd::Ascend => {
            let mut s = Session::open(path()?, env, out)?;
            s.apply(Command::Ascend)?;
            let wk = data.well_known();
            line(
                out,
                format!(
                    "Ascended (ascension {}). Mutagen: {}.",
                    fmt.num(&s.engine.count(wk.ascension)),
                    fmt.num(&s.engine.count(wk.mutagen))
                ),
            );
        }
        Cmd::Respec { pay } => {
            let mut s = Session::open(path()?, env, out)?;
            let wk = data.well_known();
            let free = !pay && s.engine.count(wk.free_respec).is_positive();
            s.apply(if free {
                Command::RespecFree
            } else {
                Command::Respec
            })?;
            line(
                out,
                format!(
                    "Respecced ({}). Mutagen: {}.",
                    if free { "free" } else { "paid with energy" },
                    fmt.num(&s.engine.count(wk.mutagen))
                ),
            );
        }
        Cmd::Undo => {
            let mut s = Session::open(path()?, env, out)?;
            let snap = read_undo(&s.path, s.clock())?
                .ok_or_else(|| CliError::Rule(CommandError::NoUndo.to_string()))?;
            let undo = decode_any(&snap.save)
                .map_err(|e| CliError::Io(format!("undo file: {e}")))?
                .state;
            let current = s.engine.exported_state().clone();
            s.engine
                .import_state(undo)
                .map_err(|e| CliError::Rule(e.to_string()))?;
            let (next, msg) = match snap.kind {
                Kind::Undo => (Kind::Redo, "Undone. Run `swarm undo` again to redo."),
                Kind::Redo => (Kind::Undo, "Redone."),
            };
            write_undo(&s.path, next, s.clock(), &encode_v2(&current))?;
            s.commit()?;
            line(out, msg);
        }
        Cmd::Advance { duration } => {
            let d = parse_duration(duration).map_err(CliError::Usage)?;
            let mut s = Session::open(path()?, env, out)?;
            let before: Vec<Num> = data.units().iter().map(|u| s.engine.count(u.id)).collect();
            s.engine.advance(d);
            // write the counts back so the time survives in the save
            s.engine.save();
            s.commit()?;
            line(out, format!("Advanced {}.", format_duration(d)));
            for u in data.units() {
                let after = s.engine.count(u.id);
                if after != before[u.id.index()] && s.engine.unit_visible(u.id) {
                    line(
                        out,
                        format!(
                            "  {:<16} {} -> {}",
                            u.name,
                            fmt.num(&before[u.id.index()]),
                            fmt.num(&after)
                        ),
                    );
                }
            }
        }
        Cmd::Export { legacy: as_legacy } => {
            let s = Session::open(path()?, env, out)?;
            let now = s.clock();
            let text = if *as_legacy {
                let mut state = s.engine.state().clone();
                prepare_save(&mut state, now);
                legacy::encode(&state)
            } else {
                export_v2(&s.engine, now)
            };
            line(out, text);
        }
        Cmd::Import { file } => {
            let text = read_input(file, env)?;
            let format = swarm_save::detect(&text);
            let engine = load_text(&text, file, env, out)?;
            let mut s = Session {
                path: path()?,
                engine,
            };
            store::remove_opt(&store::undo_path(&s.path))?;
            s.commit()?;
            line(
                out,
                format!(
                    "Imported a {} save into {}",
                    format_name(format),
                    s.path.display()
                ),
            );
        }
        Cmd::Convert { input, output, to } => {
            let text = read_input(input, env)?;
            let d = decode_any(&text).map_err(|e| CliError::Io(format!("{input}: {e}")))?;
            for w in &d.warnings {
                out.stderr.push_str(&format!("warning: {w}\n"));
            }
            let converted = match to {
                SaveFormat::V2 => encode_v2(&d.state),
                SaveFormat::V1 => legacy::encode(&d.state),
            };
            if output == "-" {
                line(out, converted);
            } else {
                store::write_atomic(Path::new(output), &format!("{converted}\n"))?;
                out.stderr.push_str(&format!(
                    "Converted {} -> {:?}: {output}\n",
                    format_name(Some(d.format)),
                    to
                ));
            }
        }
        #[cfg(feature = "scenario")]
        Cmd::Scenario { cmd } => return scenario(cmd, out),
        Cmd::Bench {
            ticks,
            buys,
            from_save,
        } => {
            let engine = if *from_save {
                Session::open(path()?, env, out)?.engine
            } else {
                Engine::new_game(data, env.now_ms()?)
            };
            bench(engine, *ticks, *buys, out);
        }
        Cmd::Stats { json } => {
            let s = Session::open(path()?, env, out)?;
            let v = render::stats(&s.engine);
            if *json {
                line(out, render::to_json(&v));
            } else {
                out.stdout.push_str(&render::stats_text(&s.engine, &fmt));
            }
        }
        Cmd::Achievements { all, json } => {
            let s = Session::open(path()?, env, out)?;
            let list = render::achievements(&s.engine, *all);
            if *json {
                line(out, render::to_json(&list.json()));
            } else {
                out.stdout.push_str(&list.text(&fmt));
            }
        }
    }
    Ok(EXIT_OK)
}

fn format_name(f: Option<Format>) -> &'static str {
    match f {
        Some(Format::V1) => "v1",
        Some(Format::V2) => "v2",
        None => "unknown",
    }
}

fn report_bought(out: &mut Output, fmt: &Fmt, engine: &Engine, unit: &str, o: &CommandOutcome) {
    if let Some(b) = o.bought {
        let mut msg = format!("Bought {} {unit}", fmt.num(&b.num));
        if b.twinnum != b.num {
            msg.push_str(&format!(" (received {})", fmt.num(&b.twinnum)));
        }
        if let Some(id) = engine.data().unit_id(unit) {
            msg.push_str(&format!("; you have {}.", fmt.num(&engine.count(id))));
        }
        line(out, msg);
    }
}

fn report_levels(out: &mut Output, fmt: &Fmt, engine: &Engine, name: &str, o: &CommandOutcome) {
    if let Some(n) = o.levels {
        let level = engine
            .data()
            .upgrade_id(name)
            .map(|g| fmt.num(&engine.upgrade_count(g)));
        line(
            out,
            format!(
                "Bought {} level(s) of {name} (now level {}).",
                fmt.num(&n),
                level.unwrap_or_default()
            ),
        );
    }
}

#[cfg(feature = "scenario")]
fn scenario(cmd: &crate::ScenarioCmd, out: &mut Output) -> Result<i32, CliError> {
    use swarm_scenario::compare::{compare_results, Tolerance};
    use swarm_scenario::run::{try_run_scenario, Scenario};
    use swarm_scenario::{lockstep, scenario_to_json};

    use crate::ScenarioCmd;

    let read = |p: &Path| {
        std::fs::read_to_string(p).map_err(|e| CliError::Io(format!("{}: {e}", p.display())))
    };
    let json = |p: &Path| -> Result<serde_json::Value, CliError> {
        serde_json::from_str(&read(p)?)
            .map_err(|e| CliError::Usage(format!("{}: {e}", p.display())))
    };
    let scen = |p: &Path| {
        Scenario::from_json(&read(p)?).map_err(|e| CliError::Usage(format!("{}: {e}", p.display())))
    };
    let start = |e: swarm_scenario::run::StartError| CliError::Usage(e.to_string());
    let tol = Tolerance::default();
    let report = match cmd {
        ScenarioCmd::Run { scenario } => {
            let r = try_run_scenario(&scen(scenario)?).map_err(start)?;
            out.stdout.push_str(&scenario_to_json(&r));
            return Ok(EXIT_OK);
        }
        ScenarioCmd::Compare {
            scenario,
            expected,
            max,
            lockstep: ls,
        } => {
            let s = scen(scenario)?;
            let e = json(expected)?;
            let report = if *ls {
                lockstep::run_lockstep(&s, &e, &tol).map_err(start)?
            } else {
                compare_results(&e, &try_run_scenario(&s).map_err(start)?, &tol)
            };
            (report, *max)
        }
        ScenarioCmd::Golden { golden, max } => {
            let g = json(golden)?;
            let r = try_run_scenario(&Scenario::from_golden(&g)).map_err(start)?;
            (compare_results(&g, &r, &tol), *max)
        }
    };
    let (report, max) = report;
    out.stdout.push_str(&report.summary(max));
    Ok(if report.is_empty() {
        EXIT_OK
    } else {
        crate::EXIT_RULE
    })
}

fn bench(mut engine: Engine, ticks: u32, rounds: u32, out: &mut Output) {
    let data = engine.data();
    let ms = |d: Duration| d.as_secs_f64() * 1000.0;

    let t = Instant::now();
    for _ in 0..ticks {
        engine.advance(Duration::from_millis(100));
        for u in data.units() {
            if engine.unit_visible(u.id) {
                std::hint::black_box((
                    engine.count(u.id),
                    engine.velocity(u.id),
                    engine.unit_is_buyable(u.id, false),
                    engine.unit_max_cost_met(u.id, Num::ONE),
                ));
            }
        }
    }
    let tick_total = t.elapsed();

    let mut buys = 0u32;
    let mut buy_time = Duration::ZERO;
    for _ in 0..rounds {
        engine.advance(Duration::from_secs(60));
        let ids: Vec<_> = data
            .units()
            .iter()
            .map(|u| u.id)
            .filter(|&u| engine.unit_visible(u) && engine.unit_is_buyable(u, false))
            .collect();
        for u in ids {
            let t = Instant::now();
            let r = engine.apply(Command::BuyMaxUnit {
                unit: u.into(),
                percent: 1.0,
                ui: None,
            });
            buy_time += t.elapsed();
            if r.is_ok() {
                buys += 1;
            }
        }
        engine.drain_events();
    }

    let per = |total: Duration, n: u32| {
        if n == 0 {
            0.0
        } else {
            ms(total) / f64::from(n)
        }
    };
    line(
        out,
        format!(
            "ticks:   {ticks} in {:.1} ms, {:.4} ms/tick",
            ms(tick_total),
            per(tick_total, ticks)
        ),
    );
    line(
        out,
        format!(
            "buy-max: {buys} buys over {rounds} rounds in {:.1} ms, {:.4} ms/buy",
            ms(buy_time),
            per(buy_time, buys)
        ),
    );
}
