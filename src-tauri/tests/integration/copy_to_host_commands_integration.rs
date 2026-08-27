//! Integration tests for the copy-to-host command module (Phase 1).
//!
//! Covers the object-enumeration shaping helpers (grouping into five categories,
//! view exclusion, system-schema exclusion, routine splitting), the `_impl`
//! error paths, the `CopyJobProgress` camelCase serialization, and source-level
//! structural guarantees (every query path logs through `query_log`, no views or
//! system schemas are ever enumerated).

use crate::common;

use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
use sqllumen_lib::commands::copy_to_host::{
    build_copyable_tables, cancel_copy_impl, collect_names, get_copy_progress_impl, is_base_table,
    is_same_host, is_system_schema, list_copyable_objects_impl, normalize_host, split_routines,
    start_copy_to_host_impl, CopyableObjects, CopyableTable,
};
use sqllumen_lib::export::copy_to_host::{
    CopyOptions, CopySelection, CopyToHostParams, InsertMode,
};
use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use sqllumen_lib::state::{AppState, CopyJobProgress, CopyJobStatus};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use tokio_util::sync::CancellationToken;

// ── Pure shaping helpers: tables ──────────────────────────────────────────

#[test]
fn test_build_copyable_tables_keeps_base_tables_with_rows() {
    let rows = vec![
        ("users".to_string(), "BASE TABLE".to_string(), 42),
        ("orders".to_string(), "BASE TABLE".to_string(), 0),
    ];
    let tables = build_copyable_tables(&rows);
    assert_eq!(
        tables,
        vec![
            CopyableTable {
                name: "users".to_string(),
                estimated_rows: 42,
            },
            CopyableTable {
                name: "orders".to_string(),
                estimated_rows: 0,
            },
        ]
    );
}

#[test]
fn test_build_copyable_tables_excludes_views() {
    let rows = vec![
        ("users".to_string(), "BASE TABLE".to_string(), 10),
        ("user_stats".to_string(), "VIEW".to_string(), 0),
        ("sys_view".to_string(), "SYSTEM VIEW".to_string(), 0),
    ];
    let tables = build_copyable_tables(&rows);
    let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, vec!["users"]);
}

#[test]
fn test_build_copyable_tables_clamps_negative_rows_and_skips_empty_names() {
    let rows = vec![
        ("t".to_string(), "BASE TABLE".to_string(), -5),
        (String::new(), "BASE TABLE".to_string(), 3),
    ];
    let tables = build_copyable_tables(&rows);
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "t");
    assert_eq!(tables[0].estimated_rows, 0);
}

// ── Pure shaping helpers: routines ────────────────────────────────────────

#[test]
fn test_split_routines_groups_procedures_and_functions() {
    let rows = vec![
        ("sp_recalc".to_string(), "PROCEDURE".to_string()),
        ("fn_total".to_string(), "FUNCTION".to_string()),
        ("sp_purge".to_string(), "procedure".to_string()),
        ("fn_avg".to_string(), "function".to_string()),
    ];
    let (procedures, functions) = split_routines(&rows);
    assert_eq!(procedures, vec!["sp_recalc", "sp_purge"]);
    assert_eq!(functions, vec!["fn_total", "fn_avg"]);
}

#[test]
fn test_split_routines_ignores_unknown_and_empty() {
    let rows = vec![
        ("weird".to_string(), "SOMETHING".to_string()),
        (String::new(), "PROCEDURE".to_string()),
    ];
    let (procedures, functions) = split_routines(&rows);
    assert!(procedures.is_empty());
    assert!(functions.is_empty());
}

// ── Pure shaping helpers: names ───────────────────────────────────────────

#[test]
fn test_collect_names_filters_empty() {
    let rows = vec![
        "trg_audit".to_string(),
        String::new(),
        "trg_log".to_string(),
    ];
    assert_eq!(collect_names(&rows), vec!["trg_audit", "trg_log"]);
}

// ── Classification helpers ────────────────────────────────────────────────

