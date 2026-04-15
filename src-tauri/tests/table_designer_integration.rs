use sqllumen_lib::commands::table_designer::{generate_table_ddl_impl, parse_column_type};
use sqllumen_lib::mysql::table_designer::{
    derive_charset_from_collation, generate_alter_table_ddl, generate_create_table_ddl,
    validate_schema, DefaultValueModel, DesignerColumnDef, DesignerForeignKeyDef, DesignerIndexDef,
    DesignerTableProperties, DesignerTableSchema, GenerateDdlRequest, GenerateDdlResponse,
};

mod common;

fn column(name: &str) -> DesignerColumnDef {
    DesignerColumnDef {
        name: name.to_string(),
        r#type: "INT".to_string(),
        type_modifier: String::new(),
        length: String::new(),
        nullable: false,
        is_primary_key: false,
        is_auto_increment: false,
        default_value: DefaultValueModel::NoDefault,
        comment: String::new(),
        original_name: name.to_string(),
    }
}

fn properties() -> DesignerTableProperties {
    DesignerTableProperties {
        engine: String::new(),
        charset: String::new(),
        collation: String::new(),
        auto_increment: None,
        row_format: String::new(),
        comment: String::new(),
    }
}

fn schema(columns: Vec<DesignerColumnDef>) -> DesignerTableSchema {
    DesignerTableSchema {
        table_name: "users".to_string(),
        columns,
        indexes: vec![],
        foreign_keys: vec![],
        properties: properties(),
    }
}

fn index(name: &str, index_type: &str, columns: &[&str]) -> DesignerIndexDef {
    DesignerIndexDef {
        name: name.to_string(),
        index_type: index_type.to_string(),
        columns: columns.iter().map(|column| (*column).to_string()).collect(),
    }
}

fn foreign_key(name: &str, column_name: &str) -> DesignerForeignKeyDef {
    DesignerForeignKeyDef {
        name: name.to_string(),
        source_column: column_name.to_string(),
        referenced_table: "roles".to_string(),
        referenced_column: "id".to_string(),
        on_delete: "CASCADE".to_string(),
        on_update: "NO ACTION".to_string(),
        is_composite: false,
    }
}

#[test]
fn test_validate_empty_column_name() {
    let schema = schema(vec![column("")]);
    assert!(validate_schema(&schema).is_err());
}

#[test]
fn test_validate_duplicate_column_names() {
    let schema = schema(vec![column("id"), column("id")]);
    assert!(validate_schema(&schema).is_err());
}

#[test]
fn test_validate_name_too_long() {
    let schema = schema(vec![column(&"a".repeat(65))]);
    assert!(validate_schema(&schema).is_err());
}

#[test]
fn test_validate_table_name_too_long() {
    let mut table = schema(vec![column("id")]);
    table.table_name = "a".repeat(65);

    assert!(validate_schema(&table).is_err());
}

#[test]
fn test_validate_valid_schema() {
    let schema = schema(vec![column("id"), column("email"), column("created_at")]);
    assert!(validate_schema(&schema).is_ok());
}

#[test]
fn test_create_table_basic() {
    let mut id = column("id");
    id.is_primary_key = true;
    id.is_auto_increment = true;

    let ddl = generate_create_table_ddl(&schema(vec![id]), "appdb");

    assert!(ddl.contains("CREATE TABLE `appdb`.`users`"));
    assert!(ddl.contains("`id` INT NOT NULL AUTO_INCREMENT"));
    assert!(ddl.contains("PRIMARY KEY (`id`)"));
}

#[test]
fn test_create_table_empty_table_name_returns_empty() {
    let mut table = schema(vec![column("id")]);
    table.table_name = String::new();

    let ddl = generate_create_table_ddl(&table, "appdb");

    assert_eq!(ddl, "");
}

#[test]
fn test_create_table_invalid_database_name_returns_empty() {
    let ddl = generate_create_table_ddl(&schema(vec![column("id")]), &"a".repeat(65));

    assert_eq!(ddl, "");
}

#[test]
fn test_create_table_with_nullable() {
    let mut name = column("name");
    name.r#type = "VARCHAR".to_string();
    name.length = "255".to_string();
    name.nullable = true;
    name.default_value = DefaultValueModel::NullDefault;

    let ddl = generate_create_table_ddl(&schema(vec![name]), "appdb");

    assert!(ddl.contains("`name` VARCHAR(255) NULL DEFAULT NULL"));
}

#[test]
fn test_create_table_no_default() {
    let ddl = generate_create_table_ddl(&schema(vec![column("name")]), "appdb");
    assert!(!ddl.contains("DEFAULT"));
}

#[test]
fn test_create_table_null_default() {
    let mut name = column("name");
    name.default_value = DefaultValueModel::NullDefault;

    let ddl = generate_create_table_ddl(&schema(vec![name]), "appdb");
    assert!(ddl.contains("DEFAULT NULL"));
}

#[test]
fn test_create_table_literal_default() {
    let mut status = column("status");
    status.r#type = "VARCHAR".to_string();
    status.length = "16".to_string();
    status.default_value = DefaultValueModel::Literal {
        value: "active".to_string(),
    };

    let ddl = generate_create_table_ddl(&schema(vec![status]), "appdb");
    assert!(ddl.contains("DEFAULT 'active'"));
}

#[test]
fn test_create_table_expression_default() {
    let mut created_at = column("created_at");
    created_at.r#type = "TIMESTAMP".to_string();
    created_at.default_value = DefaultValueModel::Expression {
        value: "CURRENT_TIMESTAMP".to_string(),
    };

    let ddl = generate_create_table_ddl(&schema(vec![created_at]), "appdb");

    assert!(ddl.contains("DEFAULT CURRENT_TIMESTAMP"));
}

#[test]
fn test_create_table_with_unique_index() {
    let mut table = schema(vec![column("email")]);
    table
        .indexes
        .push(index("uniq_email", "UNIQUE", &["email"]));

    let ddl = generate_create_table_ddl(&table, "appdb");
    assert!(ddl.contains("UNIQUE KEY `uniq_email` (`email`)"));
}

#[test]
fn test_create_table_with_regular_index() {
    let mut table = schema(vec![column("email")]);
    table.indexes.push(index("idx_email", "INDEX", &["email"]));

    let ddl = generate_create_table_ddl(&table, "appdb");
    assert!(ddl.contains("INDEX `idx_email` (`email`)"));
}

#[test]
fn test_create_table_with_fk() {
    let mut table = schema(vec![column("role_id")]);
    table
        .foreign_keys
        .push(foreign_key("fk_users_role", "role_id"));

    let ddl = generate_create_table_ddl(&table, "appdb");
    assert!(ddl
        .contains("CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)"));
}

#[test]
fn test_create_table_composite_fk_skipped() {
    let mut table = schema(vec![column("role_id")]);
    let mut fk = foreign_key("fk_users_role", "role_id");
    fk.is_composite = true;
    table.foreign_keys.push(fk);

    let ddl = generate_create_table_ddl(&table, "appdb");
    assert!(!ddl.contains("FOREIGN KEY"));
}

