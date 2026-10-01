//! Desktop language preference is independent of the random loopback origin.
use std::path::Path;
fn valid_language(language: &str) -> bool { matches!(language, "zh" | "id" | "vi" | "th" | "en") }
fn read_language(path: &Path) -> String {
    std::fs::read_to_string(path).ok().filter(|s| valid_language(s.trim())).map(|s| s.trim().to_string()).unwrap_or_else(|| "zh".into())
}
fn write_language(path: &Path, language: &str) -> Result<(), String> {
    if !valid_language(language) { return Err("Unsupported language".into()); }
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::write(path, language).map_err(|e| e.to_string())
}
fn preference_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path_resolver().app_config_dir().map(|p| p.join("admin-language.txt")).ok_or_else(|| "Application settings directory unavailable".into())
}
#[tauri::command]
pub fn get_admin_language(app: tauri::AppHandle) -> Result<String, String> { Ok(read_language(&preference_path(&app)?)) }
#[tauri::command]
pub fn set_admin_language(app: tauri::AppHandle, language: String) -> Result<(), String> { write_language(&preference_path(&app)?, &language) }
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preference_roundtrip_and_invalid_write_preserves_selection() {
        let path = std::env::temp_dir().join(format!("hvideo-language-{}-{}.txt",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        assert_eq!(read_language(&path), "zh");
        write_language(&path,"vi").unwrap();
        assert_eq!(read_language(&path), "vi");
        assert!(write_language(&path,"invalid").is_err());
        assert_eq!(read_language(&path), "vi");
        std::fs::write(&path,"corrupt").unwrap();
        assert_eq!(read_language(&path), "zh");
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn only_cashier_language_codes_are_accepted() {
        for code in ["zh", "id", "vi", "th", "en"] { assert!(valid_language(code)); }
        for code in ["", "EN", "../en", "fr"] { assert!(!valid_language(code)); }
    }
}