#[test]
fn test_is_base_table_classification() {
    assert!(is_base_table("BASE TABLE"));
    assert!(!is_base_table("VIEW"));
    assert!(!is_base_table("SYSTEM VIEW"));
    assert!(!is_base_table("view"));
}

#[test]
fn test_is_system_schema_classification() {
    assert!(is_system_schema("mysql"));
    assert!(is_system_schema("INFORMATION_SCHEMA"));
    assert!(is_system_schema("performance_schema"));
    assert!(is_system_schema("sys"));
    assert!(!is_system_schema("shop"));
    assert!(!is_system_schema("my_app"));
}

// ── `_impl` error paths (no live MySQL pool required) ─────────────────────

#[tokio::test]
async fn test_list_copyable_objects_rejects_system_schema() {
    let state = common::test_app_state();
    let result = list_copyable_objects_impl(&state, "conn-1", "mysql").await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("system schema"), "unexpected error: {err}");
}

#[tokio::test]
async fn test_list_copyable_objects_missing_connection_errors() {
    let state = common::test_app_state();
    let result = list_copyable_objects_impl(&state, "no-such-conn", "shop").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found in registry"));
}

// ── IPC serialization shape ───────────────────────────────────────────────

#[test]
fn test_copyable_objects_serializes_to_camel_case() {
    let objects = CopyableObjects {
        tables: vec![CopyableTable {
            name: "users".to_string(),
            estimated_rows: 7,
        }],
        procedures: vec!["sp_recalc".to_string()],
        functions: vec!["fn_total".to_string()],
        triggers: vec!["trg_audit".to_string()],
        events: vec!["ev_nightly".to_string()],
    };
    let json = serde_json::to_value(&objects).expect("serialize CopyableObjects");
    assert_eq!(json["tables"][0]["name"], "users");
    assert_eq!(json["tables"][0]["estimatedRows"], 7);
    assert_eq!(json["procedures"][0], "sp_recalc");
    assert_eq!(json["functions"][0], "fn_total");
    assert_eq!(json["triggers"][0], "trg_audit");
    assert_eq!(json["events"][0], "ev_nightly");
    // snake_case must not leak over IPC
    assert!(json["tables"][0].get("estimated_rows").is_none());
}

#[test]
fn test_copy_job_progress_serializes_to_camel_case() {
    let progress = CopyJobProgress {
        job_id: "job-1".to_string(),
        status: CopyJobStatus::Running,
        objects_total: 12,
        objects_done: 3,
        current_object: Some("orders".to_string()),
        current_object_type: Some("table".to_string()),
        rows_total: Some(50_000),
        rows_done: Some(15_420),
        error_message: None,
        cancel_requested: false,
        completed_at: None,
    };
    let json = serde_json::to_value(&progress).expect("serialize CopyJobProgress");
    assert_eq!(json["jobId"], "job-1");
    assert_eq!(json["status"], "running");
    assert_eq!(json["objectsTotal"], 12);
    assert_eq!(json["objectsDone"], 3);
    assert_eq!(json["currentObject"], "orders");
    assert_eq!(json["currentObjectType"], "table");
    assert_eq!(json["rowsTotal"], 50_000);
    assert_eq!(json["rowsDone"], 15_420);
    assert_eq!(json["cancelRequested"], false);
    // `completed_at` is `#[serde(skip)]`
    assert!(json.get("completedAt").is_none());
    assert!(json.get("completed_at").is_none());
}

#[test]
fn test_copy_job_status_serializes_lowercase() {
    assert_eq!(
        serde_json::to_value(CopyJobStatus::Completed).unwrap(),
        "completed"
    );
    assert_eq!(
        serde_json::to_value(CopyJobStatus::Failed).unwrap(),
        "failed"
    );
    assert_eq!(
        serde_json::to_value(CopyJobStatus::Cancelled).unwrap(),
        "cancelled"
    );
}

// ── AppState scaffolding ──────────────────────────────────────────────────

