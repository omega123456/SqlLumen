use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkDiff {
    pub needs_embed: Vec<String>,
    pub to_delete: Vec<String>,
}

pub fn diff_chunks(
    stored_hashes: &[(String, String)],
    new_chunks: &[(String, String, String)],
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureDecision {
    Reuse,
    Refetch,
}

pub fn is_signature_unchanged(current_sig: Option<&str>, stored_sig: Option<&str>) -> bool {
    current_sig.is_some() && current_sig == stored_sig
}

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