#[test]
fn test_create_table_engine_charset() {
    let mut table = schema(vec![column("id")]);
    table.properties.engine = "InnoDB".to_string();
    table.properties.charset = "utf8mb4".to_string();

    let ddl = generate_create_table_ddl(&table, "appdb");
    assert!(ddl.contains("ENGINE=InnoDB"));
    assert!(ddl.contains("DEFAULT CHARSET=utf8mb4"));
}

#[test]
fn test_alter_no_changes_returns_empty() {
    let original = schema(vec![column("id")]);
    let current = original.clone();

    let (ddl, warnings) = generate_alter_table_ddl(&original, &current, "appdb");
    assert_eq!(ddl, "");
    assert!(warnings.is_empty());
}

#[test]
fn test_alter_add_column_after() {
    let original = schema(vec![column("id"), column("name")]);
    let current = schema(vec![column("id"), column("email"), column("name")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("ADD COLUMN `email` INT NOT NULL AFTER `id`"));
}

#[test]
fn test_alter_add_column_first() {
    let original = schema(vec![column("id")]);
    let current = schema(vec![column("uuid"), column("id")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("ADD COLUMN `uuid` INT NOT NULL FIRST"));
}

#[test]
fn test_alter_drop_column() {
    let original = schema(vec![column("id"), column("name")]);
    let current = schema(vec![column("id")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("DROP COLUMN `name`"));
}

#[test]
fn test_alter_modify_column_type() {
    let original = schema(vec![column("name")]);
    let mut changed = column("name");
    changed.r#type = "VARCHAR".to_string();
    changed.length = "255".to_string();
    let current = schema(vec![changed]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("MODIFY COLUMN `name` VARCHAR(255) NOT NULL"));
}

#[test]
fn test_alter_modify_column_nullable() {
    let original = schema(vec![column("name")]);
    let mut changed = column("name");
    changed.nullable = true;
    let current = schema(vec![changed]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("MODIFY COLUMN `name` INT NULL"));
}

#[test]
fn test_alter_modify_column_default() {
    let original = schema(vec![column("status")]);
    let mut changed = column("status");
    changed.default_value = DefaultValueModel::Literal {
        value: "active".to_string(),
    };
    let current = schema(vec![changed]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("MODIFY COLUMN `status` INT NOT NULL DEFAULT 'active'"));
}

#[test]
fn test_alter_add_index() {
    let original = schema(vec![column("email")]);
    let mut current = schema(vec![column("email")]);
    current
        .indexes
        .push(index("uniq_email", "UNIQUE", &["email"]));

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("ADD UNIQUE KEY `uniq_email` (`email`)"));
}

#[test]
fn test_alter_drop_index() {
    let mut original = schema(vec![column("email")]);
    original
        .indexes
        .push(index("idx_email", "INDEX", &["email"]));
    let current = schema(vec![column("email")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("DROP INDEX `idx_email`"));
}

#[test]
fn test_alter_skips_empty_named_index() {
    let original = schema(vec![column("email")]);
    let mut current = schema(vec![column("email")]);
    current.indexes.push(index("", "INDEX", &["email"]));

    let (ddl, warnings) = generate_alter_table_ddl(&original, &current, "appdb");

    assert_eq!(ddl, "");
    assert!(warnings.is_empty());
}

#[test]
fn test_alter_add_fk() {
    let original = schema(vec![column("role_id")]);
    let mut current = schema(vec![column("role_id")]);
    current
        .foreign_keys
        .push(foreign_key("fk_users_role", "role_id"));

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains(
        "ADD CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)"
    ));
}

#[test]
fn test_alter_drop_fk() {
    let mut original = schema(vec![column("role_id")]);
    original
        .foreign_keys
        .push(foreign_key("fk_users_role", "role_id"));
    let current = schema(vec![column("role_id")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("DROP FOREIGN KEY `fk_users_role`"));
}

#[test]
fn test_alter_composite_fk_not_dropped() {
    let mut original = schema(vec![column("role_id")]);
    let mut fk = foreign_key("fk_users_role", "role_id");
    fk.is_composite = true;
    original.foreign_keys.push(fk);
    let current = schema(vec![column("role_id")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(!ddl.contains("DROP FOREIGN KEY"));
}

#[test]
fn test_alter_composite_fk_not_added() {
    let original = schema(vec![column("role_id")]);
    let mut current = schema(vec![column("role_id")]);
    let mut fk = foreign_key("fk_users_role", "role_id");
    fk.is_composite = true;
    current.foreign_keys.push(fk);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(!ddl.contains("ADD CONSTRAINT"));
}

#[test]
fn test_alter_table_properties() {
    let original = schema(vec![column("id")]);
    let mut current = schema(vec![column("id")]);
    current.properties.engine = "InnoDB".to_string();

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("ENGINE=InnoDB"));
}

#[test]
fn test_alter_column_rename_warning() {
    let original = schema(vec![column("old_name")]);
    let mut renamed = column("new_name");
    renamed.original_name = "old_name".to_string();
    let current = schema(vec![renamed]);

    let (ddl, warnings) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(warnings
        .iter()
        .any(|warning| warning.contains("Column 'old_name' was renamed to 'new_name'")));
    assert!(ddl.contains("DROP COLUMN `old_name`"));
    assert!(ddl.contains("ADD COLUMN `new_name` INT NOT NULL FIRST"));
}

#[test]
fn test_alter_new_column_without_original_name_does_not_warn_as_rename() {
    let original = schema(vec![column("id")]);
    let mut new_column = column("email");
    new_column.original_name = String::new();
    let current = schema(vec![column("id"), new_column]);

    let (ddl, warnings) = generate_alter_table_ddl(&original, &current, "appdb");

    assert!(warnings.is_empty());
    assert!(ddl.contains("ADD COLUMN `email` INT NOT NULL AFTER `id`"));
}

#[test]
fn test_alter_clause_order() {
    let mut original_id = column("id");
    original_id.is_primary_key = true;

    let mut original_name = column("name");
    original_name.comment = "old".to_string();

    let original = DesignerTableSchema {
        table_name: "users".to_string(),
        columns: vec![original_id, original_name, column("legacy")],
        indexes: vec![index("idx_name", "INDEX", &["name"])],
        foreign_keys: vec![foreign_key("fk_users_role", "name")],
        properties: properties(),
    };

    let mut current_id = column("id");
    current_id.is_primary_key = true;

    let mut current_name = column("name");
    current_name.r#type = "VARCHAR".to_string();
    current_name.length = "255".to_string();

    let mut current = DesignerTableSchema {
        table_name: "users".to_string(),
        columns: vec![current_id, current_name, column("role_id")],
        indexes: vec![index("uniq_name", "UNIQUE", &["name"])],
        foreign_keys: vec![foreign_key("fk_users_role_new", "role_id")],
        properties: properties(),
    };
    current.properties.engine = "InnoDB".to_string();

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");

    let drop_fk = ddl
        .find("DROP FOREIGN KEY `fk_users_role`")
        .expect("missing drop fk");
    let drop_index = ddl
        .find("DROP INDEX `idx_name`")
        .expect("missing drop index");
    let drop_column = ddl
        .find("DROP COLUMN `legacy`")
        .expect("missing drop column");
    let modify = ddl
        .find("MODIFY COLUMN `name` VARCHAR(255) NOT NULL")
        .expect("missing modify");
    let add_column = ddl
        .find("ADD COLUMN `role_id` INT NOT NULL AFTER `name`")
        .expect("missing add column");
    let add_index = ddl
        .find("ADD UNIQUE KEY `uniq_name` (`name`)")
        .expect("missing add index");
    let add_fk = ddl.find("ADD CONSTRAINT `fk_users_role_new` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION").expect("missing add fk");
    let table_option = ddl.find("ENGINE=InnoDB").expect("missing table option");

    assert!(drop_fk < drop_index);
    assert!(drop_index < drop_column);
    assert!(drop_column < modify);
    assert!(modify < add_column);
    assert!(add_column < add_index);
    assert!(add_index < add_fk);
    assert!(add_fk < table_option);
}

#[test]
fn derive_charset_from_collation_returns_prefix() {
    assert_eq!(
        derive_charset_from_collation("utf8mb4_unicode_ci"),
        "utf8mb4"
    );
    assert_eq!(derive_charset_from_collation("latin1_swedish_ci"), "latin1");
}

#[test]
fn test_generate_ddl_request_serialization() {
    let request = GenerateDdlRequest {
        original_schema: Some(schema(vec![column("id")])),
        current_schema: schema(vec![column("id"), column("email")]),
        database: "appdb".to_string(),
        mode: "alter".to_string(),
    };

    let json = serde_json::to_string(&request).expect("request should serialize");
    let deserialized: GenerateDdlRequest =
        serde_json::from_str(&json).expect("request should deserialize");

    assert_eq!(deserialized.database, "appdb");
    assert_eq!(deserialized.mode, "alter");
    assert!(deserialized.original_schema.is_some());
    assert_eq!(deserialized.current_schema.table_name, "users");
    assert_eq!(deserialized.current_schema.columns.len(), 2);
}

#[test]
fn test_generate_ddl_response_serialization() {
    let response = GenerateDdlResponse {
        ddl: "CREATE TABLE `appdb`.`users` (`id` INT NOT NULL);".to_string(),
        warnings: vec!["warning one".to_string()],
    };

    let value = serde_json::to_value(&response).expect("response should serialize");
    assert_eq!(
        value["ddl"],
        "CREATE TABLE `appdb`.`users` (`id` INT NOT NULL);"
    );
    assert_eq!(value["warnings"], serde_json::json!(["warning one"]));

    let deserialized: GenerateDdlResponse =
        serde_json::from_value(value).expect("response should deserialize");
    assert_eq!(
        deserialized.ddl,
        "CREATE TABLE `appdb`.`users` (`id` INT NOT NULL);"
    );
    assert_eq!(deserialized.warnings, vec!["warning one".to_string()]);
}

#[test]
fn test_parse_column_type_preserves_unsigned_modifier() {
    let (column_type, length, modifier) = parse_column_type("int(11) unsigned");

    assert_eq!(column_type, "INT");
    assert_eq!(length, "11");
    assert_eq!(modifier, "UNSIGNED");
}

#[test]
fn test_parse_column_type_handles_decimal_precision_scale() {
    let (column_type, length, modifier) = parse_column_type("decimal(10,2)");

    assert_eq!(column_type, "DECIMAL");
    assert_eq!(length, "10,2");
    assert_eq!(modifier, "");
}

#[test]
fn test_parse_column_type_splits_unsigned_without_length() {
    let (column_type, length, modifier) = parse_column_type("int unsigned");

    assert_eq!(column_type, "INT");
    assert_eq!(length, "");
    assert_eq!(modifier, "UNSIGNED");
}

#[tokio::test]
async fn test_generate_table_ddl_impl_returns_validation_error_for_invalid_schema() {
    assert_generate_table_ddl_validation_error(
        GenerateDdlRequest {
            original_schema: None,
            current_schema: schema(vec![column("")]),
            database: "appdb".to_string(),
            mode: "create".to_string(),
        },
        "Column name:",
    )
    .await;
}

#[tokio::test]
async fn test_generate_table_ddl_impl_returns_validation_error_for_invalid_table_name() {
    let mut invalid_schema = schema(vec![column("id")]);
    invalid_schema.table_name = "a".repeat(65);

    assert_generate_table_ddl_validation_error(
        GenerateDdlRequest {
            original_schema: None,
            current_schema: invalid_schema,
            database: "appdb".to_string(),
            mode: "create".to_string(),
        },
        "Table name:",
    )
    .await;
}

#[tokio::test]
async fn test_generate_table_ddl_impl_returns_validation_error_for_invalid_original_schema() {
    assert_generate_table_ddl_validation_error(
        GenerateDdlRequest {
            original_schema: Some(schema(vec![column("")])),
            current_schema: schema(vec![column("id")]),
            database: "appdb".to_string(),
            mode: "alter".to_string(),
        },
        "Column name:",
    )
    .await;
}

#[tokio::test]
async fn test_generate_table_ddl_impl_returns_validation_error_for_invalid_database_name() {
    assert_generate_table_ddl_validation_error(
        GenerateDdlRequest {
            original_schema: None,
            current_schema: schema(vec![column("id")]),
            database: "a".repeat(65),
            mode: "create".to_string(),
        },
        "Database name:",
    )
    .await;
}

async fn assert_generate_table_ddl_validation_error(
    request: GenerateDdlRequest,
    expected_fragment: &str,
) {
    let error = generate_table_ddl_impl(request)
        .await
        .expect_err("invalid designer input should surface a validation error");

    assert!(
        error.contains(expected_fragment),
        "unexpected error: {error}"
    );
}

// ── CREATE TABLE: FULLTEXT index ──────────────────────────────────
#[test]
fn test_create_table_with_fulltext_index() {
    let mut table = schema(vec![column("title")]);
    table
        .indexes
        .push(index("ft_title", "FULLTEXT", &["title"]));

    let ddl = generate_create_table_ddl(&table, "appdb");
    assert!(
        ddl.contains("FULLTEXT KEY `ft_title` (`title`)"),
        "DDL should contain FULLTEXT KEY clause, got: {ddl}"
    );
}

// ── CREATE TABLE: type_modifier (UNSIGNED) ───────────────────────
#[test]
fn test_create_table_with_type_modifier() {
    let mut col = column("age");
    col.r#type = "INT".to_string();
    col.type_modifier = "UNSIGNED".to_string();

    let ddl = generate_create_table_ddl(&schema(vec![col]), "appdb");
    assert!(
        ddl.contains("`age` INT UNSIGNED NOT NULL"),
        "DDL should include UNSIGNED modifier, got: {ddl}"
    );
}

// ── CREATE TABLE: type_modifier with length ──────────────────────
#[test]
fn test_create_table_with_type_modifier_and_length() {
    let mut col = column("counter");
    col.r#type = "INT".to_string();
    col.length = "11".to_string();
    col.type_modifier = "UNSIGNED".to_string();

    let ddl = generate_create_table_ddl(&schema(vec![col]), "appdb");
    assert!(
        ddl.contains("`counter` INT(11) UNSIGNED NOT NULL"),
        "DDL should include length and UNSIGNED, got: {ddl}"
    );
}

// ── CREATE TABLE: all table properties ───────────────────────────
#[test]
fn test_create_table_with_all_properties() {
    let mut table = schema(vec![column("id")]);
    table.properties.engine = "InnoDB".to_string();
    table.properties.charset = "utf8mb4".to_string();
    table.properties.collation = "utf8mb4_unicode_ci".to_string();
    table.properties.auto_increment = Some(100);
    table.properties.row_format = "Dynamic".to_string();
    table.properties.comment = "my table".to_string();

    let ddl = generate_create_table_ddl(&table, "appdb");
    assert!(ddl.contains("ENGINE=InnoDB"), "missing ENGINE, got: {ddl}");
    assert!(
        ddl.contains("DEFAULT CHARSET=utf8mb4"),
        "missing CHARSET, got: {ddl}"
    );
    assert!(
        ddl.contains("COLLATE=utf8mb4_unicode_ci"),
        "missing COLLATE, got: {ddl}"
    );
    assert!(
        ddl.contains("AUTO_INCREMENT=100"),
        "missing AUTO_INCREMENT, got: {ddl}"
    );
    assert!(
        ddl.contains("ROW_FORMAT=Dynamic"),
        "missing ROW_FORMAT, got: {ddl}"
    );
    assert!(
        ddl.contains("COMMENT='my table'"),
        "missing COMMENT, got: {ddl}"
    );
}

// ── ALTER TABLE: charset change ──────────────────────────────────
#[test]
fn test_alter_table_charset_change() {
    let original = schema(vec![column("id")]);
    let mut current = schema(vec![column("id")]);
    current.properties.charset = "utf8mb4".to_string();

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("DEFAULT CHARSET=utf8mb4"),
        "missing charset change, got: {ddl}"
    );
}

// ── ALTER TABLE: collation change ────────────────────────────────
#[test]
fn test_alter_table_collation_change() {
    let original = schema(vec![column("id")]);
    let mut current = schema(vec![column("id")]);
    current.properties.collation = "utf8mb4_unicode_ci".to_string();

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("COLLATE=utf8mb4_unicode_ci"),
        "missing collation change, got: {ddl}"
    );
}

// ── ALTER TABLE: auto_increment change ───────────────────────────
#[test]
fn test_alter_table_auto_increment_change() {
    let original = schema(vec![column("id")]);
    let mut current = schema(vec![column("id")]);
    current.properties.auto_increment = Some(500);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("AUTO_INCREMENT=500"),
        "missing AUTO_INCREMENT change, got: {ddl}"
    );
}

// ── ALTER TABLE: row_format change ───────────────────────────────
#[test]
fn test_alter_table_row_format_change() {
    let original = schema(vec![column("id")]);
    let mut current = schema(vec![column("id")]);
    current.properties.row_format = "Compressed".to_string();

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("ROW_FORMAT=Compressed"),
        "missing ROW_FORMAT change, got: {ddl}"
    );
}

