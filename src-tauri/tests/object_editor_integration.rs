//! Integration tests for object editor commands (`commands/object_editor.rs`).
//!
//! Pure logic (`parse_ddl_name`, `validate_view_ddl_prefix`, validation checks)
//! and command paths that fail before touching the network (missing connection,
//! read-only guard, identifier validation, name mismatch) run without MySQL.

mod common;

use sqllumen_lib::commands::object_editor::{
    drop_object_impl, get_object_body_impl, get_routine_parameters_impl,
    get_routine_parameters_with_return_type_impl, parse_ddl_name, save_object_impl,
    validate_view_ddl_prefix, SaveObjectRequest,
};
use sqllumen_lib::mysql::registry::{ConnectionStatus, RegistryEntry, StoredConnectionParams};
use sqllumen_lib::state::AppState;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use tokio_util::sync::CancellationToken;

fn dummy_lazy_pool() -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(13306)
        .username("dummy")
        .password("dummy");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

fn dummy_stored_params() -> StoredConnectionParams {
    StoredConnectionParams {
        profile_id: "profile-oe-test".to_string(),
        host: "127.0.0.1".to_string(),
        port: 13306,
        username: "dummy".to_string(),
        has_password: true,
        keychain_ref: Some("dummy".to_string()),
        default_database: None,
        ssl_enabled: false,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        connect_timeout_secs: 10,
        keepalive_interval_secs: 60,
    }
}

fn register_lazy_pool(state: &AppState, connection_id: &str, read_only: bool) {
    let entry = RegistryEntry {
        pool: dummy_lazy_pool(),
        session_id: connection_id.to_string(),
        profile_id: "profile-oe-test".to_string(),
        status: ConnectionStatus::Connected,
        server_version: "8.0.0".to_string(),
        cancellation_token: CancellationToken::new(),
        connection_params: dummy_stored_params(),
        read_only,
    };
    state.registry.insert(connection_id.to_string(), entry);
}

fn make_request(
    connection_id: &str,
    database: &str,
    object_name: &str,
    object_type: &str,
    body: &str,
    mode: &str,
) -> SaveObjectRequest {
    SaveObjectRequest {
        connection_id: connection_id.to_string(),
        database: database.to_string(),
        object_name: object_name.to_string(),
        object_type: object_type.to_string(),
        body: body.to_string(),
        mode: mode.to_string(),
    }
}

// ===========================================================================
// parse_ddl_name — pure tests (no MySQL needed)
// ===========================================================================

#[test]
fn test_parse_ddl_name_simple_procedure() {
    let (db, name, type_kw) = parse_ddl_name("CREATE PROCEDURE `my_proc`() BEGIN END").unwrap();
    assert!(db.is_none());
    assert_eq!(name, "my_proc");
    assert_eq!(type_kw, "PROCEDURE");
}

#[test]
fn test_parse_ddl_name_function() {
    let (db, name, type_kw) =
        parse_ddl_name("CREATE FUNCTION `calc`(x INT) RETURNS INT BEGIN RETURN x; END").unwrap();
    assert!(db.is_none());
    assert_eq!(name, "calc");
    assert_eq!(type_kw, "FUNCTION");
}

#[test]
fn test_parse_ddl_name_view_or_replace() {
    let (db, name, type_kw) =
        parse_ddl_name("CREATE OR REPLACE VIEW `my_view` AS SELECT 1").unwrap();
    assert!(db.is_none());
    assert_eq!(name, "my_view");
    assert_eq!(type_kw, "VIEW");
}

#[test]
fn test_parse_ddl_name_view_simple() {
    let (db, name, type_kw) = parse_ddl_name("CREATE VIEW `v1` AS SELECT 1").unwrap();
    assert!(db.is_none());
    assert_eq!(name, "v1");
    assert_eq!(type_kw, "VIEW");
}

#[test]
fn test_parse_ddl_name_with_database_qualifier() {
    let (db, name, type_kw) =
        parse_ddl_name("CREATE PROCEDURE `mydb`.`my_proc`() BEGIN END").unwrap();
    assert_eq!(db, Some("mydb".to_string()));
    assert_eq!(name, "my_proc");
    assert_eq!(type_kw, "PROCEDURE");
}

