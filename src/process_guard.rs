//! Shared protocol for the application and the independent watchdog executable.
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const CHILD_ARG: &str = "--hvideo-supervised";
const STOP_ENV: &str = "HVIDEO_WATCHDOG_STOP_FILE";
pub const RELAUNCH_EXIT_CODE: i32 = 75;

pub fn append_diagnostic(file: &str, message: impl AsRef<str>) {
    append_diagnostic_at(std::path::Path::new("logs"), file, message);
}

fn append_diagnostic_at(log_dir: &std::path::Path, file: &str, message: impl AsRef<str>) {
    let _ = std::fs::create_dir_all(log_dir);
    if let Ok(mut output) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join(file))
    {
        let _ = writeln!(
            output,
            "{} pid={} {}",
            chrono::Local::now().to_rfc3339(),
            std::process::id(),
            message.as_ref()
        );
    }
}

/// Install before creating runtimes or WebViews: GUI builds have no visible stderr.
pub fn install_panic_log() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        append_diagnostic(
            "crash.log",
            format!(
                "thread={:?} {info}\n{}",
                std::thread::current().name(),
                std::backtrace::Backtrace::force_capture()
            ),
        );
        previous(info);
    }));
}

/// Capture Windows SEH crashes that never reach Rust's panic hook (WebView2,
/// graphics DLLs, access violations). A compact minidump is written beside the
/// normal logs so the watchdog can be correlated with a debuggable artifact.
#[cfg(windows)]
pub fn install_native_crash_handler() {
    unsafe {
        SetUnhandledExceptionFilter(Some(native_exception_filter));
    }
}

#[cfg(not(windows))]
pub fn install_native_crash_handler() {}

#[cfg(windows)]
#[repr(C)]
struct ExceptionPointers {
    exception_record: *mut ExceptionRecord,
    context_record: *mut core::ffi::c_void,
}

#[cfg(windows)]
#[repr(C)]
struct ExceptionRecord {
    code: u32,
    flags: u32,
    record: *mut ExceptionRecord,
    address: *mut core::ffi::c_void,
    parameter_count: u32,
    information: [usize; 15],
}

// DbgHelp uses pack(4), including on x64. This is NOT EXCEPTION_POINTERS.
#[cfg(windows)]
#[repr(C, packed(4))]
struct MiniDumpExceptionInformation {
    thread_id: u32,
    exception_pointers: *mut ExceptionPointers,
    client_pointers: i32,
}

#[cfg(windows)]
type ExceptionFilter = unsafe extern "system" fn(*mut ExceptionPointers) -> i32;

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentProcess() -> *mut core::ffi::c_void;
    fn GetCurrentProcessId() -> u32;
    fn GetCurrentThreadId() -> u32;
    fn SetUnhandledExceptionFilter(filter: Option<ExceptionFilter>) -> Option<ExceptionFilter>;
}

#[cfg(windows)]
#[link(name = "dbghelp")]
extern "system" {
    fn MiniDumpWriteDump(
        process: *mut core::ffi::c_void,
        process_id: u32,
        file: *mut core::ffi::c_void,
        dump_type: u32,
        exception: *mut MiniDumpExceptionInformation,
        user_stream: *mut core::ffi::c_void,
        callback: *mut core::ffi::c_void,
    ) -> i32;
}

#[cfg(windows)]
unsafe extern "system" fn native_exception_filter(info: *mut ExceptionPointers) -> i32 {
    let _ = std::fs::create_dir_all("logs/crashes");
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let path = std::path::PathBuf::from(format!(
        "logs/crashes/native-{stamp}-{}.dmp",
        GetCurrentProcessId()
    ));
    let mut dump_info = MiniDumpExceptionInformation {
        thread_id: GetCurrentThreadId(),
        exception_pointers: info,
        client_pointers: 0,
    };
    let result = if let Ok(file) = std::fs::File::create(&path) {
        use std::os::windows::io::AsRawHandle;
        // MiniDumpWithIndirectlyReferencedMemory + data-segments gives useful
        // stacks while keeping files small enough for routine field support.
        if MiniDumpWriteDump(
            GetCurrentProcess(),
            GetCurrentProcessId(),
            file.as_raw_handle() as _,
            0x00000402,
            &mut dump_info,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        ) != 0
        {
            let _ = file.sync_all();
            "written".to_string()
        } else {
            format!("FAILED: {}", io::Error::last_os_error())
        }
    } else {
        "FAILED: cannot create dump file".to_string()
    };
    if !info.is_null() && !(*info).exception_record.is_null() {
        let record = &*(*info).exception_record;
        append_diagnostic("crash.log", format!("native SEH crash; pid={} tid={} code=0x{:08X} address={:p} dump={} result={result}", GetCurrentProcessId(), GetCurrentThreadId(), record.code, record.address, path.display()));
    }
    // Keep Windows' normal unhandled-exception/WER processing available.
    0
}

pub fn retry_delay(failures: u32) -> Duration {
    Duration::from_secs((3_u64 << failures.saturating_sub(1).min(5)).min(60))
}

