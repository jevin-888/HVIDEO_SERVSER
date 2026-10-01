/// 进度报告模块
///
/// 通过 broadcast channel 向 WebSocket 客户端推送实时进度
use serde_json::json;
use tokio::sync::broadcast;

use crate::models::scan_task::{ScanProgress, ScanResult};

/// 进度报告器，封装 broadcast::Sender
pub struct ProgressReporter {
    sender: broadcast::Sender<String>,
}

impl ProgressReporter {
    /// 从已有的 broadcast::Sender 创建报告器
    pub fn new(sender: broadcast::Sender<String>) -> Self {
        Self { sender }
    }

    /// 推送进度更新
    pub fn report_progress(&self, progress: &ScanProgress) {
        let msg = json!({
            "type": "progress",
            "data": progress
        })
        .to_string();
        let _ = self.sender.send(msg);
    }

    /// 推送任务完成消息
    pub fn report_completion(&self, result: &ScanResult) {
        let msg = json!({
            "type": "completed",
            "data": result
        })
        .to_string();
        let _ = self.sender.send(msg);
    }

    /// 推送任务取消消息
    pub fn report_cancelled(&self) {
        let msg = json!({ "type": "cancelled" }).to_string();
        let _ = self.sender.send(msg);
    }

    /// 推送错误消息
    pub fn report_error(&self, error: &str, result: Option<&ScanResult>) {
        let msg = json!({
            "type": "error",
            "message": error,
            "data": result
        })
        .to_string();
        let _ = self.sender.send(msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::scan_task::{ScanProgress, ScanResult};

    fn make_reporter() -> (ProgressReporter, broadcast::Receiver<String>) {
        let (tx, rx) = broadcast::channel(16);
        (ProgressReporter::new(tx), rx)
    }

    #[test]
    fn test_report_progress_format() {
        let (reporter, mut rx) = make_reporter();
        let progress = ScanProgress {
            scanned_files: 10,
            matched_songs: 5,
            current_directory: "/music".to_string(),
            percentage: 50.0,
        };
        reporter.report_progress(&progress);
        let msg = rx.try_recv().unwrap();
        let v: serde_json::Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(v["type"], "progress");
        assert_eq!(v["data"]["scannedFiles"], 10);
        assert_eq!(v["data"]["percentage"], 50.0);
    }

    #[test]
    fn test_report_completion_format() {
        let (reporter, mut rx) = make_reporter();
        let result = ScanResult {
            total_files_scanned: 20,
            matched_count: 15,
            matched_records: vec![],
            unmatched_files: vec![],
            unrecognized_files: vec![],
            duplicate_files: vec![],
            errors: vec![],
        };
        reporter.report_completion(&result);
        let msg = rx.try_recv().unwrap();
        let v: serde_json::Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(v["type"], "completed");
        assert_eq!(v["data"]["totalFilesScanned"], 20);
    }

    #[test]
    fn test_report_cancelled_format() {
        let (reporter, mut rx) = make_reporter();
        reporter.report_cancelled();
        let msg = rx.try_recv().unwrap();
        let v: serde_json::Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(v["type"], "cancelled");
    }

    #[test]
    fn test_report_error_format() {
        let (reporter, mut rx) = make_reporter();
        let result = ScanResult {
            total_files_scanned: 2,
            matched_count: 0,
            matched_records: vec![],
            unmatched_files: vec![],
            unrecognized_files: vec![],
            duplicate_files: vec![],
            errors: vec![],
        };
        reporter.report_error("disk full", Some(&result));
        let msg = rx.try_recv().unwrap();
        let v: serde_json::Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["message"], "disk full");
        assert_eq!(v["data"]["totalFilesScanned"], 2);
    }

    #[test]
    fn test_no_receivers_does_not_panic() {
        let (tx, rx) = broadcast::channel::<String>(4);
        drop(rx);
        let reporter = ProgressReporter::new(tx);
        // 无接收者时不 panic
        reporter.report_cancelled();
    }
}
