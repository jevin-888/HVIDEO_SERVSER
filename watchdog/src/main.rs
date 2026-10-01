#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Share the exact launch/exit protocol with the application without linking
// Tauri, WebView2, the database or the HTTP server into the supervisor.
#[allow(dead_code)]
#[path = "../../src/process_guard.rs"]
mod process_guard;

fn main() {
    process_guard::install_panic_log();
    if let Err(error) = process_guard::run_watchdog() {
        process_guard::append_diagnostic("watchdog.log", format!("Watchdog failed: {error}"));
        std::process::exit(1);
    }
}
