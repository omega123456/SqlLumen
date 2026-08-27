//! Integration tests for write/read-back paths whose primary key is a binary
//! column. These drive `update_table_row_impl`, `delete_table_row_impl`, and
//! `fetch_blob_value_impl` end-to-end against the in-process MySQL mock with a
//! blob-envelope PK value (`{ "__sqllumen_blob__": true, "kind": "bytes",
//! "base64": "…" }`).
//!
//! KD6: the mock discards bound parameters and `bind_json_value` is
//! MySQL-specific, so these tests assert acceptance / affected-row / returned
//! value behavior and SQL shape (via the mock's normalized string match). The
//! bytes-vs-string decode contract is proven separately by the pure
//! `decode_blob_envelope` assertion at the bottom of this file.

#[cfg(not(coverage))]
mod binary_pk_write_integration {
    use crate::common::blob_step_helpers::{connect_mock_pool, len_step, val_step};
    use crate::common::mock_mysql_server::{MockCell, MockMySqlServer, MockQueryStep};
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use serde_json::json;
    use sqllumen_lib::mysql::table_data::{
        decode_blob_envelope, delete_table_row_impl, fetch_blob_value_impl, update_table_row_impl,
        BlobBind,
    };
    use std::collections::HashMap;

    /// The 16-byte BINARY(16) primary key used across the tests, plus its
    /// matching `bytes` blob envelope.
    const PK_BYTES: [u8; 16] = [
        0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x09, 0x87, 0x65, 0x43,
        0x21,
    ];

    fn pk_envelope() -> serde_json::Value {
        json!({
            "__sqllumen_blob__": true,
            "kind": "bytes",
            "base64": B64.encode(PK_BYTES),
        })
    }