#[test]
fn test_parse_ddl_name_with_definer() {
    let ddl = "CREATE DEFINER=`root`@`localhost` PROCEDURE `my_proc`() BEGIN END";
    let (db, name, type_kw) = parse_ddl_name(ddl).unwrap();
    assert!(db.is_none());
    assert_eq!(name, "my_proc");
    assert_eq!(type_kw, "PROCEDURE");
}

#[test]
fn test_parse_ddl_name_with_definer_and_sql_security() {
    let ddl = "CREATE DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `mydb`.`v1` AS SELECT 1";
    let (db, name, type_kw) = parse_ddl_name(ddl).unwrap();
    assert_eq!(db, Some("mydb".to_string()));
    assert_eq!(name, "v1");
    assert_eq!(type_kw, "VIEW");
}

#[test]
fn test_parse_ddl_name_with_algorithm_definer_sql_security() {
    let ddl = "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v1` AS SELECT 1";
    let (_db, name, type_kw) = parse_ddl_name(ddl).unwrap();
    assert_eq!(name, "v1");
    assert_eq!(type_kw, "VIEW");
}

#[test]
fn test_parse_ddl_name_trigger() {
    let ddl = "CREATE TRIGGER `my_trigger` BEFORE INSERT ON `t1` FOR EACH ROW BEGIN END";
    let (db, name, type_kw) = parse_ddl_name(ddl).unwrap();
    assert!(db.is_none());
    assert_eq!(name, "my_trigger");
    assert_eq!(type_kw, "TRIGGER");
}

#[test]
fn test_parse_ddl_name_event() {
    let ddl = "CREATE EVENT `my_event` ON SCHEDULE EVERY 1 DAY DO SELECT 1";
    let (db, name, type_kw) = parse_ddl_name(ddl).unwrap();
    assert!(db.is_none());
    assert_eq!(name, "my_event");
    assert_eq!(type_kw, "EVENT");
}

#[test]
fn test_parse_ddl_name_rejects_invalid_ddl() {
    let result = parse_ddl_name("SELECT 1");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Could not parse"));
}

#[test]
fn test_parse_ddl_name_rejects_empty() {
    let result = parse_ddl_name("");
    assert!(result.is_err());
}

#[test]
fn test_parse_ddl_name_case_insensitive() {
    let (db, name, type_kw) = parse_ddl_name("create procedure `p`() BEGIN END").unwrap();
    assert!(db.is_none());
    assert_eq!(name, "p");
    assert_eq!(type_kw, "PROCEDURE");
}

// ===========================================================================
// parse_ddl_name — unquoted identifier tests
// ===========================================================================

#[test]
fn test_parse_ddl_name_unquoted_procedure() {
    let (db, name, type_kw) = parse_ddl_name("CREATE PROCEDURE my_proc() BEGIN END").unwrap();
    assert!(db.is_none());
    assert_eq!(name, "my_proc");
    assert_eq!(type_kw, "PROCEDURE");
}

#[test]
fn test_parse_ddl_name_unquoted_with_db() {
    let (db, name, type_kw) = parse_ddl_name("CREATE PROCEDURE mydb.my_proc() BEGIN END").unwrap();
    assert_eq!(db, Some("mydb".to_string()));
    assert_eq!(name, "my_proc");
    assert_eq!(type_kw, "PROCEDURE");
}

#[test]
fn test_parse_ddl_name_unquoted_view() {
    let (db, name, type_kw) = parse_ddl_name("CREATE VIEW my_view AS SELECT 1").unwrap();
    assert!(db.is_none());
    assert_eq!(name, "my_view");
    assert_eq!(type_kw, "VIEW");
}

#[test]
fn test_parse_ddl_name_mixed_quoted_db_unquoted_name() {
    let (db, name, type_kw) =
        parse_ddl_name("CREATE PROCEDURE `mydb`.my_proc() BEGIN END").unwrap();
    assert_eq!(db, Some("mydb".to_string()));
    assert_eq!(name, "my_proc");
    assert_eq!(type_kw, "PROCEDURE");
}

