use std::collections::HashSet;

use sqlx::{Row, SqliteConnection, SqlitePool};
use tokio::sync::OnceCell;

use crate::errors::{AppError, AppResult};
use crate::models::common::PagedResponse;
use crate::models::song_db_models::*;
use crate::utils::media_path;

pub struct SongDbService;

#[cfg(test)]
mod song_number_prefix_tests {
    use super::*;
    use crate::models::common::ApiResponse;
    use axum::extract::Query;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn database() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(
            "INSERT INTO songs(songNo, songName, initialKey, languageCode, clickTime) VALUES
                ('YN001', 'Lagu Alpha', 'LA', 'id', 100),
                ('YN002', 'Lagu Beta', 'LB', 'en', 90),
                ('YN003', 'Bintang', 'BT', 'zh', 80),
                ('CN001', 'Lagu Gamma', 'LG', 'id', 70),
                ('XYN004', 'Lagu Delta', 'LD', 'id', 60),
                ('YN004', 'Lagu Epsilon', 'LE', 'ja', 50),
                ('yn005', 'Lagu Lowercase', 'LL', 'id', 40),
                ('YN_%006', 'Lagu Literal', 'LL', 'en', 30);
            INSERT INTO songSearch(songNo, songName, nameKey, initialKey)
                SELECT songNo, songName, songName, initialKey FROM songs;",
        )
        .execute(&pool)
        .await
        .unwrap();
        SongDbService::ensure_local_available_table(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO local_available_songs(songNo, absolutePath)
                SELECT songNo, '' FROM songs WHERE songNo <> 'YN004'",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn search(pool: &SqlitePool, query: &str) -> PagedResponse<SongEntry> {
        let uri = format!("/api/v1/songdb/songs?{query}").parse().unwrap();
        let Query(query) = Query::<SongSearchQuery>::try_from_uri(&uri).unwrap();
        SongDbService::search_songs(pool, query).await.unwrap()
    }

    fn song_nos(result: &PagedResponse<SongEntry>) -> Vec<&str> {
        result
            .items
            .iter()
            .map(|song| song.songNo.as_deref().unwrap())
            .collect()
    }

    #[tokio::test]
    async fn keyword_matches_numbers_and_numeric_titles_with_filters() {
        let pool = database().await;
        sqlx::raw_sql("INSERT INTO songs(songNo,songName,initialKey,languageCode,clickTime) VALUES ('80000101','New Song','NS','en',10),('80000102','Missing','M','en',50),('NUMTITLE','8000 Miles','BM','en',5); INSERT INTO songSearch(songNo,songName,nameKey,initialKey) SELECT songNo,songName,songName,initialKey FROM songs WHERE songNo IN ('80000101','80000102','NUMTITLE'); INSERT INTO local_available_songs(songNo,absolutePath) VALUES ('80000101',''),('NUMTITLE','');")
            .execute(&pool).await.unwrap();
        for indexed in [true,false] {
            if !indexed { sqlx::query("DROP TABLE songSearch").execute(&pool).await.unwrap(); }
            assert_eq!(song_nos(&search(&pool,"keyword=80000101").await),["80000101"]);
            assert_eq!(song_nos(&search(&pool,"keyword=8000").await),["80000101","NUMTITLE"]);
            assert_eq!(song_nos(&search(&pool,"keyword=8000&searchMode=initial").await),["80000101"]);
            assert_eq!(search(&pool,"keyword=8000&languageCode=zh").await.total,0);
            assert_eq!(search(&pool,"keyword=8000&availableOnly=false").await.total,3);
        }
    }

    #[tokio::test]
    async fn new_songs_include_recent_cloud_videos_preserving_original_categories() {
        let pool=database().await;
        let now=chrono::Utc::now().timestamp_millis();
        sqlx::query("INSERT INTO songBatches(batchId,batchName,batchType,createdTime) VALUES ('recent','recent','cloudVod',?),('old','old','cloudVod',1),('catalog','catalog','xlsxCatalog',?)")
            .bind(now).bind(now).execute(&pool).await.unwrap();
        sqlx::raw_sql("UPDATE songs SET categoryCode='16'; UPDATE songs SET addedBatchId='recent',addedTime=500 WHERE songNo IN ('YN001','YN004'); UPDATE songs SET addedBatchId='old' WHERE songNo='YN002'; UPDATE songs SET addedBatchId='catalog' WHERE songNo='YN003'; UPDATE songs SET categoryCode='1',addedTime=1 WHERE songNo='CN001';")
            .execute(&pool).await.unwrap();
        let new=search(&pool,"categoryCode=1").await;
        assert_eq!(song_nos(&new),["YN001","CN001"]);
        assert_eq!(new.items[0].categoryCode.as_deref(),Some("16"));
        assert_eq!(search(&pool,"categoryCode=1&availableOnly=false").await.total,3);
        assert_eq!(search(&pool,"categoryCode=1&songNoPrefix=YN&keyword=Lagu").await.total,1);
        assert!(song_nos(&search(&pool,"categoryCode=16").await).contains(&"YN001"));
    }

    #[tokio::test]
    async fn prefix_lists_all_languages_with_consistent_totals_and_pages() {
        let pool = database().await;
        let first = search(&pool, "songNoPrefix=YN&page=1&pageSize=2").await;
        assert_eq!(song_nos(&first), ["YN001", "YN002"]);
        assert_eq!((first.total, first.page, first.page_size), (4, 1, 2));

        let second = search(&pool, "songNoPrefix=YN&page=2&pageSize=2").await;
        assert_eq!(song_nos(&second), ["YN003", "YN_%006"]);
        assert_eq!((second.total, second.page, second.page_size), (4, 2, 2));
        let last = search(&pool, "songNoPrefix=YN&page=3&pageSize=2").await;
        assert!(last.items.is_empty());
        assert_eq!(last.total, 4);

        let indonesian = search(&pool, "songNoPrefix=YN&languageCode=id").await;
        assert_eq!(song_nos(&indonesian), ["YN001"]);
        assert_eq!(indonesian.total, 1);

        let payload = serde_json::to_value(ApiResponse::success(first)).unwrap();
        assert_eq!(payload["code"], 0);
        assert_eq!(payload["message"], "success");
        assert_eq!(payload["data"]["total"], 4);
        assert_eq!(payload["data"]["page"], 1);
        assert_eq!(payload["data"]["pageSize"], 2);
        assert_eq!(payload["data"]["items"].as_array().unwrap().len(), 2);
        assert_eq!(payload.as_object().unwrap().len(), 3);
        assert_eq!(payload["data"].as_object().unwrap().len(), 4);
    }

