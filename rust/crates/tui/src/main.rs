//! The `swarm-tui` binary.

fn main() {
    let opts = match swarm_tui::parse_args(std::env::args().skip(1)) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("swarm-tui: {e}");
            std::process::exit(2);
        }
    };
    if opts.help {
        print!("{}", swarm_tui::USAGE);
        return;
    }
    if let Err(e) = swarm_tui::run(opts) {
        eprintln!("swarm-tui: {e}");
        std::process::exit(1);
    }
}
