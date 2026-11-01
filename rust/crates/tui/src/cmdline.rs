//! The `:` command line: parsing and tab completion.

use std::path::PathBuf;

/// A parsed command line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cmd {
    /// `buy <unit> [amount|max]`; the amount goes to `parse_number`.
    Buy {
        /// Unit name or label.
        unit: String,
        /// `None` for 1.
        amount: Option<String>,
    },
    /// `upgrade <name> [amount|max]`.
    Upgrade {
        /// Upgrade name or label.
        name: String,
        /// `None` for 1.
        amount: Option<String>,
    },
    /// `ascend`.
    Ascend,
    /// `respec`.
    Respec,
    /// `undo`.
    Undo,
    /// `export [file]`: to a file, or shown on screen.
    Export(Option<PathBuf>),
    /// `import <file>`.
    Import(PathBuf),
    /// `anim [on|off]` (`None` toggles).
    Anim(Option<bool>),
    /// `mouse [on|off]` (`None` toggles).
    Mouse(Option<bool>),
    /// `long` / `short` number format.
    Format {
        /// Long names.
        long: bool,
    },
    /// `save`.
    Save,
    /// `quit` / `q` / `wq` / `x`.
    Quit,
    /// `help` / `h`.
    Help,
    /// `tab <name|number>`.
    Tab(String),
}

/// The command words, for completion and help.
pub const COMMANDS: &[&str] = &[
    "buy", "upgrade", "ascend", "respec", "undo", "export", "import", "anim", "mouse", "long",
    "short", "save", "quit", "help", "tab",
];

fn on_off(word: Option<&str>) -> Result<Option<bool>, String> {
    match word {
        None => Ok(None),
        Some("on" | "true" | "1" | "yes") => Ok(Some(true)),
        Some("off" | "false" | "0" | "no") => Ok(Some(false)),
        Some(w) => Err(format!("expected on or off, not {w:?}")),
    }
}

/// Parses a command line (without the `:`).
pub fn parse(line: &str) -> Result<Cmd, String> {
    let mut words = line.split_whitespace();
    let Some(cmd) = words.next() else {
        return Err("empty command".into());
    };
    let rest: Vec<&str> = words.collect();
    let rest_from = |i: usize| -> Option<String> { (rest.len() > i).then(|| rest[i..].join(" ")) };
    let no_args = |c: Cmd| {
        if rest.is_empty() {
            Ok(c)
        } else {
            Err(format!("{cmd} takes no arguments"))
        }
    };
    match cmd {
        "buy" | "b" => Ok(Cmd::Buy {
            unit: rest
                .first()
                .ok_or("usage: buy <unit> [amount|max]")?
                .to_string(),
            amount: rest_from(1),
        }),
        "upgrade" | "up" | "u" => Ok(Cmd::Upgrade {
            name: rest
                .first()
                .ok_or("usage: upgrade <name> [amount|max]")?
                .to_string(),
            amount: rest_from(1),
        }),
        "ascend" => no_args(Cmd::Ascend),
        "respec" => no_args(Cmd::Respec),
        "undo" | "redo" => no_args(Cmd::Undo),
        "export" => Ok(Cmd::Export(rest_from(0).map(PathBuf::from))),
        "import" => Ok(Cmd::Import(PathBuf::from(
            rest_from(0).ok_or("usage: import <file>")?,
        ))),
        "anim" => Ok(Cmd::Anim(on_off(rest.first().copied())?)),
        "mouse" => Ok(Cmd::Mouse(on_off(rest.first().copied())?)),
        "long" => no_args(Cmd::Format { long: true }),
        "short" => no_args(Cmd::Format { long: false }),
        "save" | "w" => no_args(Cmd::Save),
        "quit" | "q" | "wq" | "x" | "exit" => no_args(Cmd::Quit),
        "help" | "h" | "?" => Ok(Cmd::Help),
        "tab" => Ok(Cmd::Tab(rest_from(0).ok_or("usage: tab <name|number>")?)),
        _ => Err(format!("unknown command: {cmd} (try :help)")),
    }
}

fn common_prefix<'a>(mut it: impl Iterator<Item = &'a str>) -> Option<String> {
    let first = it.next()?.to_owned();
    let mut p = first;
    for s in it {
        let n = p.chars().zip(s.chars()).take_while(|(a, b)| a == b).count();
        p = p.chars().take(n).collect();
    }
    Some(p)
}