// ── ALTER TABLE: comment change ──────────────────────────────────
#[test]
fn test_alter_table_comment_change() {
    let original = schema(vec![column("id")]);
    let mut current = schema(vec![column("id")]);
    current.properties.comment = "updated comment".to_string();

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("COMMENT='updated comment'"),
        "missing COMMENT change, got: {ddl}"
    );
}

// ── ALTER TABLE: comment cleared to empty ────────────────────────
#[test]
fn test_alter_table_comment_cleared() {
    let mut original = schema(vec![column("id")]);
    original.properties.comment = "old comment".to_string();
    let current = schema(vec![column("id")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("COMMENT=''"),
        "clearing comment should produce empty COMMENT clause, got: {ddl}"
    );
}

// ── ALTER TABLE: primary key addition ────────────────────────────
#[test]
fn test_alter_table_add_primary_key() {
    let original = schema(vec![column("id")]);
    let mut pk_col = column("id");
    pk_col.is_primary_key = true;
    let current = schema(vec![pk_col]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("ADD PRIMARY KEY (`id`)"),
        "missing ADD PRIMARY KEY, got: {ddl}"
    );
}

// ── ALTER TABLE: primary key removal ─────────────────────────────
#[test]
fn test_alter_table_drop_primary_key() {
    let mut pk_col = column("id");
    pk_col.is_primary_key = true;
    let original = schema(vec![pk_col]);
    let current = schema(vec![column("id")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("DROP PRIMARY KEY"),
        "missing DROP PRIMARY KEY, got: {ddl}"
    );
}

// ── ALTER TABLE: primary key swap ────────────────────────────────
#[test]
fn test_alter_table_change_primary_key_columns() {
    let mut pk_id = column("id");
    pk_id.is_primary_key = true;
    let original = schema(vec![pk_id.clone(), column("email")]);

    let mut pk_email = column("email");
    pk_email.is_primary_key = true;
    let current = schema(vec![column("id"), pk_email]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("DROP PRIMARY KEY"),
        "should drop old PK, got: {ddl}"
    );
    assert!(
        ddl.contains("ADD PRIMARY KEY (`email`)"),
        "should add new PK, got: {ddl}"
    );
}

// ── ALTER TABLE: add FULLTEXT index ──────────────────────────────
#[test]
fn test_alter_table_add_fulltext_index() {
    let original = schema(vec![column("body")]);
    let mut current = schema(vec![column("body")]);
    current
        .indexes
        .push(index("ft_body", "FULLTEXT", &["body"]));

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("ADD FULLTEXT KEY `ft_body` (`body`)"),
        "missing FULLTEXT ADD, got: {ddl}"
    );
}

// ── ALTER TABLE: add regular INDEX (not UNIQUE/FULLTEXT) ─────────
#[test]
fn test_alter_table_add_regular_index() {
    let original = schema(vec![column("email")]);
    let mut current = schema(vec![column("email")]);
    current
        .indexes
        .push(index("idx_email", "INDEX", &["email"]));

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("ADD INDEX `idx_email` (`email`)"),
        "missing ADD INDEX, got: {ddl}"
    );
}