#[test]
fn test_app_state_exposes_copy_jobs_map() {
    let state = common::test_app_state();
    let jobs = state.copy_jobs.read().expect("copy_jobs lock");
    assert!(jobs.is_empty());
}

// ── Source-level structural guarantees ────────────────────────────────────

#[test]
fn test_enumeration_excludes_views_in_source() {
    let source = include_str!("../../src/commands/copy_to_host.rs");
    assert!(
        source.contains("TABLE_TYPE = 'BASE TABLE'"),
        "tables query must filter to base tables (exclude views)"
    );
}

#[test]
fn test_enumeration_excludes_system_schemas_in_source() {
    let source = include_str!("../../src/commands/copy_to_host.rs");
    // Every information_schema query must guard against system schemas.
    let occurrences = source
        .matches("NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')")
        .count();
    assert!(
        occurrences >= 4,
        "all five-category queries must exclude system schemas (found {occurrences})"
    );
}

#[test]
fn test_enumeration_logs_through_query_log_helper() {
    let source = include_str!("../../src/commands/copy_to_host.rs");
    let occurrences = source.matches("query_log::log_outgoing_sql").count();
    assert!(
        occurrences >= 4,
        "every enumeration query must log via query_log (found {occurrences})"
    );
}

// ── Same-host comparison helpers ──────────────────────────────────────────

#[test]
fn test_normalize_host_trims_and_lowercases() {
    assert_eq!(normalize_host("  Db.Example.COM "), "db.example.com");
    assert_eq!(normalize_host("127.0.0.1"), "127.0.0.1");
}

#[test]
fn test_is_same_host_is_case_and_whitespace_insensitive() {
    assert!(is_same_host("localhost", "LOCALHOST"));
    assert!(is_same_host("db.example.com", " db.example.com "));
    assert!(!is_same_host("staging-db", "prod-db"));
    assert!(!is_same_host("10.0.0.1", "10.0.0.2"));
}

// ── start / progress / cancel helpers ─────────────────────────────────────

/// A lazy MySQL pool that never actually connects — sufficient for registry
/// entries whose host is read for validation but whose pool is never used by the
/// command `_impl` paths under test.
fn dummy_lazy_pool(host: &str) -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host(host)
        .port(3306)
        .username("dummy")
        .password("dummy");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

fn dummy_stored_params(profile_id: &str, host: &str) -> StoredConnectionParams {
    StoredConnectionParams {
        profile_id: profile_id.to_string(),
        host: host.to_string(),
        port: 3306,
        username: "dummy".to_string(),
        has_password: false,
        keychain_ref: None,
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        connect_timeout_secs: 10,
        keepalive_interval_secs: 0,
    }
}

/// Register a source session in the registry bound to `host`.
fn register_source(state: &AppState, session_id: &str, host: &str) {
    let entry = RegistryEntry {
        pool: dummy_lazy_pool(host),
        session_id: session_id.to_string(),
        profile_id: format!("{session_id}-profile"),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: CancellationToken::new(),
        connection_params: dummy_stored_params(session_id, host),
        read_only: false,
    };
    state.registry.insert(session_id.to_string(), entry);
}

/// Save a target connection profile with `host` and return its id.
fn save_target(state: &AppState, name: &str, host: &str) -> String {
    save_target_with_read_only(state, name, host, false)
}

fn save_target_with_read_only(state: &AppState, name: &str, host: &str, read_only: bool) -> String {
    let input = SaveConnectionInput {
        name: name.to_string(),
        host: host.to_string(),
        port: 3306,
        username: "root".to_string(),
        password: None,
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        color: None,
        group_id: None,
        read_only,
        sort_order: 0,
        connect_timeout_secs: Some(10),
        keepalive_interval_secs: Some(60),
    };
    save_connection_impl(state, input).expect("should save target connection")
}