#[test]
fn test_parse_ddl_name_unquoted_db_quoted_name() {
    let (db, name, type_kw) =
        parse_ddl_name("CREATE PROCEDURE mydb.`my_proc`() BEGIN END").unwrap();
    assert_eq!(db, Some("mydb".to_string()));
    assert_eq!(name, "my_proc");
    assert_eq!(type_kw, "PROCEDURE");
}

#[test]
fn test_parse_ddl_name_quoted_name_with_escaped_backtick() {
    let (db, name, type_kw) = parse_ddl_name("CREATE VIEW `my``view` AS SELECT 1").unwrap();
    assert_eq!(db, None);
    assert_eq!(name, "my`view");
    assert_eq!(type_kw, "VIEW");
}

#[test]
fn test_parse_ddl_name_quoted_db_with_escaped_backtick() {
    let (db, name, type_kw) =
        parse_ddl_name("CREATE PROCEDURE `my``db`.`my_proc`() BEGIN END").unwrap();
    assert_eq!(db, Some("my`db".to_string()));
    assert_eq!(name, "my_proc");
    assert_eq!(type_kw, "PROCEDURE");
}

// ===========================================================================
// validate_view_ddl_prefix — pure tests
// ===========================================================================

#[test]
fn test_view_prefix_alter_accepts_create_or_replace_view() {
    let result = validate_view_ddl_prefix("CREATE OR REPLACE VIEW `v1` AS SELECT 1", "alter");
    assert!(result.is_ok());
}

#[test]
fn test_view_prefix_alter_rejects_create_view_without_or_replace() {
    let result = validate_view_ddl_prefix("CREATE VIEW `v1` AS SELECT 1", "alter");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("CREATE OR REPLACE VIEW"));
}

#[test]
fn test_view_prefix_alter_rejects_random_ddl() {
    let result = validate_view_ddl_prefix("SELECT 1", "alter");
    assert!(result.is_err());
}

#[test]
fn test_view_prefix_create_accepts_create_view() {
    let result = validate_view_ddl_prefix("CREATE VIEW `v1` AS SELECT 1", "create");
    assert!(result.is_ok());
}

#[test]
fn test_view_prefix_create_rejects_create_or_replace_view() {
    let result = validate_view_ddl_prefix("CREATE OR REPLACE VIEW `v1` AS SELECT 1", "create");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("must not use"));
}

#[test]
fn test_view_prefix_create_rejects_random_ddl() {
    let result = validate_view_ddl_prefix("DROP VIEW `v1`", "create");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("must start with"));
}

#[test]
fn test_view_prefix_invalid_mode() {
    let result = validate_view_ddl_prefix("CREATE VIEW `v1` AS SELECT 1", "delete");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid mode"));
}

#[test]
fn test_view_prefix_case_insensitive() {
    let result = validate_view_ddl_prefix("create or replace view `v1` AS SELECT 1", "alter");
    assert!(result.is_ok());
}

#[test]
fn test_view_prefix_with_leading_whitespace() {
    let result = validate_view_ddl_prefix("  CREATE OR REPLACE VIEW `v1` AS SELECT 1", "alter");
    assert!(result.is_ok());
}

// ===========================================================================
// validate_view_ddl_prefix — with ALGORITHM/DEFINER/SQL SECURITY clauses
// ===========================================================================

#[test]
fn test_view_prefix_alter_with_algorithm_definer_sql_security() {
    let result = validate_view_ddl_prefix(
        "CREATE OR REPLACE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v1` AS SELECT 1",
        "alter",
    );
    assert!(result.is_ok());
}

#[test]
fn test_view_prefix_alter_with_definer_only() {
    let result = validate_view_ddl_prefix(
        "CREATE OR REPLACE DEFINER=`root`@`localhost` VIEW `v1` AS SELECT 1",
        "alter",
    );
    assert!(result.is_ok());
}

#[test]
fn test_view_prefix_create_with_definer() {
    let result = validate_view_ddl_prefix(
        "CREATE DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v1` AS SELECT 1",
        "create",
    );
    assert!(result.is_ok());
}

#[test]
fn test_view_prefix_create_with_algorithm() {
    let result = validate_view_ddl_prefix("CREATE ALGORITHM=MERGE VIEW `v1` AS SELECT 1", "create");
    assert!(result.is_ok());
}