// ── ALTER TABLE: column type_modifier change triggers MODIFY ─────
#[test]
fn test_alter_table_modify_column_type_modifier_change() {
    let original = schema(vec![column("age")]);
    let mut changed = column("age");
    changed.type_modifier = "UNSIGNED".to_string();
    let current = schema(vec![changed]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("MODIFY COLUMN `age` INT UNSIGNED NOT NULL"),
        "modifier change should trigger MODIFY, got: {ddl}"
    );
}

// ── ALTER TABLE: column auto_increment change triggers MODIFY ────
#[test]
fn test_alter_table_modify_column_auto_increment_change() {
    let original = schema(vec![column("id")]);
    let mut changed = column("id");
    changed.is_auto_increment = true;
    let current = schema(vec![changed]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT"),
        "auto_increment change should trigger MODIFY, got: {ddl}"
    );
}

// ── ALTER TABLE: invalid original schema returns empty DDL ───────
#[test]
fn test_alter_table_invalid_original_schema_returns_empty() {
    let original = schema(vec![column("")]);
    let current = schema(vec![column("id")]);

    let (ddl, warnings) = generate_alter_table_ddl(&original, &current, "appdb");
    assert_eq!(ddl, "");
    assert!(warnings.is_empty());
}

// ── ALTER TABLE: invalid current schema returns empty DDL ────────
#[test]
fn test_alter_table_invalid_current_schema_returns_empty() {
    let original = schema(vec![column("id")]);
    let current = schema(vec![column("")]);

    let (ddl, warnings) = generate_alter_table_ddl(&original, &current, "appdb");
    assert_eq!(ddl, "");
    assert!(warnings.is_empty());
}