/// Completes the last word of `line`: the command word, else a unit name
/// after `buy`, an upgrade name after `upgrade`, on/off, or a tab. Extends to
/// the longest common prefix, adding a space when unique. Returns the line
/// unchanged when nothing matches.
pub fn complete(line: &str, units: &[String], upgrades: &[String], tabs: &[String]) -> String {
    let words: Vec<&str> = line.split_whitespace().collect();
    let trailing_space = line.ends_with(' ');
    let (done, word): (Vec<&str>, &str) = if trailing_space || words.is_empty() {
        (words.clone(), "")
    } else {
        (words[..words.len() - 1].to_vec(), words[words.len() - 1])
    };
    let on_off = ["on".to_string(), "off".to_string()];
    let cmds: Vec<String> = COMMANDS.iter().map(|s| s.to_string()).collect();
    let candidates: &[String] = match done.as_slice() {
        [] => &cmds,
        ["buy" | "b"] => units,
        ["upgrade" | "up" | "u"] => upgrades,
        ["anim" | "mouse"] => &on_off,
        ["tab"] => tabs,
        _ => return line.to_owned(),
    };
    let matches: Vec<&str> = candidates
        .iter()
        .map(String::as_str)
        .filter(|c| c.starts_with(word))
        .collect();
    let Some(prefix) = common_prefix(matches.iter().copied()) else {
        return line.to_owned();
    };
    let mut out = done.join(" ");
    if !out.is_empty() {
        out.push(' ');
    }
    out.push_str(&prefix);
    if matches.len() == 1 {
        out.push(' ');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_commands() {
        assert_eq!(
            parse("buy drone 100").unwrap(),
            Cmd::Buy {
                unit: "drone".into(),
                amount: Some("100".into())
            }
        );
        assert_eq!(
            parse("buy drone 1.5 billion").unwrap(),
            Cmd::Buy {
                unit: "drone".into(),
                amount: Some("1.5 billion".into())
            }
        );
        assert_eq!(
            parse("  buy queen").unwrap(),
            Cmd::Buy {
                unit: "queen".into(),
                amount: None
            }
        );
        assert_eq!(
            parse("upgrade hatchery max").unwrap(),
            Cmd::Upgrade {
                name: "hatchery".into(),
                amount: Some("max".into())
            }
        );
        assert_eq!(parse("ascend").unwrap(), Cmd::Ascend);
        assert_eq!(parse("respec").unwrap(), Cmd::Respec);
        assert_eq!(parse("undo").unwrap(), Cmd::Undo);
        assert_eq!(parse("export").unwrap(), Cmd::Export(None));
        assert_eq!(
            parse("export /tmp/s.txt").unwrap(),
            Cmd::Export(Some("/tmp/s.txt".into()))
        );
        assert_eq!(parse("import a.txt").unwrap(), Cmd::Import("a.txt".into()));
        assert_eq!(parse("anim off").unwrap(), Cmd::Anim(Some(false)));
        assert_eq!(parse("anim").unwrap(), Cmd::Anim(None));
        assert_eq!(parse("mouse on").unwrap(), Cmd::Mouse(Some(true)));
        assert_eq!(parse("long").unwrap(), Cmd::Format { long: true });
        assert_eq!(parse("short").unwrap(), Cmd::Format { long: false });
        assert_eq!(parse("save").unwrap(), Cmd::Save);
        assert_eq!(parse("q").unwrap(), Cmd::Quit);
        assert_eq!(parse("quit").unwrap(), Cmd::Quit);
        assert_eq!(parse("help").unwrap(), Cmd::Help);
        assert_eq!(parse("tab larva").unwrap(), Cmd::Tab("larva".into()));
    }

    #[test]
    fn rejects_bad_commands() {
        assert!(parse("").is_err());
        assert!(parse("frobnicate").is_err());
        assert!(parse("buy").is_err());
        assert!(parse("import").is_err());
        assert!(parse("anim maybe").is_err());
        assert!(parse("ascend now").is_err());
    }

    #[test]
    fn completes() {
        let units = vec![
            "drone".to_string(),
            "queen".into(),
            "nest".into(),
            "nexus".into(),
        ];
        let ups = vec!["hatchery".to_string(), "droneprod".into()];
        let tabs = vec!["meat".to_string()];
        assert_eq!(complete("bu", &units, &ups, &tabs), "buy ");
        assert_eq!(complete("buy dr", &units, &ups, &tabs), "buy drone ");
        assert_eq!(complete("buy n", &units, &ups, &tabs), "buy ne");
        assert_eq!(
            complete("upgrade h", &units, &ups, &tabs),
            "upgrade hatchery "
        );
        assert_eq!(complete("anim o", &units, &ups, &tabs), "anim o");
        assert_eq!(complete("anim of", &units, &ups, &tabs), "anim off ");
        assert_eq!(complete("buy zz", &units, &ups, &tabs), "buy zz");
        assert_eq!(complete("buy drone 1", &units, &ups, &tabs), "buy drone 1");
    }
}