    #[tokio::test]
    async fn prefix_constrains_full_name_and_initial_searches_and_sql_fallback() {
        let pool = database().await;
        for indexed in [true, false] {
            if !indexed {
                sqlx::query("DROP TABLE songSearch")
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            for query in [
                "songNoPrefix=YN&keyword=Lagu&searchMode=fullName",
                "songNoPrefix=YN&keyword=l&searchMode=initial",
            ] {
                let result = search(&pool, query).await;
                assert_eq!(song_nos(&result), ["YN001", "YN002", "YN_%006"]);
                assert_eq!(result.total, 3);
            }
            let result = search(&pool, "songNoPrefix=YN&keyword=Lagu&pageSize=2&page=2").await;
            assert_eq!(song_nos(&result), ["YN_%006"]);
            assert_eq!(result.total, 3);

            let empty = search(&pool, "songNoPrefix=YN&keyword=Missing").await;
            assert_eq!(empty.total, 0);
            assert!(empty.items.is_empty());
        }
    }

    #[tokio::test]
    async fn prefix_is_literal_and_preserves_availability_and_optional_filter_behavior() {
        let pool = database().await;
        let all = search(&pool, "songNoPrefix=YN&availableOnly=false").await;
        assert_eq!(
            song_nos(&all),
            ["YN001", "YN002", "YN003", "YN004", "YN_%006"]
        );
        assert_eq!(all.total, 5);

        let literal = search(&pool, "songNoPrefix=YN_%25").await;
        assert_eq!(song_nos(&literal), ["YN_%006"]);
        assert_eq!(literal.total, 1);

        let trimmed = search(&pool, "songNoPrefix=%20YN%20").await;
        assert_eq!(trimmed.total, 4);
        let absent = search(&pool, "").await;
        let blank = search(&pool, "songNoPrefix=%20%20").await;
        assert_eq!(absent.total, 7);
        assert_eq!(song_nos(&absent), song_nos(&blank));
        assert_eq!(blank.total, absent.total);
    }

    #[tokio::test]
    async fn prefix_popularity_order_is_global_and_stable_for_lists_and_searches() {
        let pool = database().await;
        sqlx::raw_sql(
            "UPDATE songs SET clickTime = CASE songNo
                WHEN 'YN001' THEN 50 WHEN 'YN002' THEN 100
                WHEN 'YN003' THEN 0 WHEN 'YN_%006' THEN 50 END
                WHERE songNo >= 'YN' AND songNo < 'YO';
             INSERT INTO songs(songNo, songName, initialKey, languageCode, clickTime)
                VALUES ('YN000', 'Lagu Unranked', 'LU', 'zh', NULL);
             INSERT INTO songSearch(songNo, songName, nameKey, initialKey)
                VALUES ('YN000', 'Lagu Unranked', 'Lagu Unranked', 'LU');
             INSERT INTO local_available_songs(songNo, absolutePath) VALUES ('YN000', '');",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Search modes and larger first pages (PAD suggestions) use the same
        // ordering as the catalog, before LIMIT/OFFSET is applied.
        for indexed in [true, false] {
            if !indexed {
                sqlx::query("DROP TABLE songSearch")
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            for (filter, expected) in [
                ("", vec!["YN002", "YN001", "YN_%006", "YN000", "YN003"]),
                (
                    "&keyword=Lagu&searchMode=fullName",
                    vec!["YN002", "YN001", "YN_%006", "YN000"],
                ),
                (
                    "&keyword=l&searchMode=initial",
                    vec!["YN002", "YN001", "YN_%006", "YN000"],
                ),
            ] {
                let first = search(&pool, &format!("songNoPrefix=YN{filter}&pageSize=2")).await;
                let second =
                    search(&pool, &format!("songNoPrefix=YN{filter}&pageSize=2&page=2")).await;
                assert_eq!(song_nos(&first), expected[..2]);
                assert_eq!(song_nos(&second), expected[2..4]);
                assert_eq!(first.total, expected.len() as u64);

                let all = search(&pool, &format!("songNoPrefix=YN{filter}&pageSize=20")).await;
                assert_eq!(song_nos(&all), expected);
                assert!(all.items.windows(2).all(|pair| {
                    pair[0].clickTime.unwrap_or(0) >= pair[1].clickTime.unwrap_or(0)
                }));
            }
        }
    }
}

#[cfg(test)]
mod song_search_case_tests {
    use super::*;
    use axum::extract::Query;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn database() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::run_song_db_migrations(&pool).await.unwrap();
        sqlx::raw_sql(
            r"INSERT INTO songs(songNo, songName, initialKey, languageCode, clickTime) VALUES
                ('YN001', 'Love Alpha', 'LA', 'en', 100),
                ('YN002', 'love Beta', 'lB', 'en', 90),
                ('YN003', 'LOVE Gamma', 'Lg', 'id', 80),
                ('CN001', 'Love Outside', 'LO', 'en', 200),
                ('YN004', 'Love Missing', 'LM', 'en', 110),
                ('YN005', 'lovely Fifth', 'LF', 'en', 90),
                ('YN006', 'Zed', 'z', 'en', 60),
                ('YN007', 'Zebra', 'Z', 'en', 50),
                ('YN008', 'Zed 100% Mix', 'Z100%', 'en', 40),
                ('YN009', 'Zed 100X Mix', 'Z100X', 'en', 39),
                ('YN010', 'Under_score', 'U_', 'en', 30),
                ('YN011', 'UnderXscore', 'UX', 'en', 29),
                ('YN012', 'Slash\Song', 'S\', 'en', 20),
                ('YN013', 'SlashXSong', 'SX', 'en', 19);
             INSERT INTO songSearch(songNo, songName, nameKey, initialKey, clickTime)
                SELECT songNo, songName, songName, initialKey, clickTime FROM songs;",
        )
        .execute(&pool)
        .await
        .unwrap();
        SongDbService::ensure_local_available_table(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO local_available_songs(songNo, absolutePath)
             SELECT songNo, '' FROM songs WHERE songNo <> 'YN004'",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn search(pool: &SqlitePool, query: &str) -> PagedResponse<SongEntry> {
        let uri = format!("/api/v1/songdb/songs?{query}").parse().unwrap();
        let Query(query) = Query::<SongSearchQuery>::try_from_uri(&uri).unwrap();
        SongDbService::search_songs(pool, query).await.unwrap()
    }

    fn song_nos(result: &PagedResponse<SongEntry>) -> Vec<&str> {
        result
            .items
            .iter()
            .map(|song| song.songNo.as_deref().unwrap())
            .collect()
    }

    #[tokio::test]
    async fn name_and_initial_search_ignore_ascii_case_with_and_without_search_table() {
        let pool = database().await;
        for indexed in [true, false] {
            if !indexed {
                sqlx::query("DROP TABLE songSearch")
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            for (mode, keywords) in [
                ("fullName", vec!["Love", "LOVE", "love"]),
                ("initial", vec!["L", "l"]),
            ] {
                for keyword in keywords {
                    let result =
                        search(&pool, &format!("searchMode={mode}&keyword={keyword}")).await;
                    assert_eq!(
                        song_nos(&result),
                        ["CN001", "YN001", "YN002", "YN005", "YN003"]
                    );
                    assert_eq!(result.total, 5);
                }
            }
            let default_mode = search(&pool, "keyword=LOVE").await;
            assert_eq!(default_mode.total, 5);
        }
    }

    #[tokio::test]
    async fn case_insensitive_search_preserves_prefix_language_popularity_and_pages() {
        let pool = database().await;
        for indexed in [true, false] {
            if !indexed {
                sqlx::query("DROP TABLE songSearch")
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            for keyword in ["Love", "LOVE", "love"] {
                let query = format!("keyword={keyword}&songNoPrefix=YN&languageCode=en&pageSize=2");
                let first = search(&pool, &query).await;
                let second = search(&pool, &format!("{query}&page=2")).await;
                assert_eq!(song_nos(&first), ["YN001", "YN002"]);
                assert_eq!(song_nos(&second), ["YN005"]);
                assert_eq!((first.total, second.total), (3, 3));

                let all_languages =
                    search(&pool, &format!("keyword={keyword}&songNoPrefix=YN")).await;
                assert_eq!(
                    song_nos(&all_languages),
                    ["YN001", "YN002", "YN005", "YN003"]
                );
                let unavailable = search(
                    &pool,
                    &format!("{query}&availableOnly=false&pageSize=20")
                        .replace("&pageSize=2&", "&"),
                )
                .await;
                assert_eq!(song_nos(&unavailable), ["YN004", "YN001", "YN002", "YN005"]);
            }
        }
    }

    #[tokio::test]
    async fn search_handles_z_and_treats_like_metacharacters_as_literal_prefixes() {
        let pool = database().await;
        for indexed in [true, false] {
            if !indexed {
                sqlx::query("DROP TABLE songSearch")
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            for mode in ["fullName", "initial"] {
                for keyword in ["Z", "z"] {
                    let result =
                        search(&pool, &format!("searchMode={mode}&keyword={keyword}")).await;
                    assert_eq!(song_nos(&result), ["YN006", "YN007", "YN008", "YN009"]);
                }
            }
            for (mode, keyword, expected) in [
                ("fullName", "ZED%20100%25", "YN008"),
                ("fullName", "UNDER_", "YN010"),
                ("fullName", "SLASH%5C", "YN012"),
                ("initial", "z100%25", "YN008"),
                ("initial", "u_", "YN010"),
                ("initial", "s%5C", "YN012"),
            ] {
                let result = search(&pool, &format!("searchMode={mode}&keyword={keyword}")).await;
                assert_eq!(song_nos(&result), [expected]);
                assert_eq!(result.total, 1);
            }
        }
    }

    #[tokio::test]
    async fn migration_upgrades_existing_binary_indexes_and_keeps_like_search_indexed() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO songSearch(songNo, songName, nameKey, initialKey) VALUES ('existing', 'Love', 'Love', 'L')")
            .execute(&pool).await.unwrap();
        let old_collation: String = sqlx::query_scalar(
            "SELECT coll FROM pragma_index_xinfo('idx_songSearch_name_click') WHERE seqno = 0",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(old_collation, "BINARY");

        crate::db::run_song_db_migrations(&pool).await.unwrap();
        for (column, index, keyword) in [
            ("nameKey", "idx_songSearch_name_click", "LOVE"),
            ("initialKey", "idx_songSearch_initial_click", "l"),
        ] {
            let collation: String =
                sqlx::query_scalar("SELECT coll FROM pragma_index_xinfo(?) WHERE seqno = 0")
                    .bind(index)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(collation, "NOCASE");
            // Use a literal pattern so SQLite's LIKE range optimization is
            // visible to EXPLAIN at prepare time (bound values are otherwise
            // opaque to the planner).
            let pattern = SongDbService::literal_like_prefix(keyword).replace('\'', "''");
            let plan = sqlx::query(&format!(
                "EXPLAIN QUERY PLAN SELECT songNo FROM songSearch WHERE {column} LIKE '{pattern}' ESCAPE '\\'"
            ))
            .fetch_all(&pool)
            .await
            .unwrap();
            assert!(
                plan.iter().any(|row| {
                    let detail: String = row.get("detail");
                    detail.contains("SEARCH songSearch") && detail.contains(index)
                }),
                "LIKE prefix must use {index}"
            );
        }
        let existing: String =
            sqlx::query_scalar("SELECT nameKey FROM songSearch WHERE songNo = 'existing'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(existing, "Love");
        let schema_version: i64 = sqlx::query_scalar("PRAGMA schema_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        crate::db::run_song_db_migrations(&pool).await.unwrap();
        let next_schema_version: i64 = sqlx::query_scalar("PRAGMA schema_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            schema_version, next_schema_version,
            "Repeated startup must not rebuild indexes"
        );
        let tracked: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM _migrations WHERE name = 'song_db_004_search_nocase'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(tracked, 1);
    }
}

#[cfg(test)]
mod video_format_tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn manual_path_edits_recompute_score_and_format_only_edits_do_not_enable_it() {
        let pool=SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql")).execute(&pool).await.unwrap();
        let dir=tempfile::tempdir().unwrap();
        let path=dir.path().join("score.mp4");
        std::fs::write(&path,crate::utils::media_encryption::test_video(true)).unwrap();
        let created=SongDbService::create_song(&pool,serde_json::from_value(json!({"songNo":"score","songName":"Score","absolutePath":path,"videoFileType":"mp4"})).unwrap()).await.unwrap();
        assert_eq!(created.score_enabled,Some(1));
        let id=created.songId.unwrap();
        std::fs::write(&path,crate::utils::media_encryption::test_video(false)).unwrap();
        let changed=SongDbService::update_song(&pool,id,serde_json::from_value(json!({"absolutePath":path})).unwrap()).await.unwrap();
        assert_eq!(changed.score_enabled,Some(0));
        let changed=SongDbService::update_song(&pool,id,serde_json::from_value(json!({"videoFileType":"hvideo"})).unwrap()).await.unwrap();
        assert_eq!(changed.score_enabled,Some(0));
    }

    #[tokio::test]
    async fn editor_score_request_is_always_constrained_by_actual_video_encryption() {
        let pool=SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql")).execute(&pool).await.unwrap();
        let dir=tempfile::tempdir().unwrap();
        let plain=dir.path().join("plain.mp4");
        std::fs::write(&plain,crate::utils::media_encryption::test_video(false)).unwrap();
        let created=SongDbService::create_song(&pool,serde_json::from_value(json!({
            "songNo":"score-editor-plain","songName":"普通视频","absolutePath":plain,
            "primarySingerNo":"S1","primarySingerName":"歌手一"
        })).unwrap()).await.unwrap();
        let id=created.songId.unwrap();
        let changed=SongDbService::update_song(&pool,id,serde_json::from_value(json!({"scoreEnabled":1})).unwrap()).await.unwrap();
        assert_eq!(changed.score_enabled,Some(0),"普通视频不能被编辑器强制开启评分");

        let encrypted=dir.path().join("encrypted.hvideo");
        std::fs::write(&encrypted,crate::utils::media_encryption::test_video(true)).unwrap();
        let changed=SongDbService::update_song(&pool,id,serde_json::from_value(json!({
            "absolutePath":encrypted,"scoreEnabled":0
        })).unwrap()).await.unwrap();
        assert_eq!(changed.score_enabled,Some(1),"加密视频必须自动开启评分");
    }

    #[tokio::test]
    async fn video_format_create_update_and_read_preserve_song_category() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql"))
            .execute(&pool)
            .await
            .unwrap();
        let created = SongDbService::create_song(
            &pool,
            serde_json::from_value(json!({
                "songNo": "format-test", "songName": "测试歌曲", "categoryCode": "pop",
                "videoFileType": "mp4", "fileName": "format-test.mp4"
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        let id = created.songId.unwrap();
        assert_eq!(created.video_file_type.as_deref(), Some("mp4"));
        for format in ["mkv", "mpg", "mp4"] {
            let updated = SongDbService::update_song(
                &pool,
                id,
                serde_json::from_value(json!({
                    "videoFileType": format
                }))
                .unwrap(),
            )
            .await
            .unwrap();
            assert_eq!(updated.video_file_type.as_deref(), Some(format));
            assert_eq!(updated.categoryCode.as_deref(), Some("pop"));
            let stored: String =
                sqlx::query_scalar("SELECT videoFileType FROM songs WHERE songId = ?")
                    .bind(id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(stored, format);
            let payload =
                serde_json::to_value(SongDbService::get_song(&pool, id, false).await.unwrap())
                    .unwrap();
            assert_eq!(payload["videoFileType"], format);
            assert!(payload.get("video_file_type").is_none());
        }
        let renamed = SongDbService::update_song(
            &pool,
            id,
            serde_json::from_value(json!({
                "songName": "只修改歌名"
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(renamed.video_file_type.as_deref(), Some("mp4"));
    }

    #[tokio::test]
    async fn path_update_keeps_point_order_index_in_sync() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql"))
            .execute(&pool)
            .await
            .unwrap();
        let created = SongDbService::create_song(
            &pool,
            serde_json::from_value(json!({
                "songNo": "path-test", "songName": "路径测试",
                "relativePath": "MV", "fileName": "path-test.mp4",
                "absolutePath": "D:/MV/path-test.mp4", "videoFileType": "mp4"
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO local_available_songs(songNo, absolutePath, fileName)
             VALUES ('path-test', 'D:/MV/path-test.mp4', 'path-test.mp4')",
        )
        .execute(&pool)
        .await
        .unwrap();

        SongDbService::update_song(
            &pool,
            created.songId.unwrap(),
            serde_json::from_value(json!({
                "relativePath": "MV", "fileName": "path-test.mkv",
                "videoFileType": "mkv"
            }))
            .unwrap(),
        )
        .await
        .unwrap();

        let catalog: (String, String) =
            sqlx::query_as("SELECT absolutePath, fileName FROM songs WHERE songNo = 'path-test'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let available: (String, String) = sqlx::query_as(
            "SELECT absolutePath, fileName FROM local_available_songs WHERE songNo = 'path-test'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            catalog,
            ("D:/MV/path-test.mkv".into(), "path-test.mkv".into())
        );
        assert_eq!(available, catalog);
    }
}

static SONG_SELECT_SQL_CACHE: OnceCell<String> = OnceCell::const_new();

impl SongDbService {
    async fn table_columns(pool: &SqlitePool, table: &str) -> AppResult<HashSet<String>> {
        let sql = format!("PRAGMA table_info({})", table);
        let rows = sqlx::query(&sql).fetch_all(pool).await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("name").ok())
            .collect())
    }

    async fn ensure_local_available_table(pool: &SqlitePool) -> AppResult<()> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS local_available_songs (
                songNo TEXT PRIMARY KEY,
                absolutePath TEXT NOT NULL,
                fileName TEXT,
                fileSize INTEGER DEFAULT 0,
                modifiedTime INTEGER DEFAULT 0,
                updatedAt INTEGER DEFAULT 0
            )",
        )
        .execute(pool)
        .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_local_available_songs_path ON local_available_songs(absolutePath)")
            .execute(pool)
            .await?;
        Ok(())
    }

    fn has(cols: &HashSet<String>, name: &str) -> bool {
        cols.contains(name)
    }

    fn text_expr(cols: &HashSet<String>, name: &str, alias: &str) -> String {
        if Self::has(cols, name) {
            return format!("COALESCE({}, '') AS {}", name, alias);
        }
        format!("'' AS {}", alias)
    }

    fn int_expr(cols: &HashSet<String>, name: &str, alias: &str) -> String {
        if Self::has(cols, name) {
            return format!("COALESCE({}, 0) AS {}", name, alias);
        }
        format!("0 AS {}", alias)
    }

    fn first_existing<'a>(cols: &HashSet<String>, candidates: &'a [&'a str]) -> Option<&'a str> {
        candidates
            .iter()
            .copied()
            .find(|name| Self::has(cols, name))
    }

    fn prefix_upper_bound(prefix: &str) -> Option<String> {
        let mut chars: Vec<char> = prefix.chars().collect();
        let last = chars.pop()?;
        let next = char::from_u32(last as u32 + 1)?;
        chars.push(next);
        Some(chars.into_iter().collect())
    }

    fn literal_like_prefix(keyword: &str) -> String {
        let mut pattern = String::with_capacity(keyword.len() + 1);
        for ch in keyword.chars() {
            if matches!(ch, '%' | '_' | '\\') {
                pattern.push('\\');
            }
            pattern.push(ch);
        }
        pattern.push('%');
        pattern
    }

    async fn song_select_sql(pool: &SqlitePool) -> AppResult<String> {
        if let Some(sql) = SONG_SELECT_SQL_CACHE.get() {
            return Ok(sql.clone());
        }
        let cols = Self::table_columns(pool, "songs").await?;
        let songName = if Self::has(&cols, "songName") {
            "songName"
        } else {
            "''"
        };
        let sql = format!(
            "SELECT {} AS songId, {} AS songNo, {} AS songName, REPLACE(COALESCE({}, ''), ' ', '') AS songNameNoSpace, {} AS initialKey, {} AS track, {} AS scoreEnabled, {} AS categoryCode, {} AS categoryName, {} AS lightCode, {} AS languageCode, {} AS languageName, {} AS versionName, {} AS clickTime, {} AS videoFileType, {} AS primarySingerNo, {} AS primarySingerName, {} AS singerNames, {} AS relativePath, {} AS fileName, {} AS absolutePath FROM songs",
            Self::int_expr(&cols, "songId", "songId").replace(" AS songId", ""),
            Self::text_expr(&cols, "songNo", "songNo").replace(" AS songNo", ""),
            Self::text_expr(&cols, "songName", "songName").replace(" AS songName", ""),
            songName,
            Self::text_expr(&cols, "initialKey", "initialKey").replace(" AS initialKey", ""),
            Self::int_expr(&cols, "track", "track").replace(" AS track", ""),
            Self::int_expr(&cols, "scoreEnabled", "scoreEnabled").replace(" AS scoreEnabled", ""),
            Self::text_expr(&cols, "categoryCode", "categoryCode").replace(" AS categoryCode", ""),
            Self::text_expr(&cols, "categoryName", "categoryName").replace(" AS categoryName", ""),
            Self::text_expr(&cols, "lightCode", "lightCode").replace(" AS lightCode", ""),
            Self::text_expr(&cols, "languageCode", "languageCode").replace(" AS languageCode", ""),
            Self::text_expr(&cols, "languageName", "languageName").replace(" AS languageName", ""),
            Self::text_expr(&cols, "versionName", "versionName").replace(" AS versionName", ""),
            Self::int_expr(&cols, "clickTime", "clickTime").replace(" AS clickTime", ""),
            Self::text_expr(&cols, "videoFileType", "videoFileType").replace(" AS videoFileType", ""),
            Self::text_expr(&cols, "primarySingerNo", "primarySingerNo").replace(" AS primarySingerNo", ""),
            Self::text_expr(&cols, "primarySingerName", "primarySingerName").replace(" AS primarySingerName", ""),
            Self::text_expr(&cols, "singerNames", "singerNames").replace(" AS singerNames", ""),
            Self::text_expr(&cols, "relativePath", "relativePath").replace(" AS relativePath", ""),
            Self::text_expr(&cols, "fileName", "fileName").replace(" AS fileName", ""),
            Self::text_expr(&cols, "absolutePath", "absolutePath").replace(" AS absolutePath", ""),
        );
        let _ = SONG_SELECT_SQL_CACHE.set(sql.clone());
        Ok(sql)
    }

    async fn singer_select_sql(pool: &SqlitePool) -> AppResult<String> {
        let cols = Self::table_columns(pool, "singers").await?;
        Ok(format!(
            "SELECT {} AS singerId, {} AS singerNo, {} AS singerName, {} AS initialKey, {} AS regionCode, {} AS regionName, {} AS hit, {} AS sexCode, {} AS sexName FROM singers",
            Self::int_expr(&cols, "singerId", "singerId").replace(" AS singerId", ""),
            Self::text_expr(&cols, "singerNo", "singerNo").replace(" AS singerNo", ""),
            Self::text_expr(&cols, "singerName", "singerName").replace(" AS singerName", ""),
            Self::text_expr(&cols, "initialKey", "initialKey").replace(" AS initialKey", ""),
            Self::text_expr(&cols, "regionCode", "regionCode").replace(" AS regionCode", ""),
            Self::text_expr(&cols, "regionName", "regionName").replace(" AS regionName", ""),
            Self::int_expr(&cols, "hit", "hit").replace(" AS hit", ""),
            Self::text_expr(&cols, "sexCode", "sexCode").replace(" AS sexCode", ""),
            Self::text_expr(&cols, "sexName", "sexName").replace(" AS sexName", ""),
        ))
    }

    pub async fn warmup(pool: &SqlitePool) -> AppResult<()> {
        Self::ensure_local_available_table(pool).await?;
        let _ = Self::song_select_sql(pool).await?;
        Ok(())
    }

    pub async fn search_songs(
        pool: &SqlitePool,
        query: SongSearchQuery,
    ) -> AppResult<PagedResponse<SongEntry>> {
        Self::ensure_local_available_table(pool).await?;
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).min(100);
        let offset = (page - 1) * page_size;
        let cols = Self::table_columns(pool, "songs").await?;
        let mut where_clauses: Vec<String> = Vec::new();
        let mut bind_values: Vec<String> = Vec::new();
        if query.available_only.unwrap_or(true) {
            where_clauses.push("songNo IN (SELECT songNo FROM local_available_songs)".to_string());
        }

        if let Some(prefix) = query.song_no_prefix.as_deref().map(str::trim) {
            if !prefix.is_empty() {
                if let Some(upper) = Self::prefix_upper_bound(prefix) {
                    where_clauses.push("songNo >= ? AND songNo < ?".to_string());
                    bind_values.push(prefix.to_string());
                    bind_values.push(upper);
                } else {
                    where_clauses.push("substr(songNo, 1, length(?)) = ?".to_string());
                    bind_values.push(prefix.to_string());
                    bind_values.push(prefix.to_string());
                }
            }
        }

        if let Some(ref keyword) = query.keyword {
            let keyword = keyword.trim();
            if !keyword.is_empty() {
                let search_mode = query.search_mode.as_deref().unwrap_or("fullName");
                // SQLite LIKE matches ASCII letters without case sensitivity.
                // Escape user input so both indexed and fallback searches keep
                // literal prefix semantics (including %, _ and backslashes).
                let search_pattern = Self::literal_like_prefix(keyword);
                let search_cols = Self::table_columns(pool, "songSearch")
                    .await
                    .unwrap_or_default();
                let search_col = match search_mode {
                    "initial" => Self::first_existing(&search_cols, &["initialKey"]),
                    "fullName" => Self::first_existing(&search_cols, &["nameKey"]),
                    _ => Self::first_existing(&search_cols, &["nameKey"]),
                };
                if let Some(search_col) = search_col {
                    where_clauses.push(format!(
                        "(songNo LIKE ? ESCAPE '\\' OR songNo IN (SELECT songNo FROM songSearch WHERE {} LIKE ? ESCAPE '\\'))",
                        search_col
                    ));
                    bind_values.push(search_pattern.clone());
                    bind_values.push(search_pattern);
                } else {
                    let mut parts = vec!["songNo LIKE ? ESCAPE '\\'".to_string()];
                    let keyword_cols: &[&str] = match search_mode {
                        "initial" => &["initialKey"],
                        "fullName" => &["songName"],
                        _ => &["songName"],
                    };
                    for col in keyword_cols {
                        if Self::has(&cols, col) {
                            parts.push(format!("{} LIKE ? ESCAPE '\\'", col));
                        }
                    }
                    if !parts.is_empty() {
                        where_clauses.push(format!("({})", parts.join(" OR ")));
                        for _ in 0..parts.len() {
                            bind_values.push(search_pattern.clone());
                        }
                    }
                }
            }
        }
        if let Some(ref language) = query.languageCode {
            if !language.trim().is_empty() {
                if Self::has(&cols, "languageCode") {
                    where_clauses.push("languageCode = ?".to_string());
                    bind_values.push(language.trim().to_string());
                }
            }
        }
        if let Some(ref initial) = query.initial {
            if !initial.trim().is_empty() {
                if Self::has(&cols, "initialKey") {
                    where_clauses.push("initialKey LIKE ?".to_string());
                    bind_values.push(format!("{}%", initial.trim()));
                }
            }
        }
        if let Some(ref singer_no) = query.primarySingerNo {
            let singer_no = singer_no.trim();
            if !singer_no.is_empty() {
                let song_singer_cols = Self::table_columns(pool, "songSingers")
                    .await
                    .unwrap_or_default();
                if Self::has(&song_singer_cols, "songNo")
                    && Self::has(&song_singer_cols, "singerNo")
                {
                    where_clauses.push(
                        "songNo IN (SELECT songNo FROM songSingers WHERE singerNo = ?)".to_string(),
                    );
                    bind_values.push(singer_no.to_string());
                } else if Self::has(&cols, "primarySingerNo") {
                    where_clauses.push("primarySingerNo = ?".to_string());
                    bind_values.push(singer_no.to_string());
                }
            }
        }
        if let Some(ref classify_code) = query.categoryCode {
            if !classify_code.trim().is_empty() {
                if Self::has(&cols, "categoryCode") {
                    if classify_code.trim() == "1" && Self::has(&cols, "addedBatchId") {
                        where_clauses.push("(categoryCode = '1' OR addedBatchId IN (SELECT batchId FROM songBatches WHERE batchType='cloudVod' AND createdTime >= ?))".to_string());
                        bind_values.push((chrono::Utc::now().timestamp_millis() - 30 * 24 * 60 * 60 * 1000).to_string());
                    } else {
                        where_clauses.push("categoryCode = ?".to_string());
                        bind_values.push(classify_code.trim().to_string());
                    }
                }
            }
        }

        let where_sql = if where_clauses.is_empty() {
            "1=1".to_string()
        } else {
            where_clauses.join(" AND ")
        };
        let count_sql = format!("SELECT COUNT(*) FROM songs WHERE {}", where_sql);
        let mut count_q = sqlx::query_scalar::<_, i64>(&count_sql);
        for v in &bind_values {
            count_q = count_q.bind(v);
        }
        let total = count_q.fetch_one(pool).await? as u64;

        let order_col =
            Self::first_existing(&cols, &["clickTime", "songId", "id"]).unwrap_or("rowid");
        let order_col = if query.categoryCode.as_deref().map(str::trim) == Some("1") && Self::has(&cols, "addedTime") {
            "addedTime"
        } else { order_col };
        // The catalog, prefix filters and searches share the library's
        // popularity order. Song number breaks ties so pagination is stable.
        let data_sql = format!(
            "{} WHERE {} ORDER BY {} DESC, songNo ASC LIMIT ? OFFSET ?",
            Self::song_select_sql(pool).await?,
            where_sql,
            order_col
        );
        let mut data_q = sqlx::query_as::<_, SongEntry>(&data_sql);
        for v in &bind_values {
            data_q = data_q.bind(v);
        }
        data_q = data_q.bind(page_size).bind(offset);
        let mut items = data_q.fetch_all(pool).await?;
        let media_roots_raw = sqlx::query_scalar::<_, String>(
            "SELECT value FROM system_settings WHERE key = 'media_root'",
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
        if query.available_only.unwrap_or(true) && !items.is_empty() {
            let song_nos: Vec<String> = items
                .iter()
                .filter_map(|item| item.songNo.clone())
                .collect();
            if !song_nos.is_empty() {
                let placeholders = vec!["?"; song_nos.len()].join(",");
                let local_sql = format!(
                    "SELECT songNo, absolutePath, fileName FROM local_available_songs WHERE songNo IN ({})",
                    placeholders
                );
                let mut local_q = sqlx::query(&local_sql);
                for songNo in &song_nos {
                    local_q = local_q.bind(songNo);
                }
                let local_rows = local_q.fetch_all(pool).await?;
                for item in &mut items {
                    if let Some(songNo) = item.songNo.as_deref() {
                        if let Some(row) = local_rows.iter().find(|row| {
                            row.try_get::<String, _>("songNo").ok().as_deref() == Some(songNo)
                        }) {
                            let absolutePath =
                                row.try_get::<String, _>("absolutePath").unwrap_or_default();
                            if !absolutePath.trim().is_empty() {
                                let path_parts =
                                    media_path::build_parts(&absolutePath, &media_roots_raw);
                                item.relativePath = Some(path_parts.relativePath);
                                item.absolutePath = Some(path_parts.absolutePath);
                                item.fileName = None;
                            }
                        }
                    }
                }
            }
        }
        Ok(PagedResponse {
            items,
            total,
            page,
            page_size,
        })
    }

    pub async fn get_song(
        pool: &SqlitePool,
        id: i64,
        available_only: bool,
    ) -> AppResult<SongEntry> {
        let filter = if available_only {
            Self::ensure_local_available_table(pool).await?;
            " AND songNo IN (SELECT songNo FROM local_available_songs)"
        } else {
            ""
        };
        let sql = format!(
            "SELECT * FROM ({}) WHERE songId = ?{} LIMIT 1",
            Self::song_select_sql(pool).await?,
            filter
        );
        sqlx::query_as::<_, SongEntry>(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("歌曲不存在: {}", id)))
    }

    async fn sync_song_indexes(
        conn: &mut SqliteConnection,
        song_no: &str,
        now: i64,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO songSearch (
                songNo, songName, singerNames, nameKey, initialKey, languageCode,
                categoryCode, primarySingerNo, fileExists, addedTime, addedBatchId, clickTime
             )
             SELECT
                songNo, songName, COALESCE(singerNames, ''),
                TRIM(songName || ' ' || COALESCE(singerNames, '')),
                COALESCE(initialKey, ''), languageCode, categoryCode, primarySingerNo,
                CASE WHEN songNo IN (SELECT songNo FROM local_available_songs) THEN 1 ELSE 0 END,
                ?, 'admin', COALESCE(clickTime, 0)
             FROM songs WHERE songNo = ?
             ON CONFLICT(songNo) DO UPDATE SET
                songName = excluded.songName,
                singerNames = excluded.singerNames,
                nameKey = excluded.nameKey,
                initialKey = excluded.initialKey,
                languageCode = excluded.languageCode,
                categoryCode = excluded.categoryCode,
                primarySingerNo = excluded.primarySingerNo",
        )
        .bind(now)
        .bind(song_no)
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            "DELETE FROM songSingers
             WHERE songNo = ?
               AND singerNo <> COALESCE((
                    SELECT primarySingerNo FROM songs WHERE songNo = ?
               ), '')",
        )
        .bind(song_no)
        .bind(song_no)
        .execute(&mut *conn)
        .await?;

        sqlx::query(
            "INSERT INTO songSingers (
                songNo, singerNo, singerName, languageCode, categoryCode,
                fileExists, clickTime, sortOrder
             )
             SELECT
                songNo, primarySingerNo, COALESCE(primarySingerName, singerNames, ''),
                languageCode, categoryCode,
                CASE WHEN songNo IN (SELECT songNo FROM local_available_songs) THEN 1 ELSE 0 END,
                COALESCE(clickTime, 0), 0
             FROM songs
             WHERE songNo = ?
               AND primarySingerNo IS NOT NULL
               AND TRIM(primarySingerNo) <> ''
             ON CONFLICT(songNo, singerNo) DO UPDATE SET
                singerName = excluded.singerName,
                languageCode = excluded.languageCode,
                categoryCode = excluded.categoryCode",
        )
        .bind(song_no)
        .execute(&mut *conn)
        .await?;

        Ok(())
    }

    pub async fn create_song(pool: &SqlitePool, req: CreateSongRequest) -> AppResult<SongEntry> {
        let song_no = req.songNo.trim().to_string();
        let song_name = req.songName.trim().to_string();
        if song_no.is_empty() {
            return Err(AppError::BadRequest("songNo is required".to_string()));
        }
        if song_name.is_empty() {
            return Err(AppError::BadRequest("songName is required".to_string()));
        }
        let score_enabled = crate::utils::media_encryption::score_enabled(req.absolutePath.as_deref().unwrap_or("")).await;
        let now = chrono::Utc::now().timestamp_millis();
        Self::ensure_local_available_table(pool).await?;
        let mut tx = pool.begin().await?;
        sqlx::query(
            "INSERT INTO songs (
                songNo, songName, primarySingerNo, primarySingerName, singerNames,
                languageCode, categoryCode, relativePath, fileName, absolutePath,
                videoFileType, track, initialKey, createdTime, updatedTime, scoreEnabled
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&song_no)
        .bind(&song_name)
        .bind(req.primarySingerNo)
        .bind(req.primarySingerName)
        .bind(req.singerNames)
        .bind(req.languageCode)
        .bind(req.categoryCode)
        .bind(req.relativePath)
        .bind(req.fileName)
        .bind(req.absolutePath)
        .bind(req.video_file_type)
        .bind(req.track)
        .bind(req.initialKey)
        .bind(now)
        .bind(now)
        .bind(score_enabled)
        .execute(&mut *tx)
        .await?;
        Self::sync_song_indexes(&mut tx, &song_no, now).await?;
        tx.commit().await?;

        Self::get_song_by_no(pool, &song_no).await
    }

    pub async fn update_song(
        pool: &SqlitePool,
        id: i64,
        req: UpdateSongRequest,
    ) -> AppResult<SongEntry> {
        let existing = Self::get_song_total(pool, id).await?;
        let song_no = existing.songNo.unwrap_or_default();
        let now = chrono::Utc::now().timestamp_millis();
        Self::ensure_local_available_table(pool).await?;

        // The point-order path is sourced from local_available_songs.  Keep it
        // in lockstep with the catalog whenever an edit includes path fields;
        // otherwise the UI can show MKV while point-order still plays MP4.
        let path_was_updated =
            req.relativePath.is_some() || req.fileName.is_some() || req.absolutePath.is_some();
        let canonical_path = if path_was_updated {
            let absolute = req
                .absolutePath
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let relative = req
                .relativePath
                .as_deref()
                .or(existing.relativePath.as_deref())
                .unwrap_or("");
            let file_name = req
                .fileName
                .as_deref()
                .or(existing.fileName.as_deref())
                .unwrap_or("");
            let requested_path = media_path::join_path_and_file(relative, file_name);
            let path = absolute.map(str::to_string).unwrap_or_else(|| {
                // The admin form always submits relativePath/fileName. If the
                // directory is unchanged, retain the existing absolute root
                // so a metadata-only save cannot silently downgrade a
                // server-local path into a relative one.
                let existing_absolute = existing
                    .absolutePath
                    .as_deref()
                    .map(media_path::normalize_slashes)
                    .unwrap_or_default();
                let existing_display = media_path::join_path_and_file(
                    existing.relativePath.as_deref().unwrap_or(""),
                    existing.fileName.as_deref().unwrap_or(""),
                );
                let requested_parent = requested_path
                    .rsplit_once('/')
                    .map(|(parent, _)| parent)
                    .unwrap_or("");
                let existing_display_parent = existing_display
                    .rsplit_once('/')
                    .map(|(parent, _)| parent)
                    .unwrap_or("");
                if !existing_absolute.is_empty()
                    && requested_parent.eq_ignore_ascii_case(existing_display_parent)
                {
                    if let Some((parent, _)) = existing_absolute.rsplit_once('/') {
                        return format!("{}/{}", parent, media_path::fileName(&requested_path));
                    }
                }
                requested_path
            });
            let path = media_path::normalize_slashes(&path);
            if path.trim().is_empty() || !media_path::is_media_file_path(&path) {
                return Err(AppError::BadRequest(
                    "文件路径必须包含支持的视频文件扩展名".to_string(),
                ));
            }
            Some(path)
        } else {
            None
        };
        // Scoring is a derived property: an editor request can display/change
        // the preference, but only a real encrypted video may persist `1`.
        // Recheck an existing path when the editor submits the score field so
        // a stale UI value cannot enable scoring for a normal video.
        let score_path = canonical_path.as_deref().or(existing.absolutePath.as_deref());
        let score_enabled = if canonical_path.is_some() || req.scoreEnabled.is_some() {
            Some(crate::utils::media_encryption::score_enabled(score_path.unwrap_or("")).await)
        } else { None };
        let mut tx = pool.begin().await?;
        let result = sqlx::query(
            "UPDATE songs SET
                songName = COALESCE(?, songName),
                primarySingerNo = COALESCE(?, primarySingerNo),
                primarySingerName = COALESCE(?, primarySingerName),
                singerNames = COALESCE(?, singerNames),
                languageCode = COALESCE(?, languageCode),
                categoryCode = COALESCE(?, categoryCode),
                relativePath = COALESCE(?, relativePath),
                fileName = COALESCE(?, fileName),
                absolutePath = COALESCE(?, absolutePath),
                videoFileType = COALESCE(?, videoFileType),
                track = COALESCE(?, track),
                initialKey = COALESCE(?, initialKey),
                updatedTime = ?,
                scoreEnabled = COALESCE(?, scoreEnabled)
             WHERE songId = ?",
        )
        .bind(req.songName.map(|value| value.trim().to_string()))
        .bind(req.primarySingerNo)
        .bind(req.primarySingerName)
        .bind(req.singerNames)
        .bind(req.languageCode)
        .bind(req.categoryCode)
        .bind(req.relativePath)
        .bind(req.fileName)
        .bind(canonical_path.as_deref().or(req.absolutePath.as_deref()))
        .bind(req.video_file_type)
        .bind(req.track)
        .bind(req.initialKey)
        .bind(now)
        .bind(score_enabled)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("song not found: {}", id)));
        }

        if let Some(path) = canonical_path.as_deref() {
            let file_name = media_path::fileName(path);
            sqlx::query(
                "INSERT INTO local_available_songs (songNo, absolutePath, fileName, updatedAt)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(songNo) DO UPDATE SET
                    absolutePath = excluded.absolutePath,
                    fileName = excluded.fileName,
                    updatedAt = excluded.updatedAt",
            )
            .bind(&song_no)
            .bind(path)
            .bind(&file_name)
            .bind(now)
            .execute(&mut *tx)
            .await?;

            // Keep the detailed file index consistent where it is present.
            sqlx::query(
                "INSERT INTO songFiles (songNo, absolutePath, fileName, fileExists, lastCheckedTime)
                 VALUES (?, ?, ?, 1, ?)
                 ON CONFLICT(songNo) DO UPDATE SET
                    absolutePath = excluded.absolutePath,
                    fileName = excluded.fileName,
                    fileExists = 1,
                    lastCheckedTime = excluded.lastCheckedTime,
                    lastError = NULL",
            )
            .bind(&song_no)
            .bind(path)
            .bind(&file_name)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
        Self::sync_song_indexes(&mut tx, &song_no, now).await?;
        tx.commit().await?;
        Self::get_song_total(pool, id).await
    }

    pub async fn delete_song(pool: &SqlitePool, id: i64) -> AppResult<()> {
        let existing = Self::get_song_total(pool, id).await?;
        let song_no = existing.songNo.unwrap_or_default();
        Self::ensure_local_available_table(pool).await?;
        let mut tx = pool.begin().await?;
        let result = sqlx::query("DELETE FROM songs WHERE songNo = ?")
            .bind(&song_no)
            .execute(&mut *tx)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("song not found: {}", id)));
        }
        for table in ["local_available_songs", "songSearch", "songSingers"] {
            let sql = format!("DELETE FROM {} WHERE songNo = ?", table);
            sqlx::query(&sql).bind(&song_no).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn get_song_total(pool: &SqlitePool, id: i64) -> AppResult<SongEntry> {
        let sql = format!(
            "SELECT * FROM ({}) WHERE songId = ? LIMIT 1",
            Self::song_select_sql(pool).await?
        );
        sqlx::query_as::<_, SongEntry>(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("歌曲不存在: {}", id)))
    }

    async fn get_song_by_no(pool: &SqlitePool, songNo: &str) -> AppResult<SongEntry> {
        let sql = format!(
            "SELECT * FROM ({}) WHERE songNo = ? LIMIT 1",
            Self::song_select_sql(pool).await?
        );
        sqlx::query_as::<_, SongEntry>(&sql)
            .bind(songNo)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("歌曲不存在: {}", songNo)))
    }

    // ==================== 歌星相关 ====================

    pub async fn search_singers(
        pool: &SqlitePool,
        query: SingerSearchQuery,
    ) -> AppResult<PagedResponse<SingerEntry>> {
        let cols = Self::table_columns(pool, "singers").await?;
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).min(100);
        let offset = (page - 1) * page_size;
        let mut where_clauses = vec!["1=1".to_string()];
        let mut bind_values: Vec<String> = Vec::new();
        if let Some(ref keyword) = query.keyword {
            let keyword = keyword.trim();
            if !keyword.is_empty() {
                let mut parts = Vec::new();
                for col in ["singerName", "singerNo", "initialKey"] {
                    if Self::has(&cols, col) {
                        parts.push(format!("{} LIKE ?", col));
                    }
                }
                if !parts.is_empty() {
                    where_clauses.push(format!("({})", parts.join(" OR ")));
                    let like_val = format!("%{}%", keyword);
                    for _ in 0..parts.len() {
                        bind_values.push(like_val.clone());
                    }
                }
            }
        }
        if let Some(ref region) = query.region_code {
            if !region.trim().is_empty() {
                if Self::has(&cols, "regionCode") {
                    where_clauses.push("regionCode = ?".to_string());
                    bind_values.push(region.trim().to_string());
                }
            }
        }
        if let Some(ref sex) = query.sex_code {
            if !sex.trim().is_empty() {
                if Self::has(&cols, "sexCode") {
                    where_clauses.push("sexCode = ?".to_string());
                    bind_values.push(sex.trim().to_string());
                }
            }
        }
        if let Some(ref initial) = query.initial {
            if !initial.trim().is_empty() {
                if Self::has(&cols, "initialKey") {
                    where_clauses.push("initialKey LIKE ?".to_string());
                    bind_values.push(format!("{}%", initial.trim()));
                }
            }
        }
        let where_sql = where_clauses.join(" AND ");
        let count_sql = format!("SELECT COUNT(*) FROM singers WHERE {}", where_sql);
        let mut count_q = sqlx::query_scalar::<_, i64>(&count_sql);
        for v in &bind_values {
            count_q = count_q.bind(v);
        }
        let total = count_q.fetch_one(pool).await? as u64;

        let order_col =
            Self::first_existing(&cols, &["hit", "clickTime", "singerId", "id"]).unwrap_or("rowid");
        let data_sql = format!(
            "{} WHERE {} ORDER BY {} DESC LIMIT ? OFFSET ?",
            Self::singer_select_sql(pool).await?,
            where_sql,
            order_col
        );
        let mut data_q = sqlx::query_as::<_, SingerEntry>(&data_sql);
        for v in &bind_values {
            data_q = data_q.bind(v);
        }
        data_q = data_q.bind(page_size).bind(offset);
        let items = data_q.fetch_all(pool).await?;

        Ok(PagedResponse {
            items,
            total,
            page,
            page_size,
        })
    }

    pub async fn get_singer(pool: &SqlitePool, id: i64) -> AppResult<SingerEntry> {
        sqlx::query_as::<_, SingerEntry>(&format!(
            "SELECT * FROM ({}) WHERE singerId = ? LIMIT 1",
            Self::singer_select_sql(pool).await?
        ))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("歌星不存在: {}", id)))
    }

    pub async fn create_singer(
        pool: &SqlitePool,
        req: CreateSingerRequest,
    ) -> AppResult<SingerEntry> {
        let singer_no = req.singer_no.trim().to_string();
        let singer_name = req.singer_name.trim().to_string();
        if singer_no.is_empty() {
            return Err(AppError::BadRequest("singerNo 不能为空".to_string()));
        }
        if singer_name.is_empty() {
            return Err(AppError::BadRequest("singerName 不能为空".to_string()));
        }
        let now = chrono::Utc::now().timestamp_millis();
        let result = sqlx::query(
            "INSERT INTO singers (
                singerNo, singerName, regionCode, sexCode, hit, createdTime, updatedTime
             ) VALUES (?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(&singer_no)
        .bind(&singer_name)
        .bind(req.region_code)
        .bind(req.sex_code)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
        Self::get_singer(pool, result.last_insert_rowid()).await
    }

    pub async fn update_singer(
        pool: &SqlitePool,
        id: i64,
        req: UpdateSingerRequest,
    ) -> AppResult<SingerEntry> {
        let now = chrono::Utc::now().timestamp_millis();
        let result = sqlx::query(
            "UPDATE singers SET
                singerName = COALESCE(?, singerName),
                regionCode = COALESCE(?, regionCode),
                sexCode = COALESCE(?, sexCode),
                updatedTime = ?
             WHERE singerId = ?",
        )
        .bind(req.singer_name.map(|value| value.trim().to_string()))
        .bind(req.region_code)
        .bind(req.sex_code)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("歌星不存在: {}", id)));
        }
        Self::get_singer(pool, id).await
    }

