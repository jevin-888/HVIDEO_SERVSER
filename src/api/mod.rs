pub mod activity_handler;
pub mod api_client_handler;
pub mod app_update_handler;
pub mod player_update_handler;
pub mod rom_update_handler;
pub mod artist_handler;
pub mod auth_handler;
pub mod billing_handler;
pub mod billing_settings_handler;
pub mod cashier_handler;
pub mod customer_handler;
pub mod cloud_handler;
pub mod dictionary_handler;
pub mod interaction_handler;
pub mod license_handler;
pub mod media_handler;
pub mod navigation_handler;
pub mod pad_ordering_handler;
pub mod peripheral_handler;
pub mod product_handler;
pub mod room_handler;
pub mod scan_handler;
pub mod song_db_handler;
pub mod song_handler;
pub mod system_handler;
pub mod terminal_config_handler;
pub mod terminal_handler;
pub mod timed_lyrics_handler;
pub mod warehouse_handler;
pub mod ws_handler;
pub mod youtube_handler;

use axum::{
    extract::DefaultBodyLimit,
    middleware,
    response::Redirect,
    routing::{delete, get, post, put},
    Router,
};
use tower_http::services::ServeDir;

use crate::middleware::{auth::auth_middleware, license::license_middleware};
use crate::AppState;

