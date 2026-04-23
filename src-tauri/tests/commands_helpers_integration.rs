mod common;

use sqllumen_lib::commands::helpers::resolve_session_profile;

#[test]
fn resolve_session_profile_returns_mapping_from_session_profile_map() {
    let state = common::test_app_state();
    state
        .session_profile_map
        .lock()
        .expect("session_profile_map lock")
        .insert("sess-1".to_string(), "profile-1".to_string());

    let resolved = resolve_session_profile(&state, "sess-1").expect("profile should resolve");
    assert_eq!(resolved, "profile-1");
}

#[test]
fn resolve_session_profile_returns_not_found_when_session_missing() {
    let state = common::test_app_state();
    let error = resolve_session_profile(&state, "missing-session").expect_err("must fail");
    assert!(
        error.contains("not found"),
        "expected missing-session error, got: {error}"
    );
}