// ── ALTER TABLE: invalid database returns empty DDL ──────────────
#[test]
fn test_alter_table_invalid_database_returns_empty() {
    let original = schema(vec![column("id")]);
    let current = schema(vec![column("id"), column("email")]);

    let (ddl, warnings) = generate_alter_table_ddl(&original, &current, &"x".repeat(65));
    assert_eq!(ddl, "");
    assert!(warnings.is_empty());
}

// ── ALTER TABLE: blank table name returns empty DDL ──────────────
#[test]
fn test_alter_table_blank_table_name_returns_empty() {
    let original = schema(vec![column("id")]);
    let mut current = schema(vec![column("id"), column("email")]);
    current.table_name = "   ".to_string();

    let (ddl, warnings) = generate_alter_table_ddl(&original, &current, "appdb");
    assert_eq!(ddl, "");
    assert!(warnings.is_empty());
}

// ── Serde: DefaultValueModel round-trips all variants ────────────
#[test]
fn test_default_value_model_serde_round_trips() {
    let variants = vec![
        DefaultValueModel::NoDefault,
        DefaultValueModel::NullDefault,
        DefaultValueModel::Literal {
            value: "hello".to_string(),
        },
        DefaultValueModel::Expression {
            value: "NOW()".to_string(),
        },
    ];

    for variant in &variants {
        let json = serde_json::to_string(variant).expect("should serialize");
        let deserialized: DefaultValueModel =
            serde_json::from_str(&json).expect("should deserialize");
        assert_eq!(*variant, deserialized, "round-trip failed for: {json}");
    }
}

// ── Serde: DesignerColumnDef round-trip ──────────────────────────
#[test]
fn test_designer_column_def_serde_round_trip() {
    let col = DesignerColumnDef {
        name: "age".to_string(),
        r#type: "INT".to_string(),
        type_modifier: "UNSIGNED".to_string(),
        length: "11".to_string(),
        nullable: true,
        is_primary_key: false,
        is_auto_increment: false,
        default_value: DefaultValueModel::Literal {
            value: "0".to_string(),
        },
        comment: "user's age".to_string(),
        original_name: "age".to_string(),
    };

    let json = serde_json::to_string(&col).expect("should serialize");
    let deserialized: DesignerColumnDef = serde_json::from_str(&json).expect("should deserialize");
    assert_eq!(col, deserialized);
    assert!(json.contains("\"typeModifier\":\"UNSIGNED\""));
}

// ── Serde: DesignerIndexDef round-trip ───────────────────────────
#[test]
fn test_designer_index_def_serde_round_trip() {
    let idx = index("idx_email", "UNIQUE", &["email"]);
    let json = serde_json::to_string(&idx).expect("should serialize");
    let deserialized: DesignerIndexDef = serde_json::from_str(&json).expect("should deserialize");
    assert_eq!(idx, deserialized);
}

// ── Serde: DesignerForeignKeyDef round-trip ──────────────────────
#[test]
fn test_designer_foreign_key_def_serde_round_trip() {
    let fk = foreign_key("fk_test", "user_id");
    let json = serde_json::to_string(&fk).expect("should serialize");
    let deserialized: DesignerForeignKeyDef =
        serde_json::from_str(&json).expect("should deserialize");
    assert_eq!(fk, deserialized);
}

// ── Serde: DesignerTableProperties round-trip ────────────────────
#[test]
fn test_designer_table_properties_serde_round_trip() {
    let props = DesignerTableProperties {
        engine: "InnoDB".to_string(),
        charset: "utf8mb4".to_string(),
        collation: "utf8mb4_general_ci".to_string(),
        auto_increment: Some(42),
        row_format: "Compact".to_string(),
        comment: "test comment".to_string(),
    };
    let json = serde_json::to_string(&props).expect("should serialize");
    let deserialized: DesignerTableProperties =
        serde_json::from_str(&json).expect("should deserialize");
    assert_eq!(props, deserialized);
}

// ── Serde: DesignerTableSchema round-trip ────────────────────────
#[test]
fn test_designer_table_schema_serde_round_trip() {
    let mut table = schema(vec![column("id"), column("email")]);
    table.indexes.push(index("idx_email", "INDEX", &["email"]));
    table.foreign_keys.push(foreign_key("fk_test", "email"));
    table.properties.engine = "InnoDB".to_string();

    let json = serde_json::to_string(&table).expect("should serialize");
    let deserialized: DesignerTableSchema =
        serde_json::from_str(&json).expect("should deserialize");
    assert_eq!(table, deserialized);
}

// ── ALTER TABLE: multiple table option changes at once ───────────
#[test]
fn test_alter_table_multiple_option_changes() {
    let original = schema(vec![column("id")]);
    let mut current = schema(vec![column("id")]);
    current.properties.engine = "MyISAM".to_string();
    current.properties.charset = "latin1".to_string();
    current.properties.collation = "latin1_swedish_ci".to_string();
    current.properties.auto_increment = Some(1000);
    current.properties.row_format = "Fixed".to_string();
    current.properties.comment = "new comment".to_string();

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(ddl.contains("ENGINE=MyISAM"), "got: {ddl}");
    assert!(ddl.contains("DEFAULT CHARSET=latin1"), "got: {ddl}");
    assert!(ddl.contains("COLLATE=latin1_swedish_ci"), "got: {ddl}");
    assert!(ddl.contains("AUTO_INCREMENT=1000"), "got: {ddl}");
    assert!(ddl.contains("ROW_FORMAT=Fixed"), "got: {ddl}");
    assert!(ddl.contains("COMMENT='new comment'"), "got: {ddl}");
}

// ── CREATE TABLE: comment with single quote escaping ─────────────
#[test]
fn test_create_table_comment_with_single_quote() {
    let mut col = column("name");
    col.comment = "user's name".to_string();

    let ddl = generate_create_table_ddl(&schema(vec![col]), "appdb");
    assert!(
        ddl.contains("COMMENT 'user''s name'"),
        "single quote should be escaped, got: {ddl}"
    );
}

// ── CREATE TABLE: table-level comment with single quote ──────────
#[test]
fn test_create_table_table_comment_with_single_quote() {
    let mut table = schema(vec![column("id")]);
    table.properties.comment = "it's a table".to_string();

    let ddl = generate_create_table_ddl(&table, "appdb");
    assert!(
        ddl.contains("COMMENT='it''s a table'"),
        "table comment quote should be escaped, got: {ddl}"
    );
}

