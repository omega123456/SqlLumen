//! Unit tests for blob-envelope decoding used by the table-data value binder.
//!
//! `bind_json_value` is MySQL-specific (`Query<'q, sqlx::MySql, ...>`), so the
//! envelope-binding decision cannot be exercised through in-memory SQLite. The
//! envelope detection/decode logic is factored into the pure, DB-free helpers
//! `decode_blob_envelope` and `validate_blob_envelopes`, which are tested here.

#[cfg(not(coverage))]
mod blob_value_bind_integration {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use serde_json::json;
    use sqllumen_lib::mysql::table_data::{
        decode_blob_envelope, validate_blob_envelopes, BlobBind,
    };
    use std::collections::HashMap;

    fn bytes_envelope(b64: &str) -> serde_json::Value {
        json!({ "__sqllumen_blob__": true, "kind": "bytes", "base64": b64 })
    }

    #[test]
    fn decodes_bytes_envelope_to_raw_bytes() {
        let raw = b"\x89PNG\r\n\x1a\n".to_vec();
        let env = bytes_envelope(&B64.encode(&raw));
        let decoded = decode_blob_envelope(&env).expect("should be an envelope");
        assert_eq!(decoded, Ok(BlobBind::Bytes(raw)));
    }

    #[test]
    fn decodes_empty_envelope() {
        let env = json!({ "__sqllumen_blob__": true, "kind": "empty" });
        assert_eq!(decode_blob_envelope(&env), Some(Ok(BlobBind::Empty)));
    }

    #[test]
    fn decodes_null_envelope() {
        let env = json!({ "__sqllumen_blob__": true, "kind": "null" });
        assert_eq!(decode_blob_envelope(&env), Some(Ok(BlobBind::Null)));
    }

    #[test]
    fn non_envelope_values_are_ignored() {
        assert_eq!(decode_blob_envelope(&json!("hello")), None);
        assert_eq!(decode_blob_envelope(&json!(42)), None);
        assert_eq!(decode_blob_envelope(&serde_json::Value::Null), None);
        // A plain object without the marker is not an envelope.
        assert_eq!(decode_blob_envelope(&json!({ "kind": "bytes" })), None);
        // Marker present but not `true`.
        assert_eq!(
            decode_blob_envelope(&json!({ "__sqllumen_blob__": false, "kind": "null" })),
            None
        );
    }

    #[test]
    fn malformed_base64_produces_error_not_panic() {
        let env = bytes_envelope("not valid base64!!!");
        let decoded = decode_blob_envelope(&env).expect("marker present → recognised as envelope");
        assert!(decoded.is_err(), "malformed base64 should be an error");
    }

    #[test]
    fn bytes_envelope_missing_base64_is_error() {
        let env = json!({ "__sqllumen_blob__": true, "kind": "bytes" });
        let decoded = decode_blob_envelope(&env).expect("marker present");
        assert!(decoded.is_err());
    }

    #[test]
    fn missing_kind_is_error() {
        let env = json!({ "__sqllumen_blob__": true });
        let decoded = decode_blob_envelope(&env).expect("marker present");
        assert!(decoded.is_err());
    }

    #[test]
    fn unknown_kind_is_error() {
        let env = json!({ "__sqllumen_blob__": true, "kind": "wat" });
        let decoded = decode_blob_envelope(&env).expect("marker present");
        assert!(decoded.is_err());
    }

    #[test]
    fn validate_passes_for_well_formed_values() {
        let mut values: HashMap<String, serde_json::Value> = HashMap::new();
        values.insert("photo".to_string(), bytes_envelope(&B64.encode(b"abc")));
        values.insert(
            "thumb".to_string(),
            json!({ "__sqllumen_blob__": true, "kind": "null" }),
        );
        values.insert("name".to_string(), json!("plain string"));
        assert!(validate_blob_envelopes(&values).is_ok());
    }

    #[test]
    fn validate_reports_column_for_malformed_envelope() {
        let mut values: HashMap<String, serde_json::Value> = HashMap::new();
        values.insert("photo".to_string(), bytes_envelope("###bad###"));
        let err = validate_blob_envelopes(&values).expect_err("malformed envelope should error");
        assert!(err.contains("photo"), "error should name the column: {err}");
    }
}