fn acquire_lock(path: &std::path::Path) -> io::Result<File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)?;
    file.try_lock().map_err(io::Error::from)?;
    Ok(file)
}

/// The initial application process delegates to a separate executable and exits.
/// Only the watchdog's child proceeds to initialize the GUI/backend.
pub fn enter() -> io::Result<bool> {
    if std::env::args_os().any(|arg| arg == CHILD_ARG) && std::env::var_os(STOP_ENV).is_some() {
        // A worker lock also prevents duplicate children if a watchdog is killed
        // while its application is still alive and another launcher is opened.
        static WORKER_LOCK: std::sync::OnceLock<File> = std::sync::OnceLock::new();
        std::fs::create_dir_all("logs")?;
        WORKER_LOCK.get_or_init(|| {
            acquire_lock(std::path::Path::new("logs/application.lock"))
                .expect("another application instance is already running")
        });
        return Ok(true);
    }
    let exe = std::env::current_exe()?;
    let directory = exe
        .parent()
        .ok_or_else(|| io::Error::other("missing executable directory"))?;
    let name = format!("hvideo-watchdog{}", std::env::consts::EXE_SUFFIX);
    let guard = [
        directory.join(&name),
        directory
            .join("_up_")
            .join("watchdog")
            .join("target")
            .join("release")
            .join(&name),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "hvideo-watchdog executable missing; install the complete application package",
        )
    })?;
    let mut command = Command::new(&guard);
    command
        .arg("--target")
        .arg(&exe)
        .arg("--work-dir")
        .arg(std::env::current_dir()?)
        .arg("--")
        .args(std::env::args_os().skip(1).filter(|arg| arg != CHILD_ARG));
    hide_console(&mut command);
    command.stdin(Stdio::null()).stdout(Stdio::null());
    std::fs::create_dir_all("logs")?;
    command.stderr(Stdio::from(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open("logs/process-stderr.log")?,
    ));
    let guard_process = command.spawn()?;
    append_diagnostic(
        "watchdog.log",
        format!(
            "Launched independent watchdog pid={} exe={}",
            guard_process.id(),
            guard.display()
        ),
    );
    Ok(false)
}

fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Called only by explicit user-exit flows. Exit code 0 alone is insufficient:
/// external tools can terminate a process with that code too.
pub fn request_user_exit(reason: &str) -> io::Result<()> {
    let path = std::env::var_os(STOP_ENV)
        .ok_or_else(|| io::Error::other("application is not supervised"))?;
    let mut file = File::create(path)?;
    writeln!(
        file,
        "{}\n{}",
        std::process::id(),
        reason.replace(['\r', '\n'], " ")
    )?;
    file.sync_all()?;
    append_diagnostic("watchdog.log", format!("User exit requested: {reason}"));
    Ok(())
}

pub fn run_watchdog() -> io::Result<()> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--target")) {
        return Err(io::Error::other(
            "expected --target EXE --work-dir DIRECTORY -- [arguments]",
        ));
    }
    let target = std::path::PathBuf::from(
        args.next()
            .ok_or_else(|| io::Error::other("missing target"))?,
    );
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--work-dir")) {
        return Err(io::Error::other("missing --work-dir"));
    }
    let work_dir = args
        .next()
        .ok_or_else(|| io::Error::other("missing directory"))?;
    std::env::set_current_dir(work_dir)?;
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--"))
        || !target.is_absolute()
        || !target.is_file()
    {
        return Err(io::Error::other("invalid target or arguments"));
    }
    std::fs::create_dir_all("logs")?;
    let _lock = match acquire_lock(std::path::Path::new("logs/process-guard.lock")) {
        Ok(lock) => lock,
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            append_diagnostic(
                "watchdog.log",
                "Already supervised; ignoring duplicate launch",
            );
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    // Do not silently adopt an orphan whose exit notification belongs to a
    // different supervisor session; that could resurrect an intentional exit.
    match acquire_lock(std::path::Path::new("logs/application.lock")) {
        Ok(lock) => drop(lock),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            append_diagnostic("watchdog.log", "Application exists without this watchdog; duplicate launch refused. Exit the existing application before restarting it.");
            return Ok(());
        }
        Err(error) => return Err(error),
    }
    append_diagnostic(
        "watchdog.log",
        format!(
            "Watchdog started version={} target={} cwd={}",
            env!("CARGO_PKG_VERSION"),
            target.display(),
            std::env::current_dir()?.display()
        ),
    );
    let mut command = Command::new(target);
    command.args(args).arg(CHILD_ARG);
    command.stdin(Stdio::null()).stdout(Stdio::null());
    hide_console(&mut command);
    supervise(
        &mut command,
        std::path::Path::new("logs"),
        std::thread::sleep,
    )?;
    Ok(())
}

fn system_shutting_down() -> bool {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetSystemMetrics(index: i32) -> i32;
        }
        unsafe { GetSystemMetrics(0x2000) != 0 } // SM_SHUTTINGDOWN
    }
    #[cfg(not(windows))]
    {
        false
    }
}