    pub async fn delete_singer(pool: &SqlitePool, id: i64) -> AppResult<()> {
        let result = sqlx::query("DELETE FROM singers WHERE singerId = ?")
            .bind(id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("歌星不存在: {}", id)));
        }
        Ok(())
    }

    pub async fn get_singer_songs(
        pool: &SqlitePool,
        singer_no: &str,
        page: u32,
        page_size: u32,
    ) -> AppResult<PagedResponse<SongEntry>> {
        Self::search_songs(
            pool,
            SongSearchQuery {
                keyword: None,
                search_mode: None,
                song_no_prefix: None,
                languageCode: None,
                initial: None,
                primarySingerNo: Some(singer_no.to_string()),
                categoryCode: None,
                is_hot: None,
                available_only: Some(true),
                page: Some(page),
                page_size: Some(page_size),
            },
        )
        .await
    }

    pub async fn get_stats(pool: &SqlitePool) -> AppResult<SongDbStats> {
        let total_songs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM songs")
            .fetch_one(pool)
            .await?;
        let total_singers: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM singers")
            .fetch_one(pool)
            .await?;
        let total_languages: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM dicts WHERE dictGroup = 'language'")
                .fetch_one(pool)
                .await?;
        Ok(SongDbStats {
            total_songs,
            total_singers,
            total_languages,
        })
    }
}