    // ── UPDATE ──────────────────────────────────────────────────────────────

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn update_with_binary_pk_envelope_succeeds() {
        // SET clause sorts keys; only `name` is updated. WHERE matches the
        // binary PK by `uuid = ?`.
        let server = MockMySqlServer::start_script(vec![MockQueryStep::ok_affected(
            "UPDATE `app_db`.`assets` SET `name` = ? WHERE `uuid` = ?",
            1,
        )])
        .await;
        let pool = connect_mock_pool(&server).await;

        let mut original_pk = HashMap::new();
        original_pk.insert("uuid".to_string(), pk_envelope());

        let mut updated = HashMap::new();
        updated.insert("name".to_string(), json!("renamed row"));

        let result = update_table_row_impl(
            &pool,
            "app_db",
            "assets",
            &["uuid".to_string()],
            &original_pk,
            &updated,
        )
        .await;

        pool.close().await;

        result.expect("update with enveloped binary PK should succeed");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn update_with_composite_binary_and_int_pk_succeeds() {
        // Composite key: tenant_id (int) + uuid (binary, enveloped). PK columns
        // are emitted in the order given, so WHERE is `tenant_id = ? AND uuid = ?`.
        let server = MockMySqlServer::start_script(vec![MockQueryStep::ok_affected(
            "UPDATE `app_db`.`assets` SET `name` = ? WHERE `tenant_id` = ? AND `uuid` = ?",
            1,
        )])
        .await;
        let pool = connect_mock_pool(&server).await;

        let mut original_pk = HashMap::new();
        original_pk.insert("tenant_id".to_string(), json!(42));
        original_pk.insert("uuid".to_string(), pk_envelope());

        let mut updated = HashMap::new();
        updated.insert("name".to_string(), json!("renamed composite row"));

        let result = update_table_row_impl(
            &pool,
            "app_db",
            "assets",
            &["tenant_id".to_string(), "uuid".to_string()],
            &original_pk,
            &updated,
        )
        .await;

        pool.close().await;

        result.expect("composite-key update with enveloped binary PK should succeed");
    }

    // ── DELETE ──────────────────────────────────────────────────────────────

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn delete_with_binary_pk_envelope_succeeds() {
        let server = MockMySqlServer::start_script(vec![MockQueryStep::ok_affected(
            "DELETE FROM `app_db`.`assets` WHERE `uuid` = ?",
            1,
        )])
        .await;
        let pool = connect_mock_pool(&server).await;

        let mut pk_values = HashMap::new();
        pk_values.insert("uuid".to_string(), pk_envelope());

        let result =
            delete_table_row_impl(&pool, "app_db", "assets", &["uuid".to_string()], &pk_values)
                .await;

        pool.close().await;

        result.expect("delete with enveloped binary PK should succeed");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn delete_with_composite_binary_and_int_pk_succeeds() {
        let server = MockMySqlServer::start_script(vec![MockQueryStep::ok_affected(
            "DELETE FROM `app_db`.`assets` WHERE `tenant_id` = ? AND `uuid` = ?",
            1,
        )])
        .await;
        let pool = connect_mock_pool(&server).await;

        let mut pk_values = HashMap::new();
        pk_values.insert("tenant_id".to_string(), json!(42));
        pk_values.insert("uuid".to_string(), pk_envelope());

        let result = delete_table_row_impl(
            &pool,
            "app_db",
            "assets",
            &["tenant_id".to_string(), "uuid".to_string()],
            &pk_values,
        )
        .await;

        pool.close().await;

        result.expect("composite-key delete with enveloped binary PK should succeed");
    }

    // ── BLOB FETCH ──────────────────────────────────────────────────────────

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_blob_value_with_binary_pk_envelope_returns_bytes() {
        const LEN_SQL: &str =
            "SELECT OCTET_LENGTH(`photo`) AS `len` FROM `app_db`.`assets` WHERE `uuid` = ? LIMIT 1";
        const VAL_SQL: &str =
            "SELECT `photo` AS `val` FROM `app_db`.`assets` WHERE `uuid` = ? LIMIT 1";

        let raw: &'static [u8] = b"\x89PNG\r\n\x1a\nbinary-pk-blob";
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
            &[("uuid".to_string(), pk_envelope())],
        )
        .await
        .expect("blob fetch with enveloped binary PK should succeed");

        pool.close().await;

        assert_eq!(resp.base64, Some(B64.encode(raw)));
        assert_eq!(resp.byte_length, raw.len() as u64);
        assert!(!resp.too_large);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_blob_value_with_composite_binary_and_int_pk_returns_bytes() {
        // Order of `pk_pairs` is preserved: `tenant_id = ? AND uuid = ?`.
        const LEN_SQL: &str = "SELECT OCTET_LENGTH(`photo`) AS `len` FROM `app_db`.`assets` WHERE `tenant_id` = ? AND `uuid` = ? LIMIT 1";
        const VAL_SQL: &str = "SELECT `photo` AS `val` FROM `app_db`.`assets` WHERE `tenant_id` = ? AND `uuid` = ? LIMIT 1";

        let raw: &'static [u8] = b"composite-key-blob-bytes";
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
            &[
                ("tenant_id".to_string(), json!(42)),
                ("uuid".to_string(), pk_envelope()),
            ],
        )
        .await
        .expect("composite-key blob fetch with enveloped binary PK should succeed");

        pool.close().await;

        assert_eq!(resp.base64, Some(B64.encode(raw)));
        assert_eq!(resp.byte_length, raw.len() as u64);
        assert!(!resp.too_large);
    }

    // ── Pure bytes-vs-string decode contract (KD6) ───────────────────────────

    #[test]
    fn blob_envelope_decodes_to_bytes_bind() {
        // Documents the contract the mock cannot verify: the same `bytes`
        // envelope that the write/read paths receive decodes to real bytes,
        // not a literal string, so it binds as `WHERE <pk> = <bytes>`.
        let decoded = decode_blob_envelope(&pk_envelope())
            .expect("value is a recognised blob envelope")
            .expect("well-formed envelope should decode");

        assert_eq!(decoded, BlobBind::Bytes(PK_BYTES.to_vec()));
    }
}