fn sample_params(source_id: &str, target_id: &str) -> CopyToHostParams {
    CopyToHostParams {
        source_connection_id: source_id.to_string(),
        source_database: "shop".to_string(),
        target_connection_id: target_id.to_string(),
        target_database: "shop_copy".to_string(),
        objects: CopySelection {
            tables: vec!["users".to_string(), "orders".to_string()],
            procedures: vec!["sp_recalc".to_string()],
            functions: vec![],
            triggers: vec![],
            events: vec![],
        },
        options: CopyOptions {
            copy_structure: true,
            copy_data: true,
            drop_if_exists: false,
            create_if_not_exists: false,
            truncate_before_insert: false,
            insert_mode: InsertMode::Insert,
            ignore_definer: true,
        },
    }
}

fn table_only_params(source_id: &str, target_id: &str) -> CopyToHostParams {
    let mut params = sample_params(source_id, target_id);
    params.objects = CopySelection {
        tables: vec!["users".to_string(), "orders".to_string()],
        procedures: vec![],
        functions: vec![],
        triggers: vec![],
        events: vec![],
    };
    params
}

#[tokio::test]
async fn test_start_copy_rejects_same_host() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "shared-host");
    let target_id = save_target(&state, "target", "shared-host");

    let params = sample_params("src-session", &target_id);
    let result = start_copy_to_host_impl(&state, params);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("same host"),
        "expected same-host rejection, got: {err}"
    );

    // No job should have been registered on rejection.
    let jobs = state.copy_jobs.read().expect("copy_jobs lock");
    assert!(jobs.is_empty(), "rejected copy must not register a job");
}

#[tokio::test]
async fn test_start_copy_rejects_target_system_schema() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let mut params = sample_params("src-session", &target_id);
    params.objects = CopySelection {
        tables: vec!["users".to_string()],
        procedures: vec![],
        functions: vec![],
        triggers: vec![],
        events: vec![],
    };
    params.target_database = "mysql".to_string();

    let error = start_copy_to_host_impl(&state, params)
        .expect_err("target system schemas must be rejected before starting");
    assert!(error.contains("system schema"));
}

#[tokio::test]
async fn test_start_copy_rejects_source_system_schema() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let mut params = table_only_params("src-session", &target_id);
    params.source_database = "performance_schema".to_string();

    let error = start_copy_to_host_impl(&state, params)
        .expect_err("source system schemas must be rejected before starting");
    assert!(error.contains("Source database"));
    assert!(error.contains("system schema"));
}

#[tokio::test]
async fn test_start_copy_allows_cross_database_non_table_objects() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let params = sample_params("src-session", &target_id);
    let job_id = start_copy_to_host_impl(&state, params.clone())
        .expect("cross-database non-table copies should start");

    let jobs = state.copy_jobs.read().expect("copy_jobs lock");
    let progress = jobs.get(&job_id).expect("job should be registered");
    assert_eq!(progress.objects_total, params.objects.total());
}

#[tokio::test]
async fn test_start_copy_rejects_same_host_case_insensitive() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "DB.Example.com");
    let target_id = save_target(&state, "target", "db.example.com");

    let params = table_only_params("src-session", &target_id);
    let result = start_copy_to_host_impl(&state, params);
    assert!(
        result.is_err(),
        "host comparison must be case-insensitive: {result:?}"
    );
}

#[tokio::test]
async fn test_start_copy_registers_job_and_returns_id() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let params = table_only_params("src-session", &target_id);
    let job_id = start_copy_to_host_impl(&state, params.clone()).expect("should start copy");
    assert!(!job_id.is_empty());

    let jobs = state.copy_jobs.read().expect("copy_jobs lock");
    let progress = jobs.get(&job_id).expect("job should be registered");
    assert_eq!(progress.status, CopyJobStatus::Running);
    assert_eq!(progress.objects_total, params.objects.total());
    assert_eq!(progress.objects_done, 0);
    assert!(!progress.cancel_requested);
}

