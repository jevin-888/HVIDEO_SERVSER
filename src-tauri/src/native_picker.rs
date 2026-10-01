//! System folder dialogs shared by every desktop directory entry point.
use std::path::{Path, PathBuf};
use tokio::sync::{oneshot, Mutex};

static PICKER_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectoryPurpose { CloudDownload, IdleSongs, MediaRoots, SongScan, SingerImages }

impl DirectoryPurpose {
    fn options(&self) -> (&'static str, bool) {
        match self {
            Self::CloudDownload => ("选择云端视频保存文件夹", false),
            Self::IdleSongs => ("选择空闲歌曲文件夹", false),
            Self::MediaRoots => ("选择媒体文件夹（可多选）", true),
            Self::SongScan => ("选择歌曲扫描文件夹（可多选）", true),
            Self::SingerImages => ("选择歌星图片文件夹", false),
        }
    }
}

fn existing_directory(initial: &str) -> Option<PathBuf> {
    let initial = initial.split(';').next().unwrap_or_default().trim();
    if initial.is_empty() { return None; }
    let mut path = PathBuf::from(initial);
    while !path.is_dir() {
        if !path.pop() { return None; }
    }
    Some(path)
}

fn selected_paths(paths: Option<Vec<PathBuf>>) -> Result<Option<Vec<String>>, String> {
    paths.map(|paths| paths.into_iter().map(|path| {
        // Backend multi-directory fields use semicolons as separators.
        let path = path.to_str().ok_or("文件夹路径包含无法识别的字符")?;
        if path.contains(';') { return Err("文件夹名称不能包含分号，请选择其他文件夹".into()); }
        if !Path::new(path).is_absolute() { return Err("请选择完整的文件夹路径".into()); }
        Ok(path.to_string())
    }).collect()).transpose()
}

#[tauri::command]
pub async fn select_directories(
    window: tauri::Window,
    purpose: DirectoryPurpose,
    initial_path: Option<String>,
) -> Result<Option<Vec<String>>, String> {
    if window.label() != "main" { return Err("请从管理端主窗口选择文件夹".into()); }
    let _guard = PICKER_LOCK.try_lock().map_err(|_| "文件夹选择窗口已打开，请先完成选择或取消")?;
    let (title, multiple) = purpose.options();
    let directory = existing_directory(initial_path.as_deref().unwrap_or_default());
    let (sender, receiver) = oneshot::channel();
    let parent = window.clone();
    window.run_on_main_thread(move || {
        let mut dialog = tauri::api::dialog::FileDialogBuilder::new().set_title(title).set_parent(&parent);
        if let Some(directory) = directory { dialog = dialog.set_directory(directory); }
        if multiple {
            dialog.pick_folders(move |paths| { let _ = sender.send(paths); });
        } else {
            dialog.pick_folder(move |path| { let _ = sender.send(path.map(|p| vec![p])); });
        }
    }).map_err(|e| format!("无法打开文件夹选择窗口：{e}"))?;
    selected_paths(receiver.await.map_err(|_| "文件夹选择窗口已关闭")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_contract_preserves_cancellation_unicode_and_multi_selection() {
        assert!(selected_paths(None).unwrap().is_none());
        #[cfg(windows)]
        {
            let paths = vec![PathBuf::from(r"D:\中文 视频"), PathBuf::from(r"E:\")];
            assert_eq!(selected_paths(Some(paths)).unwrap().unwrap(), vec![r"D:\中文 视频", r"E:\"]);
            assert!(selected_paths(Some(vec![PathBuf::from(r"D:\a;b")])).is_err());
        }
        assert!(selected_paths(Some(vec![PathBuf::from("relative")])).is_err());
        for (name,multiple) in [("cloudDownload",false),("idleSongs",false),("mediaRoots",true),("songScan",true),("singerImages",false)] {
            let purpose: DirectoryPurpose = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(purpose.options().1,multiple);
        }
        assert!(serde_json::from_str::<DirectoryPurpose>("\"unknown\"").is_err());
    }
    #[test]
    fn nonexistent_default_opens_existing_parent() {
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(existing_directory(cwd.join("__nonexistent_picker_folder__/child").to_str().unwrap()).unwrap(),cwd);
        assert_eq!(existing_directory(""),None);
    }
}
