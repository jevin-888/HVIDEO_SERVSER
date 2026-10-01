//! One uploaded APK, one background job, explicit per-device ADB results.
use crate::{
    errors::{AppError, AppResult},
    models::terminal::Terminal,
};
use serde::Serialize;
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    process::Output,
    sync::OnceLock,
    time::Duration,
};
use tokio::{
    process::Command,
    sync::{Mutex, Semaphore},
};

pub const MAX_APK_SIZE: usize = 300 * 1024 * 1024;
pub static UPDATE_SLOT: Semaphore = Semaphore::const_new(1);
static TASKS: OnceLock<Mutex<VecDeque<AppUpdateTask>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateDevice {
    pub terminal_id: String,
    pub name: String,
    pub terminal_ip: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateTask {
    pub task_id: String,
    pub file_name: String,
    pub adb_port: u16,
    pub allow_downgrade: bool,
    pub status: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub devices: Vec<AppUpdateDevice>,
}

fn tasks() -> &'static Mutex<VecDeque<AppUpdateTask>> {
    TASKS.get_or_init(|| Mutex::new(VecDeque::new()))
}

pub async fn latest() -> Option<AppUpdateTask> {
    tasks().lock().await.back().cloned()
}

pub async fn get(id: &str) -> AppResult<AppUpdateTask> {
    tasks()
        .lock()
        .await
        .iter()
        .find(|task| task.task_id == id)
        .cloned()
        .ok_or_else(|| AppError::NotFound("安装任务不存在或服务器已重启".into()))
}

pub fn validate_apk(path: &Path) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "不是有效的 APK 文件".to_string())?;
    let manifest = zip
        .by_name("AndroidManifest.xml")
        .map_err(|_| "APK 缺少 AndroidManifest.xml，请选择完整 APK 安装包".to_string())?;
    if manifest.is_dir() || manifest.size() == 0 {
        return Err("APK 的 AndroidManifest.xml 无效".into());
    }
    Ok(())
}

pub fn adb_path() -> PathBuf {
    if let Some(path) = std::env::var_os("HVIDEO_ADB_PATH") {
        return path.into();
    }
    let name = if cfg!(windows) { "adb.exe" } else { "adb" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for path in [parent.join("tools").join(name), parent.join(name)] {
                if path.is_file() {
                    return path;
                }
            }
        }
    }
    PathBuf::from(name)
}

async fn command(adb: &Path, args: &[&str], timeout: u64) -> Result<Output, String> {
    let mut cmd = Command::new(adb);
    cmd.args(args).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    tokio::time::timeout(Duration::from_secs(timeout), cmd.output())
        .await
        .map_err(|_| "操作超时，安装结果未确认，请检查设备后再重试".to_string())?
        .map_err(|e| {
            format!(
                "无法运行 ADB，请在服务器安装 Android platform-tools 或设置 HVIDEO_ADB_PATH：{e}"
            )
        })
}

fn output_message(output: &Output) -> String {
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .trim()
    .chars()
    .take(2000)
    .collect()
}

pub async fn preflight(adb: &Path) -> AppResult<()> {
    let output = command(adb, &["version"], 10)
        .await
        .map_err(AppError::BadRequest)?;
    if !output.status.success() {
        return Err(AppError::BadRequest(format!(
            "ADB 不可用：{}",
            output_message(&output)
        )));
    }
    Ok(())
}

pub fn install_succeeded(output: &Output) -> bool {
    output.status.success()
        && String::from_utf8_lossy(&output.stdout)
            .lines()
            .any(|line| line.trim() == "Success")
}

fn install_failure(output: &Output, allow_downgrade: bool) -> String {
    let detail = output_message(output);
    if detail.contains("INSTALL_FAILED_VERSION_DOWNGRADE") {
        let reason = if allow_downgrade {
            "设备系统拒绝保留数据降级，请确认应用可调试或设备系统支持降级安装；未卸载应用"
        } else {
            "安装包版本低于设备当前版本，请勾选“允许降级安装”后重试"
        };
        format!("{reason}：{detail}")
    } else if detail.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
        format!("安装包与已安装应用签名不一致，无法覆盖安装；允许降级也不能绕过签名检查：{detail}")
    } else {
        format!("安装失败：{detail}")
    }
}

async fn set_device(id: &str, index: usize, status: &str, message: String) {
    if let Some(task) = tasks()
        .lock()
        .await
        .iter_mut()
        .find(|task| task.task_id == id)
    {
        task.devices[index].status = status.into();
        task.devices[index].message = message;
    }
}