// ── Query functions return non-empty strings ─────────────────────
// These are public functions that are only called from `#[cfg(not(coverage))]`
// code during normal execution, so they show as uncovered. Calling them here
// ensures the coverage instrumenter counts them.
#[test]
fn test_load_columns_query_returns_sql() {
    use sqllumen_lib::mysql::table_designer::{
        load_columns_query, load_foreign_keys_query, load_indexes_query, load_table_metadata_query,
    };

    let columns_sql = load_columns_query();
    assert!(
        columns_sql.contains("COLUMN_NAME"),
        "should contain COLUMN_NAME"
    );
    assert!(
        columns_sql.contains("INFORMATION_SCHEMA.COLUMNS"),
        "should query COLUMNS table"
    );

    let metadata_sql = load_table_metadata_query();
    assert!(metadata_sql.contains("ENGINE"), "should contain ENGINE");
    assert!(
        metadata_sql.contains("INFORMATION_SCHEMA.TABLES"),
        "should query TABLES table"
    );

    let indexes_sql = load_indexes_query();
    assert!(
        indexes_sql.contains("INDEX_NAME"),
        "should contain INDEX_NAME"
    );
    assert!(
        indexes_sql.contains("INFORMATION_SCHEMA.STATISTICS"),
        "should query STATISTICS table"
    );

    let fk_sql = load_foreign_keys_query();
    assert!(
        fk_sql.contains("CONSTRAINT_NAME"),
        "should contain CONSTRAINT_NAME"
    );
    assert!(
        fk_sql.contains("REFERENTIAL_CONSTRAINTS"),
        "should query FK tables"
    );
}

// ── ALTER TABLE: unchanged index is not dropped or re-added ──────
// This exercises the `indexes_equal` function which compares matching indexes
// between original and current schemas, returning true when they match.
#[test]
fn test_alter_table_unchanged_index_is_preserved() {
    let mut original = schema(vec![column("email"), column("name")]);
    original
        .indexes
        .push(index("idx_email", "INDEX", &["email"]));

    let mut current = schema(vec![column("email"), column("name")]);
    current
        .indexes
        .push(index("idx_email", "INDEX", &["email"]));
    // Only change the column to trigger MODIFY, not index changes
    let mut changed_name = column("name");
    changed_name.nullable = true;
    current.columns[1] = changed_name;

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    // The MODIFY should be present but no index changes
    assert!(
        ddl.contains("MODIFY COLUMN `name` INT NULL"),
        "should still MODIFY the changed column, got: {ddl}"
    );
    assert!(
        !ddl.contains("DROP INDEX"),
        "unchanged index should NOT be dropped, got: {ddl}"
    );
    assert!(
        !ddl.contains("ADD INDEX"),
        "unchanged index should NOT be re-added, got: {ddl}"
    );
}

// ── ALTER TABLE: unchanged foreign key is not dropped or re-added ─
// This exercises the `foreign_keys_equal` function which compares matching
// foreign keys between original and current schemas.
#[test]
fn test_alter_table_unchanged_foreign_key_is_preserved() {
    let mut original = schema(vec![column("role_id"), column("name")]);
    original
        .foreign_keys
        .push(foreign_key("fk_users_role", "role_id"));

    let mut current = schema(vec![column("role_id"), column("name")]);
    current
        .foreign_keys
        .push(foreign_key("fk_users_role", "role_id"));
    // Only change a column to trigger MODIFY
    let mut changed_name = column("name");
    changed_name.nullable = true;
    current.columns[1] = changed_name;

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    assert!(
        ddl.contains("MODIFY COLUMN `name` INT NULL"),
        "should still MODIFY the changed column, got: {ddl}"
    );
    assert!(
        !ddl.contains("DROP FOREIGN KEY"),
        "unchanged FK should NOT be dropped, got: {ddl}"
    );
    assert!(
        !ddl.contains("ADD CONSTRAINT"),
        "unchanged FK should NOT be re-added, got: {ddl}"
    );
}

// ── ALTER TABLE: auto_increment removed (Some → None) ────────────
#[test]
fn test_alter_table_auto_increment_removed() {
    let mut original = schema(vec![column("id")]);
    original.properties.auto_increment = Some(100);
    let current = schema(vec![column("id")]);

    let (ddl, _) = generate_alter_table_ddl(&original, &current, "appdb");
    // When auto_increment becomes None, the diff_table_options does NOT emit a clause
    // (since there's no "unset auto_increment" in MySQL ALTER TABLE).
    // The DDL should be empty since nothing else changed.
    assert_eq!(ddl, "", "removing auto_increment should not produce DDL");
}

