//! Cache lookup status shared by result and table-data cache IPC responses.

use sqllumen_lib::mysql::cache_status::{cache_status_json, CacheStatus};
use sqllumen_lib::mysql::result_cache::CacheGet;

#[test]
fn cache_status_serializes_to_the_lowercase_wire_strings() {
    let cases = [
        (CacheStatus::Available, "available"),
        (CacheStatus::Expired, "expired"),
        (CacheStatus::Missing, "missing"),
        (CacheStatus::Synced, "synced"),
    ];
    for (status, wire) in cases {
        assert_eq!(serde_json::to_value(status).expect("serialize"), wire);
        let parsed: CacheStatus = serde_json::from_value(serde_json::json!(wire)).expect("parse");
        assert_eq!(parsed, status);
    }
}

#[test]
fn cache_status_json_wraps_the_status_in_an_object() {
    assert_eq!(
        cache_status_json(CacheStatus::Expired),
        serde_json::json!({ "status": "expired" })
    );
}

#[test]
fn lookup_status_maps_missing_cache_entries() {
    assert_eq!(
        CacheGet::<u8>::Expired.lookup_status(),
        CacheStatus::Expired
    );
    assert_eq!(
        CacheGet::<u8>::NeverStored.lookup_status(),
        CacheStatus::Missing
    );
}
