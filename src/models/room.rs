use serde::{Deserialize, Deserializer, Serialize};

/// 房间数据模型
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub id: String,
    pub name: String,
    pub terminalId: String,
    // 废弃旧 room_type，改用 typeId
    pub typeId: Option<i32>,
    pub areaId: Option<i32>,
    pub status: i32,
    pub currentSongId: String,
    pub volume: i32,
    pub musicVolume: Option<i32>,
    pub micVolume: Option<i32>,
    pub micStatus: i32,
    // 外设状态字段
    #[serde(default = "default_ac_state")]
    pub acState: String,
    #[serde(default = "default_light_state")]
    pub lightState: String,
    #[serde(default = "default_effect_state")]
    pub effectState: String,
    #[serde(default)]
    pub muteStatus: i32,
    #[serde(default)]
    pub playState: i32,
    pub createdAt: String,
    pub updatedAt: String,
}

fn default_ac_state() -> String {
    r#"{"power":false,"temp":26,"mode":"auto","wind":"low"}"#.to_string()
}

fn default_light_state() -> String {
    r#"{"scene":"auto"}"#.to_string()
}

fn default_effect_state() -> String {
    r#"{"mode":"standard"}"#.to_string()
}

/// 房间类型
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RoomType {
    pub id: i32,
    pub name: String,
}

/// 房间区域
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RoomArea {
    pub id: i32,
    pub name: String,
}

/// 房间完整信息（包含终端IP等扩展字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomWithTerminalInfo {
    pub id: String,
    pub name: String,
    pub terminalId: String,
    pub typeId: Option<i32>,
    pub areaId: Option<i32>,
    pub status: i32,
    pub currentSongId: String,
    pub currentSongTitle: Option<String>, // 当前歌曲名
    pub volume: i32,
    pub musicVolume: Option<i32>,
    pub micVolume: Option<i32>,
    pub micStatus: i32,
    // 外设状态字段
    #[serde(default = "default_ac_state")]
    pub acState: String,
    #[serde(default = "default_light_state")]
    pub lightState: String,
    #[serde(default = "default_effect_state")]
    pub effectState: String,
    #[serde(default)]
    pub muteStatus: i32,
    #[serde(default)]
    pub playState: i32,
    pub createdAt: String,
    pub updatedAt: String,
    // 终端扩展信息
    pub roomIp: Option<String>,       // 房间IP=绑定客户机IP
    pub terminalName: Option<String>, // 终端名称
    pub terminalOnline: Option<i32>,  // 终端在线状态
}

/// 创建房间请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomRequest {
    pub name: String,
    pub terminalId: String,
    pub typeId: Option<i32>,
    pub areaId: Option<i32>,
}

fn deserialize_optional_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// 更新房间请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoomRequest {
    pub name: Option<String>,
    pub terminalId: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_nullable")]
    pub typeId: Option<Option<i32>>,
    #[serde(default, deserialize_with = "deserialize_optional_nullable")]
    pub areaId: Option<Option<i32>>,
    pub status: Option<i32>,
    pub volume: Option<i32>,
    pub musicVolume: Option<i32>,
    pub micVolume: Option<i32>,
    pub micStatus: Option<i32>,
    pub acState: Option<String>,
    pub lightState: Option<String>,
    pub effectState: Option<String>,
    pub muteStatus: Option<i32>,
    pub playState: Option<i32>,
}

/// 房间队列项（字段与当前 song.db 歌曲管理对齐）
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RoomQueueItem {
    #[serde(skip_serializing)]
    pub id: String,
    #[serde(skip_serializing)]
    pub roomId: String,
    pub songId: String,
    pub songName: String,
    pub singerNames: String,
    pub position: i32,
    pub status: i32,
    pub isPriority: i32,
    #[serde(skip_serializing)]
    pub addedAt: String,
    pub songNo: String,
    pub languageCode: String,
    pub categoryCode: String,
    pub light_code: String,
    pub relativePath: String,
    pub fileName: String,
    #[serde(skip_serializing)]
    pub video_file_type: String,
    pub track: i32,
    pub score_enabled: i32,
    pub primarySingerNo: String,
}

/// 点歌请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddToQueueRequest {
    #[serde(rename = "songNo")]
    pub songId: String,
    pub isPriority: Option<bool>,
}

/// 置顶请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrioritizeRequest {
    #[serde(rename = "songNo")]
    pub songId: String,
}

/// 房间控制命令
#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "action")]
#[serde(rename_all_fields = "camelCase")]
pub enum RoomCommand {
    /// 无操作
    None,
    /// 播放
    Play,
    /// 暂停
    Pause,
    /// 下一首
    NextSong,
    /// 切歌
    SkipSong,
    /// 重播当前歌曲
    Replay,
    /// 点歌
    #[serde(rename = "AddSong")]
    AddSong {
        songId: String,
    },
    /// 原唱/伴唱切换
    #[serde(rename = "SwitchTrack")]
    SwitchTrack {
        trackId: i32,
    },
    /// 调节音量
    #[serde(rename = "SetVolume")]
    SetVolume {
        volume: i32,
    },
    /// 麦克风开关
    SetMic {
        enabled: bool,
    },
    /// 麦克风开关
    MicOn,
    MicOff,
    /// 静音控制
    #[serde(rename = "Mute")]
    Mute,
    #[serde(rename = "Unmute")]
    Unmute,
    /// 清空队列
    ClearQueue,
    /// 空调控制
    SetAC {
        power: bool,
        temp: Option<i32>,
        mode: Option<String>,
        wind: Option<String>,
    },
    /// 灯光控制
    SetLight {
        scene: String,
    },
    /// 音效设置
    SetEffect {
        mode: String,
    },
    /// 氛围音效 (喝彩、鼓掌等)
    PlayAmbiance {
        effect: String,
    },
    /// 服务呼叫
    ServiceCall {
        callType: String,
    },
    /// 播放素材
    PlayMaterial {
        material_id: String,
    },
    /// 播放流媒体
    PlayStream {
        stream_id: String,
    },
    /// 直接播放 URL
    PlayUrl {
        url: String,
        title: Option<String>,
    },
    /// 停止流媒体
    StopStream,
}

/// 服务呼叫请求
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCallRequest {
    pub callType: String,
    /// 附加备注，如数量信息（"x3"）
    #[serde(default)]
    pub callNote: String,
}

/// 空调控制请求
#[derive(Debug, Serialize, Deserialize)]
pub struct ACControlRequest {
    pub power: bool,
    pub temp: Option<i32>,
    pub mode: Option<String>,
    pub wind: Option<String>,
}

/// 灯光控制请求
#[derive(Debug, Serialize, Deserialize)]
pub struct LightControlRequest {
    pub scene: String,
}

/// 音效控制请求
#[derive(Debug, Serialize, Deserialize)]
pub struct EffectControlRequest {
    pub mode: String,
}

/// 氛围音效请求
#[derive(Debug, Serialize, Deserialize)]
pub struct AmbianceRequest {
    pub effect: String,
}

/// 声音控制请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlVoiceRequest {
    pub volume: i32,            // 音乐音量 0-100
    pub micVolume: Option<i32>, // 麦克风音量 0-100（可选）
}

/// 按钮点击请求
#[derive(Debug, Deserialize)]
pub struct ControlButtonRequest {
    #[serde(rename = "buttonNameAlias")]
    pub buttonNameAlias: String,
}