async fn install(
    adb: &Path,
    address: &str,
    apk: &Path,
    task_id: &str,
    index: usize,
    allow_downgrade: bool,
) -> Result<(), String> {
    let connected = command(adb, &["connect", address], 20).await?;
    if !connected.status.success() {
        return Err(output_message(&connected));
    }
    let state = command(adb, &["-s", address, "get-state"], 15).await?;
    if !state.status.success() || String::from_utf8_lossy(&state.stdout).trim() != "device" {
        return Err(format!(
            "设备未连接或未授权，请检查网络 ADB：{}",
            output_message(&state)
        ));
    }
    set_device(task_id, index, "installing", "正在传输并安装 APK".into()).await;
    let apk = apk
        .to_str()
        .ok_or_else(|| "安装包路径编码无效".to_string())?;
    let mut args = vec!["-s", address, "install", "--no-streaming", "-r"];
    if allow_downgrade {
        args.push("-d");
    }
    args.push(apk);
    let output = command(adb, &args, 300).await?;
    if install_succeeded(&output) {
        Ok(())
    } else {
        Err(install_failure(&output, allow_downgrade))
    }
}

pub async fn start(
    terminals: Vec<Terminal>,
    file_name: String,
    adb_port: u16,
    allow_downgrade: bool,
    apk: tempfile::TempPath,
    adb: PathBuf,
    permit: tokio::sync::SemaphorePermit<'static>,
    db: sqlx::SqlitePool,
    actor: String,
) -> AppUpdateTask {
    let task = AppUpdateTask {
        task_id: uuid::Uuid::new_v4().to_string(),
        file_name,
        adb_port,
        allow_downgrade,
        status: "running".into(),
        created_at: chrono::Utc::now().timestamp_millis(),
        completed_at: None,
        devices: terminals
            .into_iter()
            .map(|t| AppUpdateDevice {
                terminal_id: t.id,
                name: t.name,
                terminal_ip: t.terminalIp,
                status: "queued".into(),
                message: "等待安装".into(),
            })
            .collect(),
    };
    {
        let mut tasks = tasks().lock().await;
        while tasks.len() >= 20 {
            tasks.pop_front();
        }
        tasks.push_back(task.clone());
    }
    let worker = task.clone();
    tokio::spawn(async move {
        let _permit = permit;
        for (index, device) in worker.devices.iter().enumerate() {
            set_device(&worker.task_id, index, "connecting", "正在连接设备".into()).await;
            let address = format!("{}:{}", device.terminal_ip, adb_port);
            let (status, message) = match install(
                &adb,
                &address,
                &apk,
                &worker.task_id,
                index,
                allow_downgrade,
            )
            .await
            {
                Ok(()) => ("succeeded", "安装成功".to_string()),
                Err(error) => ("failed", error),
            };
            set_device(&worker.task_id, index, status, message.clone()).await;
            let detail = format!(
                "{} → {} ({}, 允许降级={}): {}",
                worker.file_name, device.name, address, allow_downgrade, message
            );
            let _ = crate::services::activity_service::ActivityService::record(
                &db,
                &actor,
                "terminal_app_update",
                "terminal",
                &device.terminal_id,
                &detail,
                "",
            )
            .await;
        }
        // APK is private temporary data, removed on success and on failure.
        drop(apk);
        if let Some(task) = tasks()
            .lock()
            .await
            .iter_mut()
            .find(|task| task.task_id == worker.task_id)
        {
            task.status = "completed".into();
            task.completed_at = Some(chrono::Utc::now().timestamp_millis());
        }
    });
    task
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn apk_requires_manifest_not_just_a_zip_extension() {
        let file = tempfile::NamedTempFile::new().unwrap();
        assert!(validate_apk(file.path()).is_err());
        let mut zip = zip::ZipWriter::new(file.reopen().unwrap());
        zip.start_file("classes.dex", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"dex").unwrap();
        zip.finish().unwrap();
        assert!(validate_apk(file.path())
            .unwrap_err()
            .contains("AndroidManifest.xml"));
        let valid = tempfile::NamedTempFile::new().unwrap();
        let mut zip = zip::ZipWriter::new(valid.reopen().unwrap());
        zip.start_file(
            "AndroidManifest.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"manifest").unwrap();
        zip.finish().unwrap();
        assert!(validate_apk(valid.path()).is_ok());
    }

    #[test]
    fn successful_process_without_package_manager_success_is_not_install_success() {
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;
        let mut output = Output {
            status: std::process::ExitStatus::from_raw(0),
            stdout: b"Performing Streamed Install\n".to_vec(),
            stderr: vec![],
        };
        assert!(!install_succeeded(&output));
        output.stdout = b"Success\r\n".to_vec();
        assert!(install_succeeded(&output));
        output.status = std::process::ExitStatus::from_raw(1);
        assert!(!install_succeeded(&output));
    }

    #[tokio::test]
    async fn app_update_targets_only_selected_devices_continues_after_failure_and_cleans_apk() {
        // A local executable substitutes for ADB. No real device or ADB daemon is contacted.
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("mock_adb.rs");
        std::fs::write(&source, r#"
            use std::io::Write;
            fn main() {
                let args: Vec<String> = std::env::args().skip(1).collect();
                let log = std::env::current_exe().unwrap().with_extension("log");
                writeln!(std::fs::OpenOptions::new().create(true).append(true).open(log).unwrap(), "{}", args.join("|")).unwrap();
                if args == ["version"] { println!("Android Debug Bridge version mock"); return; }
                if args.len() == 2 && args[0] == "connect" { println!("connected"); return; }
                assert_eq!(args[0], "-s");
                if args[2] == "get-state" {
                    if args[1] == "192.0.2.12:5555" { eprintln!("unauthorized"); std::process::exit(1); }
                    println!("device"); return;
                }
                assert_eq!(&args[2..5], ["install", "--no-streaming", "-r"]);
                let downgrade = args.len() == 7;
                if downgrade { assert_eq!(args[5], "-d"); } else { assert_eq!(args.len(), 6); }
                assert!(std::path::Path::new(args.last().unwrap()).is_file());
                if args[1] == "192.0.2.10:5555" && downgrade { println!("Failure [INSTALL_FAILED_VERSION_DOWNGRADE]"); }
                else if args[1] == "192.0.2.10:5555" { println!("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"); }
                else { println!("Success"); }
            }
        "#).unwrap();
        let adb = temp.path().join(if cfg!(windows) {
            "mock_adb.exe"
        } else {
            "mock_adb"
        });
        let compilation = Command::new("rustc")
            .args(["--edition=2021", "--crate-name", "mock_adb"])
            .arg(source)
            .arg("-o")
            .arg(&adb)
            .output()
            .await
            .unwrap();
        assert!(
            compilation.status.success(),
            "{}",
            String::from_utf8_lossy(&compilation.stderr)
        );
        preflight(&adb).await.unwrap();
        let apk = tempfile::Builder::new()
            .suffix(".apk")
            .tempfile_in(temp.path())
            .unwrap()
            .into_temp_path();
        let apk_path = apk.to_path_buf();
        let terminals: Vec<Terminal> = (10..=12)
            .map(|n| Terminal {
                id: format!("t{n}"),
                name: format!("device{n}"),
                terminalIp: format!("192.0.2.{n}"),
                macAddress: String::new(),
                serial: String::new(),
                connections: Vec::new(),
                port: 5000,
                deviceType: "ktv".into(),
                roomId: String::new(),
                onlineStatus: 1,
                lastHeartbeat: String::new(),
                hardwareInfo: String::new(),
                softwareVer: String::new(),
                createdAt: String::new(),
                updatedAt: String::new(),
            })
            .collect();
        let db = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE operation_logs (id TEXT, clientId TEXT, action TEXT, targetType TEXT, targetId TEXT, detail TEXT, ipAddress TEXT)")
            .execute(&db).await.unwrap();
        let permit = UPDATE_SLOT.try_acquire().unwrap();
        assert!(UPDATE_SLOT.try_acquire().is_err());
        let task = start(
            terminals.clone(),
            "test.apk".into(),
            5555,
            false,
            apk,
            adb.clone(),
            permit,
            db.clone(),
            "admin".into(),
        )
        .await;
        let done = tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let task = get(&task.task_id).await.unwrap();
                if task.status == "completed" {
                    break task;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            done.devices
                .iter()
                .map(|d| d.status.as_str())
                .collect::<Vec<_>>(),
            ["failed", "succeeded", "failed"]
        );
        assert!(done.devices[0]
            .message
            .contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE"));
        assert!(done.devices[2].message.contains("unauthorized"));
        assert!(!apk_path.exists());
        assert!(UPDATE_SLOT.try_acquire().is_ok());
        assert_eq!(latest().await.unwrap().task_id, done.task_id);
        let audit_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM operation_logs")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(audit_count, 3);
        let log = std::fs::read_to_string(adb.with_extension("log")).unwrap();
        assert_eq!(
            log.lines()
                .filter(|line| line.starts_with("connect|"))
                .count(),
            3
        );
        assert_eq!(
            log.lines()
                .filter(|line| line.contains("|install|"))
                .count(),
            2
        );
        assert!(!log.contains("-s|192.0.2.12:5555|install"));
        assert!(!log.contains("|-d|"));
        assert!(!done.allow_downgrade);

        let apk = tempfile::Builder::new()
            .suffix(".apk")
            .tempfile_in(temp.path())
            .unwrap()
            .into_temp_path();
        let apk_path = apk.to_path_buf();
        let task = start(
            terminals,
            "old-version.apk".into(),
            5555,
            true,
            apk,
            adb.clone(),
            UPDATE_SLOT.try_acquire().unwrap(),
            db,
            "admin".into(),
        )
        .await;
        let done = tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let current = get(&task.task_id).await.unwrap();
                if current.status == "completed" {
                    break current;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap();
        assert!(done.allow_downgrade);
        assert_eq!(serde_json::to_value(&done).unwrap()["allowDowngrade"], true);
        assert_eq!(done.devices[0].status, "failed");
        assert!(done.devices[0].message.contains("设备系统拒绝保留数据降级"));
        assert_eq!(done.devices[1].status, "succeeded");
        assert!(!apk_path.exists());
        let log = std::fs::read_to_string(adb.with_extension("log")).unwrap();
        assert_eq!(
            log.lines()
                .filter(|line| line.contains("|install|--no-streaming|-r|-d|"))
                .count(),
            2
        );
        assert!(!log.contains("uninstall"));
    }
}
