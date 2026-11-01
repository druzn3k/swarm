//! The `:` command line: parsing, name resolution and completion matching.
//!
//! Names on the command line are the names the screen shows: a unit's slug
//! (`culicimorph`, `greater queen`), an upgrade's label as in the upgrades
//! pane (`Twin culicimorphs`), a tab's title. They may contain spaces, so
//! `buy` and `upgrade` resolve their argument by matching known names
//! against its start, longest first; the rest is the amount. Internal names
//! (`mosquito`) and plurals are accepted too. The completion state machine
//! (vim's wildmenu) is in [`crate::keymap`]; this module finds the matches.

use std::path::PathBuf;

/// A parsed command line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cmd {
    /// `buy <unit> [amount|max]`; the amount goes to `parse_number`.
    Buy {
        /// The unit.
        unit: u16,
        /// `None` for 1.
        amount: Option<String>,
    },
    /// `upgrade <name> [amount|max]`.
    Upgrade {
        /// The upgrade or ability.
        upgrade: u16,
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

/// Names that resolve to one kind of thing (units or upgrades).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NameSet {
    /// Every accepted spelling (shown name, plural, internal name, label)
    /// with its id, in order of preference: the first match wins.
    pub aliases: Vec<(String, u16)>,
    /// The shown names, for "did you mean" (the completion candidates).
    pub shown: Vec<String>,
}

impl NameSet {
    /// Adds a spelling (ignored when empty).
    pub fn alias(&mut self, name: &str, id: u16) {
        let name = normalize(name);
        if !name.is_empty() {
            self.aliases.push((name, id));
        }
    }

    /// Resolves the start of `arg`: the longest known name made of its
    /// first words (case-insensitive, any spacing), and the remaining words.
    pub fn resolve(&self, arg: &str) -> Option<(u16, Option<String>)> {
        let words: Vec<&str> = arg.split_whitespace().collect();
        (1..=words.len()).rev().find_map(|k| {
            let head = words[..k].join(" ").to_lowercase();
            self.aliases
                .iter()
                .find(|(a, _)| *a == head)
                .map(|&(_, id)| (id, (k < words.len()).then(|| words[k..].join(" "))))
        })
    }

    /// Up to five shown names close to `arg`: containing its first word, or
    /// one of whose words is a small edit away from it.
    pub fn close_to(&self, arg: &str) -> Vec<String> {
        let first = arg
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_lowercase();
        if first.is_empty() {
            return Vec::new();
        }
        let mut out: Vec<String> = self
            .shown
            .iter()
            .filter(|s| s.to_lowercase().contains(&first))
            .cloned()
            .collect();
        if out.is_empty() {
            let max = if first.chars().count() <= 4 { 1 } else { 2 };
            out = self
                .shown
                .iter()
                .filter(|s| {
                    s.to_lowercase()
                        .split_whitespace()
                        .any(|w| edit_distance(w, &first) <= max)
                })
                .cloned()
                .collect();
        }
        out.truncate(5);
        out
    }

    fn lookup(&self, what: &str, arg: &str) -> Result<(u16, Option<String>), String> {
        self.resolve(arg).ok_or_else(|| {
            let close = self.close_to(arg);
            if close.is_empty() {
                format!("No such {what}: {arg}")
            } else {
                format!("No such {what}: {arg} (did you mean {}?)", close.join(", "))
            }
        })
    }
}

/// The names `buy` and `upgrade` resolve.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Names {
    /// Units.
    pub units: NameSet,
    /// Upgrades and abilities.
    pub upgrades: NameSet,
}

fn normalize(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut cur = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let sub = prev[j] + usize::from(ca != *cb);
            cur.push(sub.min(prev[j + 1] + 1).min(cur[j] + 1));
        }
        prev = cur;
    }
    prev[b.len()]
}

fn on_off(word: Option<&str>) -> Result<Option<bool>, String> {
    match word {
        None => Ok(None),
        Some("on" | "true" | "1" | "yes") => Ok(Some(true)),
        Some("off" | "false" | "0" | "no") => Ok(Some(false)),
        Some(w) => Err(format!("expected on or off, not {w:?}")),
    }
}