struct StopFile(std::path::PathBuf);
impl Drop for StopFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn supervise(
    command: &mut Command,
    log_dir: &std::path::Path,
    mut sleep: impl FnMut(Duration),
) -> io::Result<()> {
    std::fs::create_dir_all(log_dir)?;
    let log = |message: String| append_diagnostic_at(log_dir, "watchdog.log", message);
    let mut failures: u32 = 0;
    let session = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut generation = 0_u64;
    loop {
        if system_shutting_down() {
            log("Windows is shutting down; watchdog stopped".into());
            return Ok(());
        }
        generation += 1;
        let stop_file = StopFile(std::path::absolute(log_dir)?.join(format!(
            "guard-stop-{}-{session}-{generation}",
            std::process::id()
        )));
        command.env(STOP_ENV, &stop_file.0);
        // Reopen after each exit so a removed/replaced diagnostic file is recreated.
        let stderr = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_dir.join("process-stderr.log"))?;
        command.stderr(Stdio::from(stderr));
        let started = Instant::now();
        let mut child_pid = 0;
        let result = command.spawn().and_then(|mut child| {
            child_pid = child.id();
            log(format!(
                "Started child pid={child_pid} generation={generation}"
            ));
            // Keep the handle on wait errors so a second application is never
            // spawned while the first might still be running.
            loop {
                match child.wait() {
                    Ok(status) => break Ok(status),
                    Err(error) => {
                        log(format!(
                            "Wait failed pid={child_pid}: {error}; retaining child handle"
                        ));
                        sleep(Duration::from_secs(1));
                    }
                }
            }
        });
        let user_stop = std::fs::read_to_string(&stop_file.0)
            .ok()
            .filter(|message| message.lines().next() == Some(child_pid.to_string().as_str()));
        drop(stop_file);
        if let Some(reason) = user_stop {
            log(format!(
                "Explicit user exit pid={child_pid} reason={}; watchdog stopped",
                reason.lines().nth(1).unwrap_or("unspecified")
            ));
            return Ok(());
        }
        match result {
            Ok(status) if status.code() == Some(RELAUNCH_EXIT_CODE) => {
                log("Application requested relaunch (code=75)".to_string());
                failures = 0;
                continue;
            }
            Ok(status) => log(format!(
                "Unexpected child exit pid={child_pid}: {status}, code={:?}, hex=0x{:08X}, uptime={}s; no user exit notification",
                status.code(), status.code().unwrap_or(-1) as u32,
                started.elapsed().as_secs()
            )),
            Err(error) => log(format!("Child launch/wait failed: {error}")),
        }
        if started.elapsed() >= Duration::from_secs(60) {
            failures = 0;
        }
        failures = failures.saturating_add(1);
        let delay = if failures == 1 {
            Duration::ZERO
        } else {
            retry_delay(failures - 1)
        };
        log(format!(
            "Restarting in {}s (failure {failures})",
            delay.as_secs()
        ));
        sleep(delay);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_are_bounded_and_resettable() {
        let delays: Vec<_> = (1..8).map(|n| retry_delay(n).as_secs()).collect();
        assert_eq!(delays, [3, 6, 12, 24, 48, 60, 60]);
        assert_eq!(retry_delay(u32::MAX).as_secs(), 60);
        assert_eq!(retry_delay(1).as_secs(), 3);
    }

    #[test]
    fn guard_lock_excludes_duplicates_and_releases_on_drop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("guard.lock");
        let lock = acquire_lock(&path).unwrap();
        assert_eq!(
            acquire_lock(&path).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        drop(lock);
        assert!(acquire_lock(&path).is_ok());
    }

    #[test]
    fn child_failure_relaunch_and_normal_exit() {
        let dir = tempfile::tempdir().unwrap();
        let count = dir.path().join("count");
        // The fixture is a real subprocess; it crashes, requests relaunch, then exits normally.
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "process_guard::tests::child_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("HVIDEO_GUARD_TEST_COUNT", &count)
            .current_dir(dir.path())
            .stdout(Stdio::null());
        let mut delays = Vec::new();
        supervise(&mut command, &dir.path().join("logs"), |delay| {
            delays.push(delay)
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(count).unwrap(), "3");
        assert_eq!(delays, [Duration::ZERO]);
        let crash = std::fs::read_to_string(dir.path().join("logs/crash.log")).unwrap();
        assert!(crash.contains("guard test panic"));
        assert!(crash.contains("process_guard.rs"));
    }

    #[test]
    #[ignore = "subprocess fixture used by child_failure_relaunch_and_normal_exit"]
    fn child_fixture() {
        let path = std::env::var_os("HVIDEO_GUARD_TEST_COUNT").expect("fixture only");
        let count = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0)
            + 1;
        std::fs::write(path, count.to_string()).unwrap();
        if count == 1 {
            install_panic_log();
            panic!("guard test panic");
        }
        if count == 3 {
            request_user_exit("test fixture user exit").unwrap();
        }
        std::process::exit(match count {
            2 => RELAUNCH_EXIT_CODE,
            _ => 0,
        });
    }
}
