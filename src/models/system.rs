use serde::Serialize;

#[derive(Serialize)]
pub struct SystemStatus {
    pub cpu_usage: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_usage_percent: f32,
    pub disks: Vec<DiskInfo>,
    pub load_average: Option<LoadAvg>,
    pub ws_count: usize,
}

#[derive(Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub total_space_gb: f64,
    pub used_space_gb: f64,
    pub available_space_gb: f64,
    pub usage_percent: f32,
}

#[derive(Serialize)]
pub struct LoadAvg {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}
