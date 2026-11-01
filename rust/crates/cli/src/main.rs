use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let out = swarm_cli::run(std::env::args_os(), &swarm_cli::Env::from_process());
    let _ = std::io::stdout().write_all(out.stdout.as_bytes());
    let _ = std::io::stderr().write_all(out.stderr.as_bytes());
    ExitCode::from(u8::try_from(out.code).unwrap_or(1))
}
