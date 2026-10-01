// 独立运行的二进制入口
// 直接调用库函数启动服务器

fn main() -> anyhow::Result<()> {
    hvideo_server::process_guard::install_panic_log();
    hvideo_server::process_guard::install_native_crash_handler();
    if !hvideo_server::process_guard::enter()? {
        return Ok(());
    }
    tokio::runtime::Runtime::new()?.block_on(hvideo_server::start_server_with_shutdown(
        None,
        async {
            match tokio::signal::ctrl_c().await {
                Ok(()) => {
                    if let Err(error) =
                        hvideo_server::process_guard::request_user_exit("console Ctrl+C")
                    {
                        hvideo_server::process_guard::append_diagnostic(
                            "watchdog.log",
                            format!("User exit notification failed: {error}"),
                        );
                    }
                }
                Err(error) => {
                    hvideo_server::process_guard::append_diagnostic(
                        "watchdog.log",
                        format!("Ctrl+C handler failed: {error}"),
                    );
                    std::future::pending::<()>().await;
                }
            }
        },
    ))
}