/// Parses a command line (without the `:`), resolving unit and upgrade
/// names with `names`.
pub fn parse(line: &str, names: &Names) -> Result<Cmd, String> {
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
        "buy" | "b" => {
            let arg = rest_from(0).ok_or("usage: buy <unit> [amount|max]")?;
            let (unit, amount) = names.units.lookup("unit", &arg)?;
            Ok(Cmd::Buy { unit, amount })
        }
        "upgrade" | "up" | "u" => {
            let arg = rest_from(0).ok_or("usage: upgrade <name> [amount|max]")?;
            let (upgrade, amount) = names.upgrades.lookup("upgrade", &arg)?;
            Ok(Cmd::Upgrade { upgrade, amount })
        }
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

// ---------------------------------------------------------------- completion

/// What Tab can complete to, as the screen shows it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Candidates {
    /// Visible units' shown names (slugs), in list order.
    pub units: Vec<String>,
    /// Visible upgrades' and abilities' labels, as in the upgrades pane.
    pub upgrades: Vec<String>,
    /// Tab titles, as in the tab bar.
    pub tabs: Vec<String>,
}

/// The matches for the text before the cursor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Matches {
    /// Where the completed text starts in the line, in chars: the command
    /// word, or the whole argument after it.
    pub start: usize,
    /// The matching candidates.
    pub items: Vec<String>,
    /// The items start with the typed text (else they only contain it), so
    /// a longer common prefix may extend it.
    pub prefix: bool,
}

/// Finds what to complete in `head` (the line up to the cursor): the
/// command word, else the whole argument of `buy`, `upgrade`, `tab`,
/// `anim` or `mouse`. Case-insensitive prefix matches, else substring
/// matches; an empty argument matches everything. `None` when there is
/// nothing to complete there.
pub fn find_matches(head: &str, cands: &Candidates) -> Option<Matches> {
    let lead = head.len() - head.trim_start().len();
    let body = &head[lead..];
    let (start_byte, list): (usize, Vec<&str>) = match body.find(char::is_whitespace) {
        None => (lead, COMMANDS.to_vec()),
        Some(end) => {
            let after = &body[end..];
            let arg_at = lead + end + (after.len() - after.trim_start().len());
            let list: Vec<&str> = match &body[..end] {
                "buy" | "b" => cands.units.iter().map(String::as_str).collect(),
                "upgrade" | "up" | "u" => cands.upgrades.iter().map(String::as_str).collect(),
                "tab" => cands.tabs.iter().map(String::as_str).collect(),
                "anim" | "mouse" => vec!["on", "off"],
                _ => return None,
            };
            (arg_at, list)
        }
    };
    let typed = head[start_byte..].to_lowercase();
    let mut seen = std::collections::BTreeSet::new();
    let list: Vec<&str> = list.into_iter().filter(|c| seen.insert(*c)).collect();
    let pick = |f: &dyn Fn(&str) -> bool| -> Vec<String> {
        list.iter()
            .filter(|c| f(&c.to_lowercase()))
            .map(|c| c.to_string())
            .collect()
    };
    let mut items = pick(&|c| c.starts_with(&typed));
    let prefix = !items.is_empty();
    if !prefix {
        items = pick(&|c| c.contains(&typed));
    }
    Some(Matches {
        start: head[..start_byte].chars().count(),
        items,
        prefix,
    })
}

