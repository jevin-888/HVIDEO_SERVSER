use sqlx::sqlite::SqlitePool;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_url = "sqlite://song_db/song.db?mode=ro";
    let pool = SqlitePool::connect(database_url).await?;

    println!("--- Schema of hy_muc_song ---");
    let rows = sqlx::query("PRAGMA table_info(hy_muc_song)")
        .fetch_all(&pool)
        .await?;

    for row in rows {
        use sqlx::Row;
        let name: String = row.get("name");
        let type_: String = row.get("type");
        println!("Column: {} ({})", name, type_);
    }

    println!("\n--- Schema of hy_muc_dict ---");
    let rows = sqlx::query("PRAGMA table_info(hy_muc_dict)")
        .fetch_all(&pool)
        .await?;
    for row in rows {
        use sqlx::Row;
        let name: String = row.get("name");
        let type_: String = row.get("type");
        println!("Column: {} ({})", name, type_);
    }

    Ok(())
}