#[test]
fn test_view_prefix_create_rejects_or_replace_with_clauses() {
    let result = validate_view_ddl_prefix(
        "CREATE OR REPLACE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` VIEW `v1` AS SELECT 1",
        "create",
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("must not use"));
}

// ===========================================================================
// get_object_body_impl — command guard tests
// ===========================================================================

#[cfg(not(coverage))]
#[tokio::test]
async fn test_get_object_body_errors_when_connection_not_open() {
    let state = common::test_app_state();
    let result = get_object_body_impl(&state, "missing", "db", "obj", "view").await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("not open") || err.contains("Unknown"),
        "expected connection or type error, got: {err}"
    );
}

// ===========================================================================
// save_object_impl — validation tests (work in both coverage and non-coverage)
// ===========================================================================

#[tokio::test]
async fn test_save_object_rejects_read_only() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "ro-conn", true);

    let request = make_request(
        "ro-conn",
        "mydb",
        "my_proc",
        "procedure",
        "CREATE PROCEDURE `my_proc`() BEGIN END",
        "alter",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    assert!(
        result.unwrap_err().contains("read-only"),
        "expected read-only rejection"
    );
}

#[tokio::test]
async fn test_save_object_rejects_empty_database_identifier() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let request = make_request(
        "c1",
        "",
        "my_proc",
        "procedure",
        "CREATE PROCEDURE `my_proc`() BEGIN END",
        "alter",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[tokio::test]
async fn test_save_object_rejects_too_long_identifier() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let long_name = "a".repeat(65);
    let request = make_request(
        "c1",
        "mydb",
        &long_name,
        "procedure",
        "CREATE PROCEDURE `my_proc`() BEGIN END",
        "alter",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("64 characters"));
}

#[tokio::test]
async fn test_save_object_rejects_name_mismatch_alter_mode() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let request = make_request(
        "c1",
        "mydb",
        "old_proc",
        "procedure",
        "CREATE PROCEDURE `new_proc`() BEGIN END",
        "alter",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("mismatch"),
        "expected name mismatch error, got: {err}"
    );
}

#[tokio::test]
async fn test_save_object_rejects_database_qualifier_mismatch() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let request = make_request(
        "c1",
        "mydb",
        "my_proc",
        "procedure",
        "CREATE PROCEDURE `other_db`.`my_proc`() BEGIN END",
        "alter",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("other_db") && err.contains("mydb"),
        "expected DB qualifier mismatch error, got: {err}"
    );
}

#[tokio::test]
async fn test_save_object_rejects_view_alter_without_or_replace() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let request = make_request(
        "c1",
        "mydb",
        "v1",
        "view",
        "CREATE VIEW `v1` AS SELECT 1",
        "alter",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("CREATE OR REPLACE VIEW"),
        "expected view prefix error, got: {err}"
    );
}

#[tokio::test]
async fn test_save_object_rejects_view_create_with_or_replace() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let request = make_request(
        "c1",
        "mydb",
        "v1",
        "view",
        "CREATE OR REPLACE VIEW `v1` AS SELECT 1",
        "create",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("must not use"),
        "expected OR REPLACE rejection for create mode, got: {err}"
    );
}

#[tokio::test]
async fn test_save_object_rejects_unparseable_ddl() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let request = make_request("c1", "mydb", "obj", "procedure", "SELECT 1", "alter");
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Could not parse"));
}

#[tokio::test]
async fn test_save_object_rejects_type_mismatch() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let request = make_request(
        "c1",
        "mydb",
        "my_proc",
        "procedure",
        "CREATE FUNCTION `my_proc`() RETURNS INT BEGIN RETURN 1; END",
        "alter",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("type mismatch"),
        "expected type mismatch error, got: {err}"
    );
}

#[tokio::test]
async fn test_save_object_rejects_function_as_procedure() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let request = make_request(
        "c1",
        "mydb",
        "my_func",
        "function",
        "CREATE PROCEDURE `my_func`() BEGIN SELECT 1; END",
        "create",
    );
    let result = save_object_impl(request, &state).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("type mismatch"),
        "expected type mismatch error, got: {err}"
    );
}

// ===========================================================================
// drop_object_impl — validation tests
// ===========================================================================

