//! Integration tests for `fetch_blob_value_impl` against the in-process MySQL mock.

mod common;

#[cfg(not(coverage))]
mod blob_value_fetch_integration {
    use crate::common;
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use common::blob_step_helpers::{connect_mock_pool, len_step, val_step};
    use common::mock_mysql_server::{MockCell, MockMySqlServer};
    use serde_json::json;
    use sqllumen_lib::mysql::table_data::{fetch_blob_value_impl, BLOB_FETCH_CAP};

    const LEN_SQL: &str =
        "SELECT OCTET_LENGTH(`photo`) AS `len` FROM `app_db`.`assets` WHERE `id` = ? LIMIT 1";
    const VAL_SQL: &str = "SELECT `photo` AS `val` FROM `app_db`.`assets` WHERE `id` = ? LIMIT 1";

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetches_bytes_as_base64_for_known_row() {
        let raw: &'static [u8] = b"\x89PNG\r\n\x1a\nhello-blob";
        let server = MockMySqlServer::start_script(vec![
            len_step(LEN_SQL, MockCell::I64(raw.len() as i64)),
            val_step(VAL_SQL, MockCell::Bytes(raw)),
        ])
        .await;
        let pool = connect_mock_pool(&server).await;

        let resp = fetch_blob_value_impl(
            &pool,
            "app_db",
            "assets",
            "photo",
            &[("id".to_string(), json!(7))],
        )
        .await
        .expect("fetch should succeed");

        pool.close().await;

        assert_eq!(resp.base64, Some(B64.encode(raw)));
        assert_eq!(resp.byte_length, raw.len() as u64);
        assert!(!resp.too_large);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn returns_null_base64_for_null_cell() {
        let server =
            MockMySqlServer::start_script(vec![len_step(LEN_SQL, MockCell::Null)]).await;
        let pool = connect_mock_pool(&server).await;

        let resp = fetch_blob_value_impl(
            &pool,
            "app_db",
            "assets",
            "photo",
            &[("id".to_string(), json!(7))],
        )
        .await
        .expect("fetch should succeed");

        pool.close().await;

        assert_eq!(resp.base64, None);
        assert_eq!(resp.byte_length, 0);
        assert!(!resp.too_large);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn flags_too_large_without_transporting_bytes() {
        // Length exceeds the cap: only the length query runs; bytes are never fetched.
        let over_cap = (BLOB_FETCH_CAP + 1) as i64;
        let server =
            MockMySqlServer::start_script(vec![len_step(LEN_SQL, MockCell::I64(over_cap))]).await;
        let pool = connect_mock_pool(&server).await;

        let resp = fetch_blob_value_impl(
            &pool,
            "app_db",
            "assets",
            "photo",
            &[("id".to_string(), json!(7))],
        )
        .await
        .expect("fetch should succeed");

        pool.close().await;

        assert!(resp.too_large);
        assert_eq!(resp.base64, None);
        assert_eq!(resp.byte_length, over_cap as u64);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn at_cap_boundary_still_returns_bytes() {
        // Exactly at the cap is allowed (cap is an exclusive upper bound check).
        let raw: &'static [u8] = b"boundary";
        let server = MockMySqlServer::start_script(vec![
            len_step(LEN_SQL, MockCell::I64(BLOB_FETCH_CAP as i64)),
            val_step(VAL_SQL, MockCell::Bytes(raw)),
        ])
        .await;
        let pool = connect_mock_pool(&server).await;

        let resp = fetch_blob_value_impl(
            &pool,
            "app_db",
            "assets",
            "photo",
            &[("id".to_string(), json!(7))],
        )
        .await
        .expect("fetch should succeed");

        pool.close().await;

        assert!(!resp.too_large);
        assert_eq!(resp.base64, Some(B64.encode(raw)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn empty_pk_pairs_is_rejected() {
        let server =
            MockMySqlServer::start_script(vec![len_step(LEN_SQL, MockCell::Null)]).await;
        let pool = connect_mock_pool(&server).await;

        let err = fetch_blob_value_impl(&pool, "app_db", "assets", "photo", &[])
            .await
            .expect_err("empty pk pairs should error");

        pool.close().await;

        assert!(err.to_lowercase().contains("primary key"));
    }
}

#[cfg(not(coverage))]
mod blob_file_bytes_integration {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use sqllumen_lib::mysql::table_data::{
        read_file_bytes_impl, write_file_bytes_impl, BLOB_FETCH_CAP,
    };

    fn temp_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "sqllumen-blob-bytes-{}-{}-{name}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        p
    }

    #[test]
    fn write_then_read_round_trips_arbitrary_binary() {
        let raw = b"\x89PNG\r\n\x1a\n\x00\x01\x02\xff\xfe";
        let path = temp_path("roundtrip.bin");
        let path_str = path.to_string_lossy().to_string();

        write_file_bytes_impl(&path_str, &B64.encode(raw)).expect("write should succeed");

        let on_disk = std::fs::read(&path).expect("file should exist");
        assert_eq!(on_disk, raw, "bytes must be written byte-for-byte");

        let read_b64 = read_file_bytes_impl(&path_str).expect("read should succeed");
        assert_eq!(B64.decode(read_b64).unwrap(), raw);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_rejects_files_over_the_cap() {
        let path = temp_path("toobig.bin");
        let path_str = path.to_string_lossy().to_string();
        // One byte over the cap.
        let big = vec![0u8; BLOB_FETCH_CAP + 1];
        std::fs::write(&path, &big).expect("setup write should succeed");

        let err = read_file_bytes_impl(&path_str).expect_err("over-cap read should error");
        assert!(err.contains("10 MB"), "error should mention the limit: {err}");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_rejects_invalid_base64() {
        let path = temp_path("invalid.bin");
        let path_str = path.to_string_lossy().to_string();
        let err = write_file_bytes_impl(&path_str, "###not base64###")
            .expect_err("invalid base64 should error");
        assert!(err.to_lowercase().contains("base64"));
    }

    #[test]
    fn read_missing_file_errors() {
        let path = temp_path("does-not-exist.bin");
        let err = read_file_bytes_impl(&path.to_string_lossy())
            .expect_err("missing file should error");
        assert!(err.to_lowercase().contains("metadata") || err.to_lowercase().contains("read"));
    }
}
