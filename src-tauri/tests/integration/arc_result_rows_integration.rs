//! Phase 1 (HP-1) de-risk tests: prove that enabling serde's `rc` feature makes
//! `Arc<Vec<Vec<serde_json::Value>>>` (de)serialize transparently to the plain
//! `Vec<Vec<serde_json::Value>>` for both JSON (IPC shape) and MessagePack (disk spill).
//!
//! These tests lock down the single external-behavior assumption the whole
//! Arc-shared-rows migration depends on, before any result type is changed.

use std::sync::Arc;

use serde_json::{json, Value};

/// A representative rows buffer mixing every value kind the cache/spill path
/// must round-trip: integers, floats, strings, nulls, and booleans.
fn sample_rows() -> Vec<Vec<Value>> {
    vec![
        vec![
            json!(1),
            json!("alice"),
            json!(true),
            json!(3.14),
            Value::Null,
        ],
        vec![
            json!(-42),
            json!("bob"),
            json!(false),
            json!(0.0),
            json!("not-null"),
        ],
        vec![
            json!(9_223_372_036_854_775_807i64),
            json!(""),
            json!(true),
            json!(1.5e-10),
            Value::Null,
        ],
    ]
}

#[test]
fn arc_json_serialization_matches_plain_vec() {
    // IPC-shape parity: serializing an Arc-wrapped rows buffer must produce the
    // exact same JSON Value as serializing the plain Vec.
    let rows = sample_rows();
    let arc_rows = Arc::new(rows.clone());

    let plain_value = serde_json::to_value(&rows).expect("serialize plain Vec");
    let arc_value = serde_json::to_value(&arc_rows).expect("serialize Arc");

    assert_eq!(
        arc_value, plain_value,
        "Arc<rows> JSON must be identical to plain Vec JSON"
    );

    // And the JSON must be the expected array-of-arrays shape.
    assert!(plain_value.is_array(), "rows JSON should be an array");
    assert_eq!(
        plain_value.as_array().unwrap().len(),
        rows.len(),
        "row count preserved in JSON"
    );
}

#[test]
fn arc_msgpack_roundtrip_reproduces_rows_exactly() {
    // Spill parity: rmp_serde::to_vec_named on an Arc-wrapped value then
    // from_slice back into Arc<...> must reproduce the rows exactly, including
    // integer/float/string/null/bool fidelity.
    let rows = sample_rows();
    let arc_rows = Arc::new(rows.clone());

    let bytes = rmp_serde::to_vec_named(&arc_rows).expect("msgpack serialize Arc");
    let decoded: Arc<Vec<Vec<Value>>> =
        rmp_serde::from_slice(&bytes).expect("msgpack deserialize into Arc");

    assert_eq!(
        *decoded, rows,
        "Arc msgpack round-trip must reproduce rows exactly"
    );
}

#[test]
fn arc_and_plain_vec_msgpack_bytes_are_identical() {
    // The on-disk MessagePack bytes for the Arc-wrapped value must be byte-for-byte
    // identical to those for the plain Vec, confirming the spill format is unchanged.
    let rows = sample_rows();
    let arc_rows = Arc::new(rows.clone());

    let plain_bytes = rmp_serde::to_vec_named(&rows).expect("msgpack serialize plain Vec");
    let arc_bytes = rmp_serde::to_vec_named(&arc_rows).expect("msgpack serialize Arc");

    assert_eq!(
        arc_bytes, plain_bytes,
        "Arc<rows> MessagePack bytes must be identical to plain Vec bytes"
    );
}

#[test]
fn wire_cross_compatibility_both_directions() {
    // Cross-compatibility of the wire shape:
    //   plain Vec -> bytes -> Arc<...>   (re-warm of pre-existing spill)
    //   Arc<...>  -> bytes -> plain Vec  (forward compatibility)
    let rows = sample_rows();

    // JSON: plain -> Arc
    let plain_json = serde_json::to_vec(&rows).expect("json serialize plain Vec");
    let arc_from_plain: Arc<Vec<Vec<Value>>> =
        serde_json::from_slice(&plain_json).expect("json deserialize plain into Arc");
    assert_eq!(*arc_from_plain, rows, "JSON plain -> Arc must match");

    // JSON: Arc -> plain
    let arc_rows = Arc::new(rows.clone());
    let arc_json = serde_json::to_vec(&arc_rows).expect("json serialize Arc");
    let plain_from_arc: Vec<Vec<Value>> =
        serde_json::from_slice(&arc_json).expect("json deserialize Arc into plain");
    assert_eq!(plain_from_arc, rows, "JSON Arc -> plain must match");

    // MessagePack: plain -> Arc
    let plain_mp = rmp_serde::to_vec_named(&rows).expect("msgpack serialize plain Vec");
    let arc_from_plain_mp: Arc<Vec<Vec<Value>>> =
        rmp_serde::from_slice(&plain_mp).expect("msgpack deserialize plain into Arc");
    assert_eq!(
        *arc_from_plain_mp, rows,
        "MessagePack plain -> Arc must match"
    );

    // MessagePack: Arc -> plain
    let arc_mp = rmp_serde::to_vec_named(&arc_rows).expect("msgpack serialize Arc");
    let plain_from_arc_mp: Vec<Vec<Value>> =
        rmp_serde::from_slice(&arc_mp).expect("msgpack deserialize Arc into plain");
    assert_eq!(
        plain_from_arc_mp, rows,
        "MessagePack Arc -> plain must match"
    );
}
