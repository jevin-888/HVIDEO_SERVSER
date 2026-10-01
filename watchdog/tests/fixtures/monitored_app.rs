// Real application-side protocol fixture. All runtime files live in the
// temporary directory supplied by watchdog-lifecycle.test.ps1.
#[allow(dead_code)]
#[path = "../../../src/process_guard.rs"]
mod process_guard;

fn main() {
    process_guard::install_panic_log();
    process_guard::install_native_crash_handler();
    if !process_guard::enter().unwrap() {
        return;
    }
    std::fs::write("worker.pid", std::process::id().to_string()).unwrap();
    loop {
        if let Ok(action) = std::fs::read_to_string("action") {
            std::fs::remove_file("action").unwrap();
            match action.trim() {
                "quit" => {
                    process_guard::request_user_exit("fixture user quit").unwrap();
                    return;
                }
                "zero" => std::process::exit(0),
                "panic" => panic!("real worker panic fixture"),
                "relaunch" => std::process::exit(process_guard::RELAUNCH_EXIT_CODE),
                #[cfg(windows)]
                "native" => unsafe {
                    #[link(name = "kernel32")]
                    extern "system" {
                        fn RaiseException(code: u32, flags: u32, count: u32, args: *const usize);
                        fn SetErrorMode(mode: u32) -> u32;
                    }
                    SetErrorMode(2); // no blocking Windows crash dialog in tests
                    RaiseException(0xE0424242, 1, 0, std::ptr::null());
                },
                _ => panic!("unknown fixture action"),
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
}