#[tokio::test]
async fn test_start_copy_unknown_source_errors() {
    let state = common::test_app_state();
    let target_id = save_target(&state, "target", "target-host");
    let params = sample_params("no-such-source", &target_id);
    let result = start_copy_to_host_impl(&state, params);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Source connection"));
}

#[tokio::test]
async fn test_start_copy_unknown_target_errors() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let params = sample_params("src-session", "no-such-target");
    let result = start_copy_to_host_impl(&state, params);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Target connection"));
}

#[tokio::test]
async fn test_start_copy_rejects_read_only_target_before_job_registration() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target_with_read_only(&state, "readonly target", "target-host", true);

    let params = table_only_params("src-session", &target_id);
    let result = start_copy_to_host_impl(&state, params);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("read-only"), "unexpected error: {err}");

    let jobs = state.copy_jobs.read().expect("copy_jobs lock");
    assert!(jobs.is_empty(), "rejected copy must not register a job");
}

#[tokio::test]
async fn test_start_copy_allows_data_only_non_table_selection() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let mut params = sample_params("src-session", &target_id);
    params.options.copy_structure = false;
    params.options.copy_data = true;

    let result = start_copy_to_host_impl(&state, params);
    assert!(
        result.is_ok(),
        "data-only non-table selections should be accepted"
    );

    let jobs = state.copy_jobs.read().expect("copy_jobs lock");
    assert_eq!(jobs.len(), 1, "accepted copy must register a job");
}

#[tokio::test]
async fn test_start_copy_rejects_empty_selection() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let mut params = sample_params("src-session", &target_id);
    params.objects = CopySelection::default();

    let error = start_copy_to_host_impl(&state, params).expect_err("empty jobs are no-ops");
    assert!(error.contains("Select at least one object"));
    assert!(state.copy_jobs.read().expect("copy_jobs lock").is_empty());
}

#[tokio::test]
async fn test_start_copy_rejects_table_only_without_structure_or_data() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let mut params = table_only_params("src-session", &target_id);
    params.options.copy_structure = false;
    params.options.copy_data = false;

    let error = start_copy_to_host_impl(&state, params).expect_err("table-only job is no-op");
    assert!(error.contains("would do nothing"));
    assert!(state.copy_jobs.read().expect("copy_jobs lock").is_empty());
}

#[tokio::test]
async fn test_start_copy_allows_non_table_when_structure_and_data_disabled() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let mut params = sample_params("src-session", &target_id);
    params.objects.tables.clear();
    params.options.copy_structure = false;
    params.options.copy_data = false;

    let job_id = start_copy_to_host_impl(&state, params).expect("non-tables are structural");
    assert!(!job_id.is_empty());
}

#[tokio::test]
async fn test_get_copy_progress_returns_stored_progress() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let params = table_only_params("src-session", &target_id);
    let job_id = start_copy_to_host_impl(&state, params).expect("should start copy");

    let progress = get_copy_progress_impl(&state, &job_id).expect("progress should exist");
    assert_eq!(progress.job_id, job_id);
    assert_eq!(progress.status, CopyJobStatus::Running);
}

#[test]
fn test_get_copy_progress_unknown_job_errors() {
    let state = common::test_app_state();
    let result = get_copy_progress_impl(&state, "no-such-job");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[tokio::test]
async fn test_cancel_copy_sets_cancel_requested() {
    let state = common::test_app_state();
    register_source(&state, "src-session", "source-host");
    let target_id = save_target(&state, "target", "target-host");

    let params = table_only_params("src-session", &target_id);
    let job_id = start_copy_to_host_impl(&state, params).expect("should start copy");

    cancel_copy_impl(&state, &job_id).expect("cancel should succeed");

    let progress = get_copy_progress_impl(&state, &job_id).expect("progress should exist");
    assert!(
        progress.cancel_requested,
        "cancel must set cancel_requested"
    );
}

#[test]
fn test_cancel_copy_unknown_job_errors() {
    let state = common::test_app_state();
    let result = cancel_copy_impl(&state, "no-such-job");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}