#[tokio::test]
async fn test_drop_object_rejects_read_only() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "ro-conn", true);

    let result = drop_object_impl(&state, "ro-conn", "mydb", "obj", "procedure").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("read-only"));
}

#[tokio::test]
async fn test_drop_object_rejects_empty_identifier() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let result = drop_object_impl(&state, "c1", "", "obj", "procedure").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[tokio::test]
async fn test_drop_object_rejects_unknown_object_type() {
    let state = common::test_app_state();
    register_lazy_pool(&state, "c1", false);

    let result = drop_object_impl(&state, "c1", "mydb", "obj", "unknown").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Unknown object type"));
}

// ===========================================================================
// get_routine_parameters_impl — command guard tests
// ===========================================================================

#[cfg(not(coverage))]
#[tokio::test]
async fn test_get_routine_parameters_errors_when_connection_not_open() {
    let state = common::test_app_state();
    let result = get_routine_parameters_impl(&state, "missing", "db", "proc", "PROCEDURE").await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("not open") || err.is_empty(), // coverage stub returns Ok(vec![])
        "expected connection error, got: {err}"
    );
}

#[cfg(not(coverage))]
#[tokio::test]
async fn test_get_routine_parameters_with_return_type_errors_when_connection_not_open() {
    let state = common::test_app_state();
    let result =
        get_routine_parameters_with_return_type_impl(&state, "missing", "db", "func", "FUNCTION")
            .await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("not open") || err.is_empty(),
        "expected connection error, got: {err}"
    );
}

// ===========================================================================
// Success-path tests via mock MySQL server (non-coverage only)
// ===========================================================================
//
// These tests start an in-process MySQL protocol mock and exercise the full
// save_object_impl code path including USE, DROP, and CREATE execution.

