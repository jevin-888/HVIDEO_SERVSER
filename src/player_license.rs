use serde::{Deserialize, Serialize};

/// Same field names and module IDs as license-tool's license.dat license object.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlayerLicense {
    pub modules: Vec<String>,
    pub enabled_layers: Vec<i32>,
    pub input_channel_count: u32,
    pub usage_mode: String,
}

impl PlayerLicense {
    pub fn validate(&self) -> Result<(), String> {
        const MODULES: &[&str] = &["TV", "投屏", "霸屏", "fusion", "effects"];
        const LAYERS: &[i32] = &[1, 2, 3, 4, 10, 11, 21, 30, 31, 40, 41, 50, 60, 70, 71];
        if self.enabled_layers.is_empty() {
            return Err("请至少选择一个授权图层".to_string());
        }
        for (index, layer) in self.enabled_layers.iter().enumerate() {
            if !LAYERS.contains(layer) || self.enabled_layers[..index].contains(layer) {
                return Err(format!("授权图层无效或重复: {layer}"));
            }
        }
        for (index, module) in self.modules.iter().enumerate() {
            if !MODULES.contains(&module.as_str()) || self.modules[..index].contains(module) {
                return Err(format!("授权模块无效或重复: {module}"));
            }
        }
        if self.input_channel_count > i32::MAX as u32 {
            return Err("授权输入通道数超出范围".to_string());
        }
        if !["buyout", "rent", "installment"].contains(&self.usage_mode.as_str()) {
            return Err("授权商业模式无效".to_string());
        }
        Ok(())
    }
}