/// 构建所有 API 路由 - 统一认证版本
pub fn build_routes(state: AppState) -> Router {
    // 公开路由（无需认证）- 仅保留必要的公开接口
    let public_api = Router::new()
        .route("/api/v1/rom-updates/check", post(rom_update_handler::check))
        .route("/api/v1/rom-updates/files/:id/:resource", get(rom_update_handler::download))
        .route("/api/v1/rom-updates/report", post(rom_update_handler::report))
        .route("/api/v1/player-updates/check", post(player_update_handler::check))
        .route("/api/v1/player-updates/files/:hash", get(player_update_handler::download))
        .route("/health", get(health_check))
        .route("/api/v1/health", get(health_check))
        .route("/api/v1/license/status", get(license_handler::get_status))
        .route(
            "/api/v1/terminals/startup-config",
            get(terminal_config_handler::startup),
        )
        .route(
            "/api/v1/terminals/admission",
            post(terminal_handler::admit_terminal),
        )
        .route(
            "/api/v1/terminals/by-mac",
            get(terminal_handler::get_terminal_by_mac),
        )
        .route(
            "/api/v1/license/import",
            post(license_handler::import_license),
        )
        .route("/api/v1/auth/login", post(auth_handler::login))
        .route(
            "/api/v1/auth/employee/login",
            post(billing_handler::employee_login),
        )
        .route(
            "/api/v1/auth/employee/change-password",
            post(billing_handler::change_employee_password),
        )
        .route(
            "/api/v1/auth/waiter/login",
            post(cashier_handler::waiter_login),
        )
        // 互动平台 CORS 代理
        .route(
            "/api/v1/interaction/proxy/*path",
            get(interaction_handler::proxy_request)
                .post(interaction_handler::proxy_request)
                .put(interaction_handler::proxy_request)
                .delete(interaction_handler::proxy_request)
                .layer(DefaultBodyLimit::max(20 * 1024 * 1024)),
        )
        // WebSocket 路由
        .route("/ws", get(ws_handler::ws_upgrade_default))
        .route("/ws/:terminalId", get(ws_handler::ws_upgrade));

    // 终端公开路由（无需认证）- 终端/客户端直接访问的业务接口
    let terminal_routes = Router::new()
        .route(
            "/api/v1/terminals/pad-list",
            get(terminal_handler::list_pad_terminals),
        )
        // ===== 系统信息（终端需要）=====
        .route(
            "/api/v1/system/server-info",
            get(system_handler::server_info),
        )
        .route("/api/v1/system/dicts", get(system_handler::get_dicts))
        .route(
            "/api/v1/pad-ordering/status",
            get(pad_ordering_handler::get_status),
        )
        .route(
            "/api/v1/lyrics/timed",
            get(timed_lyrics_handler::get_timed_lyrics),
        )
        // ===== 外设预设（终端/客户端，公开接口）=====
        .route(
            "/api/v1/peripheral/presets",
            get(peripheral_handler::list_presets_public),
        )
        // ===== 歌曲/歌星查询（点歌客户端）=====
        .route("/api/v1/songs", get(song_handler::list_songs))
        .route("/api/v1/songs/:id", get(song_handler::get_song))
        .route("/api/v1/artists", get(artist_handler::list_artists))
        .route("/api/v1/artists/:id", get(artist_handler::get_artist))
        .route(
            "/api/v1/artists/:id/image",
            get(artist_handler::get_artist_image),
        )
        // ===== 房间查询（终端识别自身）=====
        .route(
            "/api/v1/rooms/by-terminal",
            get(room_handler::list_rooms_by_terminal),
        )
        .route("/api/v1/rooms/:id/state", get(room_handler::get_room_state))
        .route(
            "/api/v1/rooms/:id/config",
            get(room_handler::get_room_config).post(room_handler::set_room_config),
        )
        .route(
            "/api/v1/rooms/:id/settings",
            get(room_handler::get_room_settings),
        )
        // ===== 点歌队列管理 =====
        .route(
            "/api/v1/rooms/:id/queue",
            get(room_handler::get_queue).post(room_handler::add_to_queue),
        )
        .route(
            "/api/v1/rooms/:id/youtube/queue",
            post(youtube_handler::queue_video),
        )
        .route(
            "/api/v1/rooms/:id/queue/played",
            get(room_handler::get_played_queue),
        )
        .route(
            "/api/v1/rooms/:id/queue/:songId",
            delete(room_handler::delete_from_queue),
        )
        .route(
            "/api/v1/rooms/:id/queue/prioritize",
            post(room_handler::prioritize_song),
        )
        .route(
            "/api/v1/rooms/:id/queue/shuffle",
            post(room_handler::shuffle_queue),
        )
        .route("/api/v1/rooms/:id/next", post(room_handler::next_song))
        .route("/api/v1/rooms/:id/clear", post(room_handler::clear_queue))
        // ===== 播放控制 =====
        .route(
            "/api/v1/rooms/:id/command",
            post(room_handler::send_command),
        )
        .route("/api/v1/rooms/:id/play", post(room_handler::play))
        .route("/api/v1/rooms/:id/pause", post(room_handler::pause))
        .route("/api/v1/rooms/:id/replay", post(room_handler::replay))
        .route("/api/v1/rooms/:id/skip", post(room_handler::skip))
        .route("/api/v1/rooms/:id/volume", post(room_handler::set_volume))
        .route("/api/v1/rooms/:id/mic", post(room_handler::set_mic))
        .route("/api/v1/rooms/:id/track", post(room_handler::switch_track))
        // ===== 外设控制 =====
        .route(
            "/api/v1/rooms/:id/peripheral/ac",
            post(room_handler::control_ac),
        )
        .route(
            "/api/v1/rooms/:id/peripheral/light",
            post(room_handler::control_light),
        )
        .route(
            "/api/v1/rooms/:id/peripheral/effect",
            post(room_handler::control_effect),
        )
        .route(
            "/api/v1/rooms/:id/peripheral/ambiance",
            post(room_handler::play_ambiance),
        )
        .route(
            "/api/v1/rooms/:id/peripheral/call",
            post(room_handler::service_call),
        )
        .route(
            "/api/v1/rooms/:id/peripheral/voice",
            post(room_handler::control_voice),
        )
        .route(
            "/api/v1/rooms/:id/peripheral/button",
            post(room_handler::control_button),
        )
        // ===== 房务服务 =====
        .route(
            "/api/v1/rooms/:id/service/bell",
            post(cashier_handler::call_service),
        )
        .route(
            "/api/v1/rooms/:id/service/response",
            post(cashier_handler::response_service),
        )
        .route(
            "/api/v1/rooms/:id/service/cancel",
            post(cashier_handler::cancel_service),
        )
        .route(
            "/api/v1/rooms/:id/message",
            post(cashier_handler::send_message),
        )
        .route(
            "/api/v1/rooms/:id/control",
            post(cashier_handler::control_room),
        )
        // ===== 媒体文件列表 =====
        .route(
            "/api/v1/media/directories",
            get(system_handler::list_media_directories),
        )
        .route("/api/v1/media/files", get(system_handler::list_media_files))
        .route(
            "/api/v1/idle-media/scan",
            get(system_handler::scan_idle_media),
        )
        // ===== 媒体资源 =====
        .route("/api/v1/materials", get(media_handler::list_materials))
        .route(
            "/api/v1/materials/categories",
            get(media_handler::list_material_categories),
        )
        .route("/api/v1/streams", get(media_handler::list_streams))
        .route("/api/v1/streams/status", get(media_handler::stream_status))
        .route(
            "/api/v1/streams/refresh",
            post(media_handler::refresh_streams),
        )
        .route(
            "/api/v1/rooms/:id/materials/play",
            post(media_handler::play_material),
        )
        .route(
            "/api/v1/rooms/:id/streams/play",
            post(media_handler::play_stream),
        )
        .route(
            "/api/v1/rooms/:id/streams/stop",
            post(media_handler::stop_stream),
        )
        // ===== 导航配置 =====
        .route(
            "/api/v1/navigation/smartl/status",
            get(navigation_handler::get_smartl_status),
        )
        .route(
            "/api/v1/navigation/smartl",
            get(navigation_handler::get_smartl),
        )
        .route(
            "/api/v1/navigation/bottom/current",
            get(navigation_handler::get_bottom_nav_current),
        )
        .route(
            "/api/v1/navigation/bottom",
            get(navigation_handler::get_bottom_nav),
        )
        .route(
            "/api/v1/display/layout",
            get(navigation_handler::get_display_layout),
        )
        .route(
            "/api/v1/display/status",
            get(navigation_handler::get_display_status),
        )
        // ===== 商品与订单 =====
        .route("/api/v1/products", get(product_handler::list_products))
        .route(
            "/api/v1/products/categories",
            get(product_handler::list_categories),
        )
        .route(
            "/api/v1/products/categories/free",
            get(cashier_handler::list_free_categories),
        )
        .route("/api/v1/products/combos", get(cashier_handler::list_combos))
        .route(
            "/api/v1/products/combos/:id/items",
            get(cashier_handler::get_combo_items),
        )
        .route("/api/v1/products/tastes", get(cashier_handler::list_tastes))
        .route("/api/v1/orders", post(product_handler::create_order))
        .route("/api/v1/orders/bill", get(cashier_handler::get_bill))
        .route(
            "/api/v1/orders/items",
            get(cashier_handler::list_room_ordered_items),
        )
        .route(
            "/api/v1/orders/:id/detail",
            get(cashier_handler::get_order_detail),
        )
        .route("/api/v1/orders/qrcode", get(cashier_handler::get_qrcode))
        // ===== 房间计费与收银结算 =====
        .route(
            "/api/v1/billing/sessions/open",
            post(billing_handler::open_session),
        )
        .route(
            "/api/v1/billing/sessions/:id/close",
            post(billing_handler::close_session),
        )
        .route(
            "/api/v1/billing/sessions/:id/transfer",
            post(billing_handler::transfer_session),
        )
        .route(
            "/api/v1/billing/sessions/:id/pay",
            post(billing_handler::pay_session),
        )
        .route(
            "/api/v1/billing/sessions/:id/discount",
            post(billing_handler::apply_discount),
        )
        .route(
            "/api/v1/billing/sessions/:id/free",
            post(billing_handler::free_bill),
        )
        .route(
            "/api/v1/billing/sessions/:id/rounding",
            post(billing_handler::apply_rounding),
        )
        .route(
            "/api/v1/billing/sessions/:id/credit",
            post(billing_handler::credit_bill),
        )
        .route(
            "/api/v1/billing/room-bill",
            get(billing_handler::get_room_bill),
        )
        .route(
            "/api/v1/billing/price-preview",
            get(billing_handler::preview_billing_price),
        )
        // ===== 营销广告 =====
        .route("/api/v1/marketing/ads", get(cashier_handler::list_ads))
        // ===== 公关服务 =====
        .route("/api/v1/pr/staff", get(cashier_handler::list_pr_staff))
        .route("/api/v1/pr/groups", get(cashier_handler::list_pr_groups))
        .route(
            "/api/v1/pr/groups/stats",
            get(cashier_handler::get_pr_group_stats),
        )
        .route("/api/v1/pr/records", get(activity_handler::list_activities)) // 修复可能的引用
        .route("/api/v1/pr/flowers", get(cashier_handler::list_pr_flowers))
        .route(
            "/api/v1/pr/service",
            post(cashier_handler::pr_service_action),
        )
        .route("/api/v1/pr/orders", post(cashier_handler::create_pr_order))
        // ===== 歌曲库查询 (song.db) =====
        .route("/api/v1/songdb/warmup", get(song_db_handler::warmup))
        .route("/api/v1/songdb/songs", get(song_db_handler::search_songs))
        .route("/api/v1/songdb/songs/:id", get(song_db_handler::get_song))
        .route(
            "/api/v1/songdb/singers",
            get(song_db_handler::search_singers),
        )
        .route(
            "/api/v1/songdb/singers/:id",
            get(song_db_handler::get_singer),
        )
        .route(
            "/api/v1/songdb/singers/:id/songs",
            get(song_db_handler::get_singer_songs),
        )
        .route(
            "/api/v1/songdb/singers/:id/image",
            post(song_db_handler::upload_singer_image),
        )
        .route(
            "/api/v1/songdb/dict/:group",
            get(dictionary_handler::get_group),
        )
        .route("/api/v1/songdb/stats", get(song_db_handler::get_stats))
        // ===== 服务类型（终端展示用）=====
        .route(
            "/api/v1/service-types",
            get(cashier_handler::list_service_types_public),
        )
        // ===== YouTube 解析 (公开接口) =====
        .route("/api/v1/youtube/search", get(youtube_handler::search_video))
        .route("/api/v1/youtube/hot", get(youtube_handler::hot_videos))
        .route("/api/v1/youtube/parse", get(youtube_handler::parse_video))
        .route("/api/v1/youtube/stream", get(youtube_handler::proxy_stream))
        .route("/proxy/image", get(youtube_handler::proxy_image));

    // 受保护路由（需要 JWT 认证）- 仅管理端操作
    let protected_routes = Router::new()
        // ===== 系统信息（管理端）=====
        .route("/api/v1/system/status", get(system_handler::system_status))
        .route(
            "/api/v1/system/available-disks",
            get(system_handler::list_available_disks),
        )
        .route("/api/v1/system/logs", get(system_handler::log_stream))
        .route(
            "/api/v1/system/connections",
            get(ws_handler::list_connections),
        )
        .route(
            "/api/v1/system/room-client-connections",
            get(ws_handler::list_room_client_connections),
        )
        .route(
            "/api/v1/system/settings/:key",
            get(system_handler::get_setting).put(system_handler::update_setting),
        )
        .route(
            "/api/v1/system/server-network",
            put(system_handler::update_server_network),
        )
        // ===== 歌曲/歌星管理（管理端写操作）=====
        .route("/api/v1/songs", post(song_handler::create_song))
        .route(
            "/api/v1/songs/:id",
            put(song_handler::update_song).delete(song_handler::delete_song),
        )
        .route("/api/v1/artists", post(artist_handler::create_artist))
        .route(
            "/api/v1/artists/:id",
            put(artist_handler::update_artist).delete(artist_handler::delete_artist),
        )
        // ===== 房间配置管理 =====
        .route(
            "/api/v1/rooms/configs/types",
            get(room_handler::list_types).post(room_handler::create_type),
        )
        .route(
            "/api/v1/rooms/configs/types/:id",
            delete(room_handler::delete_type),
        )
        .route(
            "/api/v1/rooms/configs/areas",
            get(room_handler::list_areas).post(room_handler::create_area),
        )
        .route(
            "/api/v1/rooms/configs/areas/:id",
            delete(room_handler::delete_area),
        )
        // ===== 房间 CRUD（管理端）=====
        .route(
            "/api/v1/rooms",
            get(room_handler::list_rooms).post(room_handler::create_room),
        )
        .route(
            "/api/v1/rooms/:id",
            get(room_handler::get_room)
                .put(room_handler::update_room)
                .delete(room_handler::delete_room),
        )
        // ===== 导航配置（管理端写操作）=====
        .route(
            "/api/v1/navigation/bottom/:id",
            put(navigation_handler::update_bottom_nav_item),
        )
        .route(
            "/api/v1/display/layout",
            post(navigation_handler::set_display_layout),
        )
        .route(
            "/api/v1/display/status",
            put(navigation_handler::update_display_status),
        )
        // ===== 终端管理 =====
        .route("/api/v1/rom-updates/releases", get(rom_update_handler::list))
        .route("/api/v1/rom-updates/releases/:id/publication", put(rom_update_handler::publish))
        .route(
            "/api/v1/terminals/app-updates",
            post(app_update_handler::start_update).layer(DefaultBodyLimit::max(301 * 1024 * 1024)),
        )
        .route(
            "/api/v1/terminals/app-updates/latest",
            get(app_update_handler::latest_update),
        )
        .route(
            "/api/v1/terminals/app-updates/:taskId",
            get(app_update_handler::get_update),
        )
        .route("/api/v1/terminals", get(terminal_handler::list_terminals))
        .route(
            "/api/v1/terminals/config-profiles",
            get(terminal_config_handler::list),
        )
        .route(
            "/api/v1/terminals/:id/config-profile",
            post(terminal_config_handler::capture),
        )
        .route(
            "/api/v1/terminals/register",
            post(terminal_handler::register_terminal),
        )
        .route(
            "/api/v1/terminals/discover",
            post(terminal_handler::discover_terminals),
        )
        .route(
            "/api/v1/terminals/:id",
            get(terminal_handler::get_terminal)
                .put(terminal_handler::update_terminal)
                .delete(terminal_handler::delete_terminal),
        )
        .route(
            "/api/v1/terminals/:id/rooms",
            get(terminal_handler::get_terminal_rooms),
        )
        // ===== 云端同步 =====
        .route("/api/v1/cloud/config", get(cloud_handler::get_config).put(cloud_handler::update_config))
        .route("/api/v1/cloud/status", get(cloud_handler::get_status))
        .route("/api/v1/cloud/updates", post(cloud_handler::start_updates))
        .route("/api/v1/cloud/import", post(cloud_handler::batch_import))
        .route("/api/v1/cloud/tasks", get(cloud_handler::list_tasks))
        .route("/api/v1/cloud/update-history", get(cloud_handler::update_history))
        .route("/api/v1/cloud/update-history/:id/songs", get(cloud_handler::update_history_songs))
        .route(
            "/api/v1/cloud/download/:id",
            post(cloud_handler::trigger_download),
        )
        // ===== API 客户端管理 =====
        .route(
            "/api/v1/clients",
            get(api_client_handler::list_clients).post(api_client_handler::create_client),
        )
        .route(
            "/api/v1/clients/:id",
            put(api_client_handler::update_client).delete(api_client_handler::delete_client),
        )
        // ===== 歌曲库管理（管理端写操作）=====
        .route("/api/v1/songdb/songs", post(song_db_handler::create_song))
        .route(
            "/api/v1/songdb/songs/:id",
            put(song_db_handler::update_song).delete(song_db_handler::delete_song),
        )
        .route(
            "/api/v1/songdb/singers",
            post(song_db_handler::create_singer),
        )
        .route(
            "/api/v1/songdb/singers/:id",
            put(song_db_handler::update_singer).delete(song_db_handler::delete_singer),
        )
        .route(
            "/api/v1/songdb/dict/:group",
            put(dictionary_handler::upsert),
        )
        .route(
            "/api/v1/songdb/dict/:group/:code",
            delete(dictionary_handler::delete),
        )
        .route("/api/v1/songdb/dicts", get(dictionary_handler::list))
        .route(
            "/api/v1/songdb/dicts/export",
            get(dictionary_handler::export),
        )
        .route(
            "/api/v1/songdb/dicts/import",
            post(dictionary_handler::import).layer(DefaultBodyLimit::max(
                crate::services::dictionary_xlsx::MAX_XLSX_SIZE + 64 * 1024,
            )),
        )
        // ===== 整理歌曲数据导入 =====
        .route(
            "/api/v1/songdb/import",
            post(song_db_handler::import_song_catalog)
                .layer(DefaultBodyLimit::max(512 * 1024 * 1024)),
        )
        .route(
            "/api/v1/songdb/import/active",
            get(song_db_handler::get_active_song_import),
        )
        .route(
            "/api/v1/songdb/import/tasks/:task_id",
            get(song_db_handler::get_song_import_task),
        )
        // ===== 歌星数据导入与图片对照 =====
        .route(
            "/api/v1/songdb/singers/import",
            post(song_db_handler::import_singer_catalog)
                .layer(DefaultBodyLimit::max(512 * 1024 * 1024)),
        )
        .route(
            "/api/v1/songdb/singers/import/active",
            get(song_db_handler::get_active_singer_import),
        )
        .route(
            "/api/v1/songdb/singers/import/tasks/:task_id",
            get(song_db_handler::get_singer_import_task),
        )
        .route(
            "/api/v1/songdb/singers/image-match/start",
            post(song_db_handler::start_singer_image_match),
        )
        .route(
            "/api/v1/songdb/singers/image-match/progress/:task_id",
            get(song_db_handler::get_singer_image_match_progress),
        )
        .route(
            "/api/v1/songdb/singers/image-match/result/:task_id",
            get(song_db_handler::get_singer_image_match_result),
        )
        .route(
            "/api/v1/songdb/singers/image-match/cancel/:task_id",
            post(song_db_handler::cancel_singer_image_match),
        )
        // ===== 歌曲路径扫描 =====
        .route("/ws/scan/:task_id", get(ws_handler::ws_scan_progress))
        .route("/api/v1/songdb/scan/fs", get(scan_handler::list_fs))
        .route("/api/v1/songdb/scan/start", post(scan_handler::start_scan))
        .route(
            "/api/v1/songdb/scan/progress/:task_id",
            get(scan_handler::get_progress),
        )
        .route(
            "/api/v1/songdb/scan/result/:task_id",
            get(scan_handler::get_result),
        )
        .route(
            "/api/v1/songdb/scan/cancel/:task_id",
            post(scan_handler::cancel_task),
        )
        // ===== 活动日志 =====
        .route(
            "/api/v1/activities",
            get(activity_handler::list_activities).delete(activity_handler::clear_activities),
        )
        // ===== 中控配置（管理端）=====
        .route(
            "/api/v1/admin/peripherals",
            get(peripheral_handler::list_peripheral_states),
        )
        .route(
            "/api/v1/admin/peripherals/batch/light",
            post(peripheral_handler::batch_set_light),
        )
        .route(
            "/api/v1/admin/peripherals/batch/ac",
            post(peripheral_handler::batch_set_ac),
        )
        .route(
            "/api/v1/admin/peripherals/:roomId",
            get(peripheral_handler::get_peripheral_state),
        )
        .route(
            "/api/v1/admin/peripherals/:roomId/light",
            put(peripheral_handler::set_room_light),
        )
        .route(
            "/api/v1/admin/peripherals/:roomId/ac",
            put(peripheral_handler::set_room_ac),
        )
        .route(
            "/api/v1/admin/peripherals/:roomId/effect",
            put(peripheral_handler::set_room_effect),
        )
        .route(
            "/api/v1/admin/peripheral-presets",
            get(peripheral_handler::list_presets).post(peripheral_handler::create_preset),
        )
        .route(
            "/api/v1/admin/peripheral-presets/:id",
            put(peripheral_handler::update_preset).delete(peripheral_handler::delete_preset),
        )
        // ===== 服务铃管理（管理端）=====
        .route(
            "/api/v1/admin/service-calls",
            get(room_handler::list_service_calls),
        )
        .route(
            "/api/v1/admin/service-calls/:id/complete",
            put(room_handler::complete_service_call),
        )
        // ===== 服务类型管理 =====
        .route(
            "/api/v1/admin/service-types",
            get(cashier_handler::list_service_types).post(cashier_handler::create_service_type),
        )
        .route(
            "/api/v1/admin/service-types/:id",
            put(cashier_handler::update_service_type).delete(cashier_handler::delete_service_type),
        )
        // ===== 收银管理：员工、财务、交班、打印 =====
        .route("/api/v1/admin/members", get(customer_handler::list_members).post(customer_handler::create_member))
        .route("/api/v1/admin/members/:id", put(customer_handler::update_member).delete(customer_handler::delete_member))
        .route("/api/v1/admin/members/:id/balance", post(customer_handler::member_balance))
        .route("/api/v1/admin/reservations", get(customer_handler::list_reservations).post(customer_handler::create_reservation))
        .route("/api/v1/admin/reservations/:id", put(customer_handler::update_reservation).delete(customer_handler::cancel_reservation))
        .route("/api/v1/admin/reservations/:id/opened", post(customer_handler::open_reservation))
        .route(
            "/api/v1/admin/employees",
            get(billing_handler::list_employees).post(billing_handler::create_employee),
        )
        .route(
            "/api/v1/admin/employees/next-number",
            get(billing_handler::next_employee_number),
        )
        .route(
            "/api/v1/admin/employees/:id",
            put(billing_handler::update_employee).delete(billing_handler::delete_employee),
        )
        .route(
            "/api/v1/admin/employee-roles",
            get(billing_handler::list_employee_roles),
        )
        .route(
            "/api/v1/admin/finance/report",
            get(billing_handler::finance_report),
        )
        .route(
            "/api/v1/admin/finance/sessions/:id/details",
            get(billing_handler::finance_session_details),
        )
        .route(
            "/api/v1/admin/pad-ordering/status",
            get(pad_ordering_handler::get_status).put(pad_ordering_handler::update_status),
        )
        .route(
            "/api/v1/admin/billing-settings",
            get(billing_settings_handler::list_billing_base_settings),
        )
        .route(
            "/api/v1/admin/billing-settings/:key",
            get(billing_settings_handler::get_billing_base_setting)
                .put(billing_settings_handler::update_billing_base_setting),
        )
        .route(
            "/api/v1/admin/shifts/report",
            post(billing_handler::create_shift_report),
        )
        .route(
            "/api/v1/admin/printers",
            get(billing_handler::list_printers).post(billing_handler::create_printer),
        )
        .route(
            "/api/v1/admin/printers/:id",
            put(billing_handler::update_printer).delete(billing_handler::delete_printer),
        )
        .route(
            "/api/v1/admin/orders/:id/print",
            post(billing_handler::print_order),
        )
        // ===== 库存管理管理 =====
        .route(
            "/api/v1/admin/warehouse/categories",
            get(warehouse_handler::list_warehouse_categories)
                .post(warehouse_handler::create_warehouse_category),
        )
        .route(
            "/api/v1/admin/warehouse/categories/:id",
            delete(warehouse_handler::delete_warehouse_category),
        )
        .route(
            "/api/v1/admin/warehouse/locations",
            get(warehouse_handler::list_warehouse_locations)
                .post(warehouse_handler::create_warehouse_location),
        )
        .route(
            "/api/v1/admin/warehouse/locations/:id",
            delete(warehouse_handler::delete_warehouse_location),
        )
        .route(
            "/api/v1/admin/warehouse/products",
            post(warehouse_handler::create_warehouse_product),
        )
        .route(
            "/api/v1/admin/warehouse/products/:id",
            delete(warehouse_handler::delete_warehouse_product),
        )
        .route(
            "/api/v1/admin/warehouse/inventory",
            get(warehouse_handler::list_inventory),
        )
        .route(
            "/api/v1/admin/warehouse/transactions",
            get(warehouse_handler::list_transactions),
        )
        .route(
            "/api/v1/admin/warehouse/products/:id/in",
            post(warehouse_handler::stock_in),
        )
        .route(
            "/api/v1/admin/warehouse/products/:id/out",
            post(warehouse_handler::stock_out),
        )
        .route(
            "/api/v1/admin/warehouse/products/:id/adjust",
            post(warehouse_handler::adjust_stock),
        )
        // 挂载认证中间件
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    // 首页自动跳转到后台管理
    Router::new()
        .route(
            "/",
            get(|| async { Redirect::permanent("/static/admin/index.html") }),
        )
        .merge(public_api)
        .merge(terminal_routes)
        .merge(protected_routes)
        // 静态文件服务
        .nest_service("/static", ServeDir::new("static"))
        // 兜底路由（处理 /YN-song/* 等媒体文件请求）
        .fallback(system_handler::serve_media_file)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            license_middleware,
        ))
        .with_state(state)
}

/// 健康检查
async fn health_check() -> &'static str {
    "OK"
}