#[cfg(not(coverage))]
mod command_wrapper_integration {
    use super::*;
    use crate::common::mock_mysql_server::{
        MockCell, MockColumnDef, MockMySqlServer, MockQueryStep,
    };
    use opensrv_mysql::{ColumnFlags, ColumnType};
    use rusqlite::Connection;
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use sqllumen_lib::commands::connections::{save_connection_impl, SaveConnectionInput};
    use sqllumen_lib::commands::mysql::{open_connection_impl, OpenConnectionResult};
    use sqllumen_lib::commands::table_designer::load_table_for_designer_impl;
    use sqllumen_lib::mysql::registry::ConnectionRegistry;
    use sqllumen_lib::state::AppState;
    use std::sync::{Arc, Mutex};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    fn test_state() -> AppState {
        common::ensure_fake_backend_once();
        let conn = Connection::open_in_memory().expect("should open in-memory db");
        sqllumen_lib::db::migrations::run_migrations(&conn).expect("should run migrations");
        AppState {
            db: Arc::new(Mutex::new(conn)),
            registry: ConnectionRegistry::new(),
            app_handle: None,
            results: std::sync::RwLock::new(std::collections::HashMap::new()),
            log_filter_reload: Mutex::new(None),
            running_queries: tokio::sync::RwLock::new(std::collections::HashMap::new()),
            dump_jobs: std::sync::Arc::new(
                std::sync::RwLock::new(std::collections::HashMap::new()),
            ),
            import_jobs: std::sync::Arc::new(std::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            ai_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
            index_build_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
            session_profile_map: Arc::new(Mutex::new(std::collections::HashMap::new())),
            session_ref_counts: Arc::new(Mutex::new(std::collections::HashMap::new())),
            http_client: reqwest::Client::new(),
        }
    }

    fn build_app() -> (
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
    ) {
        let app = mock_builder()
            .manage(test_state())
            .invoke_handler(tauri::generate_handler![
                save_connection,
                open_connection,
                load_table_for_designer
            ])
            .build(mock_context(noop_assets()))
            .expect("should build test app");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("should build test webview");
        (app, webview)
    }

    #[tauri::command]
    fn save_connection(
        data: SaveConnectionInput,
        state: tauri::State<'_, AppState>,
    ) -> Result<String, String> {
        save_connection_impl(&state, data)
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OpenConnectionPayloadDto {
        profile_id: String,
    }

    #[tauri::command]
    async fn open_connection(
        payload: OpenConnectionPayloadDto,
        state: tauri::State<'_, AppState>,
    ) -> Result<OpenConnectionResult, String> {
        open_connection_impl(&state, &payload.profile_id).await
    }

    #[tauri::command]
    async fn load_table_for_designer(
        state: tauri::State<'_, AppState>,
        connection_id: String,
        database: String,
        table_name: String,
    ) -> Result<DesignerTableSchema, String> {
        load_table_for_designer_impl(&state, &connection_id, &database, &table_name).await
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

    fn save_input_json(port: u16) -> serde_json::Value {
        let input = SaveConnectionInput {
            name: "Mock Table Designer DB".to_string(),
            host: "127.0.0.1".to_string(),
            port: i64::from(port),
            username: "root".to_string(),
            password: None,
            default_database: None,
            ssl_enabled: false,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            color: None,
            group_id: None,
            read_only: false,
            sort_order: 0,
            connect_timeout_secs: Some(2),
            keepalive_interval_secs: Some(0),
        };

        json!({
            "name": input.name,
            "host": input.host,
            "port": input.port,
            "username": input.username,
            "password": input.password,
            "defaultDatabase": input.default_database,
            "sslEnabled": input.ssl_enabled,
            "sslCaPath": input.ssl_ca_path,
            "sslCertPath": input.ssl_cert_path,
            "sslKeyPath": input.ssl_key_path,
            "color": input.color,
            "groupId": input.group_id,
            "readOnly": input.read_only,
            "sortOrder": input.sort_order,
            "connectTimeoutSecs": input.connect_timeout_secs,
            "keepaliveIntervalSecs": input.keepalive_interval_secs,
        })
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OpenConnectionResultDto {
        session_id: String,
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn load_table_for_designer_decodes_unsigned_auto_increment_metadata_via_ipc() {
        let server = MockMySqlServer::start_script(vec![
            MockQueryStep {
                query: "SELECT VERSION()",
                columns: vec![MockColumnDef {
                    name: "VERSION()",
                    coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                    colflags: ColumnFlags::NOT_NULL_FLAG,
                }],
                rows: vec![vec![MockCell::Bytes(b"8.0.36-mock")]],
                error: None,
            },
            MockQueryStep {
                query: sqllumen_lib::mysql::table_designer::load_columns_query(),
                columns: vec![
                    MockColumnDef {
                        name: "COLUMN_NAME",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "COLUMN_TYPE",
                        coltype: ColumnType::MYSQL_TYPE_BLOB,
                        colflags: ColumnFlags::NOT_NULL_FLAG | ColumnFlags::BINARY_FLAG,
                    },
                    MockColumnDef {
                        name: "IS_NULLABLE",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "COLUMN_KEY",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "COLUMN_DEFAULT",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::empty(),
                    },
                    MockColumnDef {
                        name: "EXTRA",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "COLUMN_COMMENT",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::empty(),
                    },
                ],
                rows: vec![
                    vec![
                        MockCell::Bytes(b"id"),
                        MockCell::Bytes(b"int(11) unsigned"),
                        MockCell::Bytes(b"NO"),
                        MockCell::Bytes(b"PRI"),
                        MockCell::Null,
                        MockCell::Bytes(b"auto_increment"),
                        MockCell::Bytes(b"primary key"),
                    ],
                    vec![
                        MockCell::Bytes(b"created_at"),
                        MockCell::Bytes(b"timestamp"),
                        MockCell::Bytes(b"NO"),
                        MockCell::Bytes(b""),
                        MockCell::Bytes(b"CURRENT_TIMESTAMP"),
                        MockCell::Bytes(b"DEFAULT_GENERATED"),
                        MockCell::Bytes(b"created time"),
                    ],
                    vec![
                        MockCell::Bytes(b"tracking_id"),
                        MockCell::Bytes(b"char(36)"),
                        MockCell::Bytes(b"NO"),
                        MockCell::Bytes(b""),
                        MockCell::Bytes(b"UUID()"),
                        MockCell::Bytes(b"DEFAULT_GENERATED"),
                        MockCell::Bytes(b"tracking identifier"),
                    ],
                ],
                error: None,
            },
            MockQueryStep {
                query: sqllumen_lib::mysql::table_designer::load_table_metadata_query(),
                columns: vec![
                    MockColumnDef {
                        name: "ENGINE",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::empty(),
                    },
                    MockColumnDef {
                        name: "TABLE_COLLATION",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::empty(),
                    },
                    MockColumnDef {
                        name: "AUTO_INCREMENT",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::UNSIGNED_FLAG,
                    },
                    MockColumnDef {
                        name: "ROW_FORMAT",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::empty(),
                    },
                    MockColumnDef {
                        name: "TABLE_COMMENT",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::empty(),
                    },
                ],
                rows: vec![vec![
                    MockCell::Bytes(b"InnoDB"),
                    MockCell::Bytes(b"utf8mb4_unicode_ci"),
                    MockCell::U64(7),
                    MockCell::Bytes(b"Dynamic"),
                    MockCell::Bytes(b"users table"),
                ]],
                error: None,
            },
            MockQueryStep {
                query: sqllumen_lib::mysql::table_designer::load_indexes_query(),
                columns: vec![
                    MockColumnDef {
                        name: "INDEX_NAME",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "NON_UNIQUE",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "COLUMN_NAME",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "INDEX_TYPE",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "SEQ_IN_INDEX",
                        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                ],
                rows: vec![vec![
                    MockCell::Bytes(b"PRIMARY"),
                    MockCell::I64(0),
                    MockCell::Bytes(b"id"),
                    MockCell::Bytes(b"BTREE"),
                    MockCell::I64(1),
                ]],
                error: None,
            },
            MockQueryStep {
                query: sqllumen_lib::mysql::table_designer::load_foreign_keys_query(),
                columns: vec![
                    MockColumnDef {
                        name: "CONSTRAINT_NAME",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "COLUMN_NAME",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "REFERENCED_TABLE_NAME",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "REFERENCED_COLUMN_NAME",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "DELETE_RULE",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                    MockColumnDef {
                        name: "UPDATE_RULE",
                        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                        colflags: ColumnFlags::NOT_NULL_FLAG,
                    },
                ],
                rows: vec![],
                error: None,
            },
        ])
        .await;

        let (_app, webview) = build_app();

        let profile_id: String = invoke_tauri_command(
            &webview,
            "save_connection",
            json!({ "data": save_input_json(server.port) }),
        )
        .expect("save_connection IPC should succeed");

        let open_result: OpenConnectionResultDto = invoke_tauri_command(
            &webview,
            "open_connection",
            json!({
                "payload": {
                    "profileId": profile_id,
                }
            }),
        )
        .expect("open_connection IPC should succeed");

        let schema: DesignerTableSchema = invoke_tauri_command(
            &webview,
            "load_table_for_designer",
            json!({
                "connectionId": open_result.session_id,
                "database": "app_db",
                "tableName": "users",
            }),
        )
        .expect("load_table_for_designer IPC should decode unsigned AUTO_INCREMENT metadata");

        assert_eq!(schema.table_name, "users");
        assert_eq!(schema.columns.len(), 3);
        assert_eq!(schema.columns[0].name, "id");
        assert_eq!(schema.columns[0].r#type, "INT");
        assert_eq!(schema.columns[0].type_modifier, "UNSIGNED");
        assert_eq!(schema.columns[0].length, "11");
        assert!(schema.columns[0].is_primary_key);
        assert!(schema.columns[0].is_auto_increment);
        assert_eq!(
            schema.columns[0].default_value,
            DefaultValueModel::NoDefault
        );
        assert_eq!(schema.columns[0].comment, "primary key");
        assert_eq!(schema.columns[1].name, "created_at");
        assert_eq!(schema.columns[1].r#type, "TIMESTAMP");
        assert_eq!(schema.columns[1].type_modifier, "");
        assert_eq!(schema.columns[1].length, "");
        assert!(!schema.columns[1].nullable);
        assert!(!schema.columns[1].is_primary_key);
        assert!(!schema.columns[1].is_auto_increment);
        assert_eq!(
            schema.columns[1].default_value,
            DefaultValueModel::Expression {
                value: "CURRENT_TIMESTAMP".to_string()
            }
        );
        assert_eq!(schema.columns[1].comment, "created time");
        assert_eq!(schema.columns[2].name, "tracking_id");
        assert_eq!(schema.columns[2].r#type, "CHAR");
        assert_eq!(schema.columns[2].length, "36");
        assert_eq!(
            schema.columns[2].default_value,
            DefaultValueModel::Expression {
                value: "UUID()".to_string()
            }
        );
        assert_eq!(schema.columns[2].comment, "tracking identifier");
        assert_eq!(schema.properties.engine, "InnoDB");
        assert_eq!(schema.properties.charset, "utf8mb4");
        assert_eq!(schema.properties.collation, "utf8mb4_unicode_ci");
        assert_eq!(schema.properties.auto_increment, Some(7));
        assert_eq!(schema.properties.row_format, "Dynamic");
        assert_eq!(schema.properties.comment, "users table");
        assert_eq!(schema.indexes.len(), 1);
        assert_eq!(schema.indexes[0].name, "PRIMARY");
        assert_eq!(schema.indexes[0].index_type, "PRIMARY");
        assert_eq!(schema.indexes[0].columns, vec!["id".to_string()]);

        let ddl = generate_create_table_ddl(&schema, "app_db");
        assert!(ddl.contains("`id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT"));
        assert!(ddl.contains(
            "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'created time'"
        ));
        assert!(ddl.contains(
            "`tracking_id` CHAR(36) NOT NULL DEFAULT UUID() COMMENT 'tracking identifier'"
        ));
    }
}

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use sqllumen_lib::commands::table_designer::{
        apply_table_ddl_impl, generate_table_ddl_impl, load_table_for_designer_impl,
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

    fn register_lazy_pool(state: &AppState, connection_id: &str, read_only: bool) {
        state.registry.insert(
            connection_id.to_string(),
            RegistryEntry {
                pool: dummy_lazy_pool(),
                session_id: connection_id.to_string(),
                profile_id: connection_id.to_string(),
                status: ConnectionStatus::Connected,
                server_version: "8.0.0".to_string(),
                cancellation_token: CancellationToken::new(),
                connection_params: StoredConnectionParams {
                    profile_id: connection_id.to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 13306,
                    username: "dummy".to_string(),
                    has_password: false,
                    keychain_ref: None,
                    default_database: Some("appdb".to_string()),
                    ssl_enabled: false,
                    ssl_ca_path: None,
                    ssl_cert_path: None,
                    ssl_key_path: None,
                    connect_timeout_secs: 10,
                    keepalive_interval_secs: 0,
                },
                read_only,
            },
        );
    }

    #[tokio::test]
    async fn load_table_for_designer_stub_errors_for_missing_connection() {
        let state = common::test_app_state();

        let result = load_table_for_designer_impl(&state, "missing", "appdb", "users").await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not open"));
    }

    #[tokio::test]
    async fn load_table_for_designer_stub_returns_empty_schema_for_registered_connection() {
        let state = common::test_app_state();
        register_lazy_pool(&state, "conn-1", false);

        let result = load_table_for_designer_impl(&state, "conn-1", "appdb", "users")
            .await
            .expect("registered connection should succeed");

        assert_eq!(result.table_name, "users");
        assert!(result.columns.is_empty());
        assert!(result.indexes.is_empty());
        assert!(result.foreign_keys.is_empty());
    }

    #[tokio::test]
    async fn generate_table_ddl_stub_supports_create_and_alter_modes() {
        let create_result = generate_table_ddl_impl(GenerateDdlRequest {
            original_schema: None,
            current_schema: schema(vec![column("id")]),
            database: "appdb".to_string(),
            mode: "create".to_string(),
        })
        .await
        .expect("create mode should succeed");
        assert_eq!(create_result.ddl, "");
        assert!(create_result.warnings.is_empty());

        let alter_result = generate_table_ddl_impl(GenerateDdlRequest {
            original_schema: Some(schema(vec![column("id")])),
            current_schema: schema(vec![column("id"), column("email")]),
            database: "appdb".to_string(),
            mode: "alter".to_string(),
        })
        .await
        .expect("alter mode should succeed when original schema is present");
        assert_eq!(alter_result.ddl, "");
        assert!(alter_result.warnings.is_empty());
    }

    #[tokio::test]
    async fn generate_table_ddl_stub_errors_for_missing_original_or_invalid_mode() {
        let missing_original = generate_table_ddl_impl(GenerateDdlRequest {
            original_schema: None,
            current_schema: schema(vec![column("id")]),
            database: "appdb".to_string(),
            mode: "alter".to_string(),
        })
        .await;
        assert!(missing_original.is_err());
        assert!(missing_original
            .unwrap_err()
            .contains("Original schema is required"));

        let invalid_mode = generate_table_ddl_impl(GenerateDdlRequest {
            original_schema: None,
            current_schema: schema(vec![column("id")]),
            database: "appdb".to_string(),
            mode: "drop".to_string(),
        })
        .await;
        assert!(invalid_mode.is_err());
        assert!(invalid_mode
            .unwrap_err()
            .contains("Unsupported DDL generation mode"));
    }

    #[tokio::test]
    async fn apply_table_ddl_stub_checks_read_only_missing_connection_and_empty_sql() {
        let read_only_state = common::test_app_state();
        register_lazy_pool(&read_only_state, "conn-ro", true);
        let read_only_result =
            apply_table_ddl_impl(&read_only_state, "conn-ro", "appdb", "ALTER TABLE x").await;
        assert!(read_only_result.is_err());
        assert!(read_only_result.unwrap_err().contains("read-only"));

        let state = common::test_app_state();
        let missing_connection =
            apply_table_ddl_impl(&state, "missing", "appdb", "ALTER TABLE x").await;
        assert!(missing_connection.is_err());
        assert!(missing_connection.unwrap_err().contains("not open"));

        register_lazy_pool(&state, "conn-1", false);
        let empty_ddl = apply_table_ddl_impl(&state, "conn-1", "appdb", "   ").await;
        assert!(empty_ddl.is_err());
        assert!(empty_ddl.unwrap_err().contains("DDL cannot be empty"));

        let success = apply_table_ddl_impl(
            &state,
            "conn-1",
            "appdb",
            "ALTER TABLE `users` ADD COLUMN `x` INT",
        )
        .await;
        assert!(success.is_ok());
    }
}