/// The longest case-insensitive common prefix of `items`, in the first
/// item's spelling.
pub fn common_prefix(items: &[String]) -> String {
    let Some(first) = items.first() else {
        return String::new();
    };
    let lower = |s: &str| s.chars().flat_map(char::to_lowercase).collect::<Vec<_>>();
    let f = lower(first);
    let mut n = f.len();
    for s in &items[1..] {
        let l = lower(s);
        n = n.min(f.iter().zip(&l).take_while(|(a, b)| a == b).count());
    }
    // a lowercase char can expand; fall back to the char count of the
    // original when the lengths differ
    if f.len() == first.chars().count() {
        first.chars().take(n).collect()
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (shown, plural, internal, id)
    const UNITS: &[(&str, &str, &str, u16)] = &[
        ("drone", "drones", "drone", 14),
        ("queen", "queens", "queen", 15),
        ("greater queen", "greater queens", "greaterqueen", 17),
        ("hive", "hives", "hive", 18),
        ("hive queen", "hive queens", "hivequeen", 19),
        ("arachnomorph", "arachnomorphs", "spider", 36),
        ("culicimorph", "culicimorphs", "mosquito", 37),
        (
            "giant arachnomorph",
            "giant arachnomorphs",
            "giantspider",
            40,
        ),
        ("lesser hive mind", "lesser hive minds", "pantheon3", 25),
    ];
    const UPGRADES: &[(&str, &str, u16)] = &[
        ("Hatchery", "hatchery", 0),
        ("Faster drones", "droneprod", 4),
        ("Twin drones", "dronetwin", 24),
        ("Twin culicimorphs", "mosquitotwin", 47),
    ];

    fn names() -> Names {
        let mut n = Names::default();
        for &(s, p, i, id) in UNITS {
            n.units.alias(s, id);
            n.units.alias(p, id);
            n.units.alias(i, id);
            n.units.shown.push(s.into());
        }
        for &(l, i, id) in UPGRADES {
            n.upgrades.alias(l, id);
            n.upgrades.alias(i, id);
            n.upgrades.shown.push(l.into());
        }
        n
    }

    fn cands() -> Candidates {
        Candidates {
            units: UNITS.iter().map(|u| u.0.to_string()).collect(),
            upgrades: UPGRADES.iter().map(|u| u.0.to_string()).collect(),
            tabs: ["Meat", "Larva", "Achievements", "Stats", "Options"]
                .map(String::from)
                .to_vec(),
        }
    }

    fn p(s: &str) -> Cmd {
        parse(s, &names()).unwrap_or_else(|e| panic!("{s}: {e}"))
    }

    fn buy(unit: u16, amount: Option<&str>) -> Cmd {
        Cmd::Buy {
            unit,
            amount: amount.map(String::from),
        }
    }

    #[test]
    fn parses_commands() {
        assert_eq!(p("buy drone 100"), buy(14, Some("100")));
        assert_eq!(p("buy drone 1.5 billion"), buy(14, Some("1.5 billion")));
        assert_eq!(p("  buy queen"), buy(15, None));
        assert_eq!(
            p("upgrade hatchery max"),
            Cmd::Upgrade {
                upgrade: 0,
                amount: Some("max".into())
            }
        );
        assert_eq!(p("ascend"), Cmd::Ascend);
        assert_eq!(p("respec"), Cmd::Respec);
        assert_eq!(p("undo"), Cmd::Undo);
        assert_eq!(p("export"), Cmd::Export(None));
        assert_eq!(
            p("export /tmp/s.txt"),
            Cmd::Export(Some("/tmp/s.txt".into()))
        );
        assert_eq!(p("import a.txt"), Cmd::Import("a.txt".into()));
        assert_eq!(p("anim off"), Cmd::Anim(Some(false)));
        assert_eq!(p("anim"), Cmd::Anim(None));
        assert_eq!(p("mouse on"), Cmd::Mouse(Some(true)));
        assert_eq!(p("long"), Cmd::Format { long: true });
        assert_eq!(p("short"), Cmd::Format { long: false });
        assert_eq!(p("save"), Cmd::Save);
        assert_eq!(p("q"), Cmd::Quit);
        assert_eq!(p("quit"), Cmd::Quit);
        assert_eq!(p("help"), Cmd::Help);
        assert_eq!(p("tab larva"), Cmd::Tab("larva".into()));
        assert_eq!(p("tab Achievements"), Cmd::Tab("Achievements".into()));
    }

    #[test]
    fn multi_word_names_and_amounts() {
        assert_eq!(p("buy greater queen 100"), buy(17, Some("100")));
        assert_eq!(p("buy greater queen"), buy(17, None));
        assert_eq!(p("buy Greater  Queen   max"), buy(17, Some("max")));
        assert_eq!(
            p("buy giant arachnomorph 1.5 billion"),
            buy(40, Some("1.5 billion"))
        );
        assert_eq!(p("buy giant arachnomorph"), buy(40, None));
        assert_eq!(p("buy lesser hive mind @1e6"), buy(25, Some("@1e6")));
        // longest match first: "hive queen" over "hive" + amount "queen"
        assert_eq!(p("buy hive queen 5"), buy(19, Some("5")));
        assert_eq!(p("buy hive 5"), buy(18, Some("5")));
        assert_eq!(p("buy hive"), buy(18, None));
        // plural, internal and the capitalised label all work
        assert_eq!(p("buy culicimorphs 25%"), buy(37, Some("25%")));
        assert_eq!(p("buy mosquito 10"), buy(37, Some("10")));
        assert_eq!(p("buy Culicimorphs"), buy(37, None));
        assert_eq!(p("buy giantspider 2"), buy(40, Some("2")));
        assert_eq!(
            p("buy greater queens 1.5 billion"),
            buy(17, Some("1.5 billion"))
        );
        let up = |upgrade, amount: Option<&str>| Cmd::Upgrade {
            upgrade,
            amount: amount.map(String::from),
        };
        assert_eq!(p("upgrade twin culicimorphs max"), up(47, Some("max")));
        assert_eq!(p("upgrade Twin culicimorphs"), up(47, None));
        assert_eq!(p("upgrade mosquitotwin 3"), up(47, Some("3")));
        assert_eq!(p("u faster drones 1.5 billion"), up(4, Some("1.5 billion")));
    }

    #[test]
    fn rejects_bad_commands() {
        let n = names();
        assert!(parse("", &n).is_err());
        assert!(parse("frobnicate", &n).is_err());
        assert!(parse("buy", &n).is_err());
        assert!(parse("import", &n).is_err());
        assert!(parse("anim maybe", &n).is_err());
        assert!(parse("ascend now", &n).is_err());
        // "giant" alone is not a unit
        assert!(parse("buy giant 5", &n).is_err());
    }

    #[test]
    fn unknown_names_suggest_close_ones() {
        let n = names();
        let e = parse("buy arachno 5", &n).unwrap_err();
        assert_eq!(
            e,
            "No such unit: arachno 5 (did you mean arachnomorph, giant arachnomorph?)"
        );
        let e = parse("buy culicimorf", &n).unwrap_err();
        assert!(e.contains("did you mean culicimorph?"), "{e}");
        let e = parse("upgrade twin 1", &n).unwrap_err();
        assert!(e.contains("Twin drones, Twin culicimorphs"), "{e}");
        let e = parse("buy zzz", &n).unwrap_err();
        assert_eq!(e, "No such unit: zzz");
    }

    fn m(head: &str) -> Option<(usize, Vec<String>, bool)> {
        find_matches(head, &cands()).map(|m| (m.start, m.items, m.prefix))
    }

    fn items(head: &str) -> Vec<String> {
        m(head).unwrap().1
    }

    #[test]
    fn candidates_are_shown_names() {
        assert_eq!(items("bu"), vec!["buy"]);
        assert_eq!(items("u"), vec!["upgrade", "undo"]);
        assert_eq!(m("buy cul"), Some((4, vec!["culicimorph".into()], true)));
        // internal names are not offered
        assert_eq!(items("buy mosq"), Vec::<String>::new());
        assert_eq!(items("buy greater q"), vec!["greater queen"]);
        assert_eq!(items("upgrade twin c"), vec!["Twin culicimorphs"]);
        assert_eq!(items("up tw"), vec!["Twin drones", "Twin culicimorphs"]);
        assert_eq!(items("tab st"), vec!["Stats"]);
        assert_eq!(items("anim o"), vec!["on", "off"]);
        assert_eq!(items("mouse of"), vec!["off"]);
        // the whole argument, with spaces, is what is completed
        assert_eq!(
            m("buy   hive q"),
            Some((6, vec!["hive queen".into()], true))
        );
        assert_eq!(m("  bu"), Some((2, vec!["buy".into()], true)));
        // an amount after the name matches nothing
        assert_eq!(items("buy drone 1"), Vec::<String>::new());
        // nothing to complete after other commands
        assert_eq!(m("export fo"), None);
    }

    #[test]
    fn empty_argument_lists_all_and_substring_fallback() {
        assert_eq!(m("buy ").unwrap().1.len(), UNITS.len());
        assert_eq!(m("").unwrap().1.len(), COMMANDS.len());
        // no unit starts with "morph": substring matches, not extendable
        assert_eq!(
            m("buy morph"),
            Some((
                4,
                vec![
                    "arachnomorph".into(),
                    "culicimorph".into(),
                    "giant arachnomorph".into()
                ],
                false
            ))
        );
        assert_eq!(items("buy QUEEN"), vec!["queen"]);
        assert_eq!(
            items("buy een"),
            vec!["queen", "greater queen", "hive queen"]
        );
    }

    #[test]
    fn common_prefixes() {
        let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(common_prefix(&v(&["hive", "hive queen"])), "hive");
        assert_eq!(
            common_prefix(&v(&["Twin drones", "twin culicimorphs"])),
            "Twin "
        );
        assert_eq!(common_prefix(&v(&[])), "");
    }
}