#[cfg(not(coverage))]
mod mock_success_paths {
    use super::*;
    use common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryStep};
    use opensrv_mysql::{ColumnFlags, ColumnType};
    use sqlx::mysql::MySqlPoolOptions;

    /// Start mock server + register a real pool on `state` returning the connection id.
    async fn setup_mock_pool_with_steps(
        state: &AppState,
        connection_id: &str,
        steps: Vec<MockQueryStep>,
    ) -> MockMySqlServer {
        let server = MockMySqlServer::start_script(steps).await;
        let url = format!("mysql://root@127.0.0.1:{}/?ssl-mode=DISABLED", server.port);
        let pool = MySqlPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect to mock mysql server");

        let entry = RegistryEntry {
            pool,
            session_id: connection_id.to_string(),
            profile_id: "profile-oe-mock".to_string(),
            status: ConnectionStatus::Connected,
            server_version: "8.0.36-mock".to_string(),
            cancellation_token: CancellationToken::new(),
            connection_params: dummy_stored_params(),
            read_only: false,
        };
        state.registry.insert(connection_id.to_string(), entry);
        server
    }

    async fn setup_mock_pool(state: &AppState, connection_id: &str) -> MockMySqlServer {
        // Empty steps list — mock returns OkResponse for all unmatched queries,
        // which covers USE, DROP, and CREATE statements.
        setup_mock_pool_with_steps(state, connection_id, vec![]).await
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_procedure_alter_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let request = make_request(
            "mock-conn",
            "mydb",
            "my_proc",
            "procedure",
            "CREATE PROCEDURE `my_proc`() BEGIN SELECT 1; END",
            "alter",
        );

        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.success, "expected success=true, response: {:?}", resp);
        assert!(
            resp.drop_succeeded,
            "alter mode should report drop_succeeded"
        );
        assert_eq!(resp.saved_object_name, Some("my_proc".to_string()));
        assert!(resp.error_message.is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_procedure_create_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let request = make_request(
            "mock-conn",
            "mydb",
            "new_proc",
            "procedure",
            "CREATE PROCEDURE `new_proc`() BEGIN SELECT 1; END",
            "create",
        );

        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.success, "expected success=true, response: {:?}", resp);
        assert!(
            !resp.drop_succeeded,
            "create mode should not report drop_succeeded"
        );
        assert_eq!(resp.saved_object_name, Some("new_proc".to_string()));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_view_alter_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let request = make_request(
            "mock-conn",
            "mydb",
            "v1",
            "view",
            "CREATE OR REPLACE VIEW `v1` AS SELECT 1",
            "alter",
        );

        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.success, "expected success=true, response: {:?}", resp);
        assert_eq!(resp.saved_object_name, Some("v1".to_string()));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_view_create_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let request = make_request(
            "mock-conn",
            "mydb",
            "v2",
            "view",
            "CREATE VIEW `v2` AS SELECT 1",
            "create",
        );

        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.success, "expected success=true, response: {:?}", resp);
        assert_eq!(resp.saved_object_name, Some("v2".to_string()));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_function_create_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let request = make_request(
            "mock-conn",
            "mydb",
            "my_func",
            "function",
            "CREATE FUNCTION `my_func`() RETURNS INT BEGIN RETURN 1; END",
            "create",
        );

        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.success, "expected success=true, response: {:?}", resp);
        assert_eq!(resp.saved_object_name, Some("my_func".to_string()));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_trigger_alter_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let request = make_request(
            "mock-conn",
            "mydb",
            "my_trigger",
            "trigger",
            "CREATE TRIGGER `my_trigger` BEFORE INSERT ON `t1` FOR EACH ROW BEGIN END",
            "alter",
        );

        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.success, "expected success=true, response: {:?}", resp);
        assert!(
            resp.drop_succeeded,
            "trigger alter should report drop_succeeded"
        );
        assert_eq!(resp.saved_object_name, Some("my_trigger".to_string()));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_event_create_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let request = make_request(
            "mock-conn",
            "mydb",
            "my_event",
            "event",
            "CREATE EVENT `my_event` ON SCHEDULE EVERY 1 DAY DO SELECT 1",
            "create",
        );

        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.success, "expected success=true, response: {:?}", resp);
        assert_eq!(resp.saved_object_name, Some("my_event".to_string()));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_with_db_qualifier_matching_current_db_succeeds() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let request = make_request(
            "mock-conn",
            "mydb",
            "my_proc",
            "procedure",
            "CREATE PROCEDURE `mydb`.`my_proc`() BEGIN SELECT 1; END",
            "alter",
        );

        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.success, "expected success=true, response: {:?}", resp);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn drop_object_procedure_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let result = drop_object_impl(&state, "mock-conn", "mydb", "my_proc", "procedure").await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn drop_object_view_succeeds_via_mock() {
        let state = common::test_app_state();
        let _server = setup_mock_pool(&state, "mock-conn").await;

        let result = drop_object_impl(&state, "mock-conn", "mydb", "v1", "view").await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn get_object_body_view_preserves_definer_algorithm_and_sql_security() {
        let state = common::test_app_state();
        let _server = setup_mock_pool_with_steps(
            &state,
            "mock-conn",
            vec![MockQueryStep {
                query: "SHOW CREATE VIEW `mydb`.`v1`",
                columns: vec![
                    MockColumnDef {
                        name: "View",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "Create View",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                ],
                rows: vec![vec![
                    MockCell::Bytes(b"v1"),
                    MockCell::Bytes(
                        b"CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v1` AS SELECT 1",
                    ),
                ]],
                error: None,
            }],
        )
        .await;

        let ddl = get_object_body_impl(&state, "mock-conn", "mydb", "v1", "view")
            .await
            .expect("expected view DDL to load");

        assert_eq!(
            ddl,
            "CREATE OR REPLACE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v1` AS SELECT 1"
        );
    }
}

#[cfg(not(coverage))]
mod ipc_paths {
    use super::*;
    use common::mock_mysql_server::MockMySqlServer;
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use sqllumen_lib::mysql::pool::{create_pool, ConnectionParams};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SaveObjectResponseDto {
        success: bool,
        error_message: Option<String>,
        drop_succeeded: bool,
        saved_object_name: Option<String>,
    }

    async fn build_app_with_mock_connection(
        server: &MockMySqlServer,
    ) -> (
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
    ) {
        let state = common::test_app_state();
        let pool = create_pool(&ConnectionParams {
            host: "127.0.0.1".to_string(),
            port: server.port,
            username: "root".to_string(),
            password: String::new(),
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            connect_timeout_secs: 2,
        })
        .await
        .expect("should connect to mock mysql server");

        state.registry.insert(
            "mock-conn".to_string(),
            RegistryEntry {
                pool,
                session_id: "mock-conn".to_string(),
                profile_id: "profile-oe-mock".to_string(),
                status: ConnectionStatus::Connected,
                server_version: "8.0.36-mock".to_string(),
                cancellation_token: CancellationToken::new(),
                connection_params: dummy_stored_params(),
                read_only: false,
            },
        );

        let app = mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![save_object])
            .build(mock_context(noop_assets()))
            .expect("should build test app");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("should build test webview");
        (app, webview)
    }

    #[tauri::command]
    async fn save_object(
        request: SaveObjectRequest,
        state: tauri::State<'_, AppState>,
    ) -> Result<sqllumen_lib::commands::object_editor::SaveObjectResponse, String> {
        save_object_impl(request, &state).await
    }

    fn invoke_tauri_command<T: DeserializeOwned>(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        cmd: &str,
        body: serde_json::Value,
    ) -> Result<T, serde_json::Value> {
        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost"
                    .parse()
                    .expect("test URL should parse"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| {
            response
                .deserialize::<T>()
                .expect("IPC response should deserialize")
        })
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn save_object_ipc_saves_procedure_without_prepared_statement_protocol() {
        let server = MockMySqlServer::start_script_with_unsupported_prepared_prefixes(
            vec![],
            vec!["USE ", "CREATE PROCEDURE"],
        )
        .await;
        let (_app, webview) = build_app_with_mock_connection(&server).await;

        let response: SaveObjectResponseDto = invoke_tauri_command(
            &webview,
            "save_object",
            json!({
                "request": {
                    "connectionId": "mock-conn",
                    "database": "mydb",
                    "objectName": "my_proc",
                    "objectType": "procedure",
                    "body": "CREATE PROCEDURE `my_proc`() BEGIN SELECT 1; END",
                    "mode": "create",
                }
            }),
        )
        .expect("save_object IPC should succeed without prepared statements");

        assert!(
            response.success,
            "expected success=true, response: {response:?}"
        );
        assert_eq!(response.saved_object_name, Some("my_proc".to_string()));
        assert_eq!(response.error_message, None);
        assert!(!response.drop_succeeded);
    }
}

// ===========================================================================
// Coverage-mode stub tests
// ===========================================================================

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;

    #[tokio::test]
    async fn test_get_object_body_impl_view() {
        let state = common::test_app_state();
        let result = get_object_body_impl(&state, "c", "db", "v", "view").await;
        assert!(result.is_ok());
        let ddl = result.unwrap();
        assert!(ddl.contains("CREATE OR REPLACE VIEW"));
    }

    #[tokio::test]
    async fn test_get_object_body_impl_procedure() {
        let state = common::test_app_state();
        let result = get_object_body_impl(&state, "c", "db", "p", "procedure").await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("PROCEDURE"));
    }

    #[tokio::test]
    async fn test_get_object_body_impl_function() {
        let state = common::test_app_state();
        let result = get_object_body_impl(&state, "c", "db", "f", "function").await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("FUNCTION"));
    }

    #[tokio::test]
    async fn test_get_object_body_impl_trigger() {
        let state = common::test_app_state();
        let result = get_object_body_impl(&state, "c", "db", "t", "trigger").await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("TRIGGER"));
    }

    #[tokio::test]
    async fn test_get_object_body_impl_event() {
        let state = common::test_app_state();
        let result = get_object_body_impl(&state, "c", "db", "e", "event").await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("EVENT"));
    }

    #[tokio::test]
    async fn test_get_object_body_impl_table() {
        let state = common::test_app_state();
        let result = get_object_body_impl(&state, "c", "db", "t", "table").await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("TABLE"));
    }

    #[tokio::test]
    async fn test_get_object_body_impl_unknown_type() {
        let state = common::test_app_state();
        let result = get_object_body_impl(&state, "c", "db", "x", "unknown").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_save_object_alter_mode_success() {
        let state = common::test_app_state();
        let request = make_request(
            "c1",
            "mydb",
            "my_proc",
            "procedure",
            "CREATE PROCEDURE `my_proc`() BEGIN SELECT 1; END",
            "alter",
        );
        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.success);
        assert!(resp.error_message.is_none());
        assert_eq!(resp.saved_object_name, Some("my_proc".to_string()));
    }

    #[tokio::test]
    async fn test_save_object_create_mode_returns_parsed_name() {
        let state = common::test_app_state();
        let request = make_request(
            "c1",
            "mydb",
            "placeholder",
            "procedure",
            "CREATE PROCEDURE `new_proc`() BEGIN SELECT 1; END",
            "create",
        );
        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.success);
        assert_eq!(resp.saved_object_name, Some("new_proc".to_string()));
    }

    #[tokio::test]
    async fn test_save_object_view_alter_success() {
        let state = common::test_app_state();
        let request = make_request(
            "c1",
            "mydb",
            "v1",
            "view",
            "CREATE OR REPLACE VIEW `v1` AS SELECT 1",
            "alter",
        );
        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.success);
        assert_eq!(resp.saved_object_name, Some("v1".to_string()));
    }

    #[tokio::test]
    async fn test_save_object_view_create_success() {
        let state = common::test_app_state();
        let request = make_request(
            "c1",
            "mydb",
            "v1",
            "view",
            "CREATE VIEW `v1` AS SELECT 1",
            "create",
        );
        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.success);
        assert_eq!(resp.saved_object_name, Some("v1".to_string()));
    }

    #[tokio::test]
    async fn test_save_object_view_alter_name_mismatch() {
        let state = common::test_app_state();
        let request = make_request(
            "c1",
            "mydb",
            "v1",
            "view",
            "CREATE OR REPLACE VIEW `v2` AS SELECT 1",
            "alter",
        );
        let result = save_object_impl(request, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("mismatch"));
    }

    #[tokio::test]
    async fn test_save_object_rejects_type_mismatch_coverage() {
        let state = common::test_app_state();
        let request = make_request(
            "c1",
            "mydb",
            "my_proc",
            "procedure",
            "CREATE FUNCTION `my_proc`() RETURNS INT BEGIN RETURN 1; END",
            "alter",
        );
        let result = save_object_impl(request, &state).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("type mismatch"),
            "expected type mismatch error, got: {err}"
        );
    }

    #[tokio::test]
    async fn test_save_object_db_qualifier_same_db_ok() {
        let state = common::test_app_state();
        let request = make_request(
            "c1",
            "mydb",
            "my_proc",
            "procedure",
            "CREATE PROCEDURE `mydb`.`my_proc`() BEGIN END",
            "alter",
        );
        let result = save_object_impl(request, &state).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_drop_object_coverage_procedure() {
        let state = common::test_app_state();
        let result = drop_object_impl(&state, "c1", "mydb", "my_proc", "procedure").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_drop_object_coverage_view() {
        let state = common::test_app_state();
        let result = drop_object_impl(&state, "c1", "mydb", "v1", "view").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_drop_object_coverage_function() {
        let state = common::test_app_state();
        let result = drop_object_impl(&state, "c1", "mydb", "f1", "function").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_drop_object_coverage_trigger() {
        let state = common::test_app_state();
        let result = drop_object_impl(&state, "c1", "mydb", "t1", "trigger").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_drop_object_coverage_event() {
        let state = common::test_app_state();
        let result = drop_object_impl(&state, "c1", "mydb", "e1", "event").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_routine_parameters_coverage() {
        let state = common::test_app_state();
        let result = get_routine_parameters_impl(&state, "c1", "mydb", "proc", "PROCEDURE").await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_routine_parameters_with_return_type_coverage() {
        let state = common::test_app_state();
        let result =
            get_routine_parameters_with_return_type_impl(&state, "c1", "mydb", "func", "FUNCTION")
                .await;
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.parameters.is_empty());
        assert!(resp.found);
    }

    #[tokio::test]
    async fn test_get_routine_parameters_with_return_type_missing_routine_coverage() {
        let state = common::test_app_state();
        let result = get_routine_parameters_with_return_type_impl(
            &state,
            "c1",
            "mydb",
            "missing_proc",
            "PROCEDURE",
        )
        .await;
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.parameters.is_empty());
        assert!(
            !resp.found,
            "routine starting with 'missing' should have found=false"
        );
    }
}
