use std::collections::HashMap;

/// Given the stored `(chunk_key, ddl_hash)` pairs and new DDL inputs,
/// determine which chunks are new, changed, or unchanged.
///
/// Returns `(to_embed, to_delete_keys)`:
/// - `to_embed`: `Vec<(chunk_key, ddl_text, ddl_hash, ChunkType, db, table, ref_db, ref_table)>` — new or changed
/// - `to_delete_keys`: `Vec<String>` — chunk keys that existed before but are no longer present
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkDiff {
    pub needs_embed: Vec<String>,
    pub to_delete: Vec<String>,
}

pub fn diff_chunks(
    stored_hashes: &[(String, String)],
    new_chunks: &[(String, String, String)], // (chunk_key, ddl_text, ddl_hash)
) -> ChunkDiff {
    let stored_map: HashMap<&str, &str> = stored_hashes
        .iter()
        .map(|(key, hash)| (key.as_str(), hash.as_str()))
        .collect();

    let new_map: HashMap<&str, &str> = new_chunks
        .iter()
        .map(|(key, _text, hash)| (key.as_str(), hash.as_str()))
        .collect();

    let needs_embed = new_map
        .iter()
        .filter(|(key, hash)| stored_map.get(*key) != Some(*hash))
        .map(|(key, _hash)| key.to_string())
        .collect();

    let to_delete = stored_map
        .keys()
        .filter(|key| !new_map.contains_key(*key))
        .map(|key| key.to_string())
        .collect();

    ChunkDiff {
        needs_embed,
        to_delete,
    }
}

/// Outcome of the signature-based partition for a single table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureDecision {
    /// The stored signature matches and a `table:` chunk already exists;
    /// the caller can reuse the stored DDL text without calling
    /// `SHOW CREATE TABLE`.
    Reuse,
    /// Signature differs, is missing, or the expected chunk is gone — the
    /// caller must fetch fresh DDL via `SHOW CREATE TABLE`.
    Refetch,
}

pub fn is_signature_unchanged(current_sig: Option<&str>, stored_sig: Option<&str>) -> bool {
    current_sig.is_some() && current_sig == stored_sig
}

/// Decide whether a single `(db_name, table_name)` can be short-circuited.
///
/// `current_sig` is the freshly computed signature for this table (or `None`
/// if absent from `current_signatures`, which typically means the table is
/// brand new in this pass). `stored_sig` is the previously persisted
/// signature. `chunk_exists` must be true iff a `table:` chunk for this table
/// is present in the `schema_index_chunks` SQLite store.
pub fn decide_signature_action(
    current_sig: Option<&str>,
    stored_sig: Option<&str>,
    chunk_exists: bool,
) -> SignatureDecision {
    let has_unchanged_signature = is_signature_unchanged(current_sig, stored_sig);
    if has_unchanged_signature && chunk_exists {
        return SignatureDecision::Reuse;
    }
    SignatureDecision::Refetch
}
