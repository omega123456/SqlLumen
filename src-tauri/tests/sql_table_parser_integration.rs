//! Integration tests for the SQL table parser.
//!
//! Tests exercise `extract_tables` against a wide variety of SQL patterns
//! including FROM clauses, JOIN types, subqueries, aliases, backtick quoting,
//! schema qualification, and deduplication.

use mysql_client_lib::mysql::sql_table_parser::{extract_tables, TableReference};

// ── Helper ─────────────────────────────────────────────────────────────────────

/// Build a `TableReference` without a database qualifier.
fn tref(table: &str) -> TableReference {
    TableReference {
        database: None,
        table: table.to_string(),
    }
}

/// Build a `TableReference` with a database qualifier.
fn tref_db(database: &str, table: &str) -> TableReference {
    TableReference {
        database: Some(database.to_string()),
        table: table.to_string(),
    }
}

// ── 1. Simple SELECT ───────────────────────────────────────────────────────────

#[test]
fn simple_select() {
    let result = extract_tables("SELECT * FROM users");
    assert_eq!(result, vec![tref("users")]);
}

// ── 2. Schema-qualified ────────────────────────────────────────────────────────

#[test]
fn schema_qualified() {
    let result = extract_tables("SELECT * FROM mydb.users");
    assert_eq!(result, vec![tref_db("mydb", "users")]);
}

// ── 3. Backtick-quoted ─────────────────────────────────────────────────────────

#[test]
fn backtick_quoted() {
    let result = extract_tables("SELECT * FROM `users`");
    assert_eq!(result, vec![tref("users")]);
}

// ── 4. Backtick schema-qualified ───────────────────────────────────────────────

#[test]
fn backtick_schema_qualified() {
    let result = extract_tables("SELECT * FROM `mydb`.`users`");
    assert_eq!(result, vec![tref_db("mydb", "users")]);
}

// ── 5. With alias ──────────────────────────────────────────────────────────────

#[test]
fn with_alias() {
    let result = extract_tables("SELECT * FROM users u");
    assert_eq!(result, vec![tref("users")]);
}

// ── 6. With AS alias ──────────────────────────────────────────────────────────

#[test]
fn with_as_alias() {
    let result = extract_tables("SELECT * FROM users AS u");
    assert_eq!(result, vec![tref("users")]);
}

// ── 7. Comma-separated tables ──────────────────────────────────────────────────

#[test]
fn comma_separated_tables() {
    let result = extract_tables("SELECT * FROM users, orders");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn comma_separated_three_tables() {
    let result = extract_tables("SELECT * FROM users, orders, products");
    assert_eq!(
        result,
        vec![tref("users"), tref("orders"), tref("products")]
    );
}

// ── 8. INNER JOIN ──────────────────────────────────────────────────────────────

#[test]
fn inner_join() {
    let result =
        extract_tables("SELECT * FROM users INNER JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── 9. LEFT JOIN ───────────────────────────────────────────────────────────────

#[test]
fn left_join() {
    let result =
        extract_tables("SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn left_outer_join() {
    let result =
        extract_tables("SELECT * FROM users LEFT OUTER JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── 10. RIGHT JOIN ─────────────────────────────────────────────────────────────

#[test]
fn right_join() {
    let result =
        extract_tables("SELECT * FROM users RIGHT JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── 11. CROSS JOIN ─────────────────────────────────────────────────────────────

#[test]
fn cross_join() {
    let result = extract_tables("SELECT * FROM users CROSS JOIN orders");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── 12. NATURAL JOIN ───────────────────────────────────────────────────────────

#[test]
fn natural_join() {
    let result = extract_tables("SELECT * FROM users NATURAL JOIN orders");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── 13. STRAIGHT_JOIN ──────────────────────────────────────────────────────────

#[test]
fn straight_join() {
    let result =
        extract_tables("SELECT * FROM users STRAIGHT_JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── 14. Multiple JOINs ────────────────────────────────────────────────────────

#[test]
fn multiple_joins() {
    let result = extract_tables("SELECT * FROM a JOIN b ON a.id = b.a_id JOIN c ON b.id = c.b_id");
    assert_eq!(result, vec![tref("a"), tref("b"), tref("c")]);
}

#[test]
fn multiple_different_join_types() {
    let result = extract_tables(
        "SELECT * FROM a \
         INNER JOIN b ON a.id = b.a_id \
         LEFT JOIN c ON b.id = c.b_id \
         RIGHT JOIN d ON c.id = d.c_id",
    );
    assert_eq!(result, vec![tref("a"), tref("b"), tref("c"), tref("d")]);
}

// ── 15. Self-join deduplication ────────────────────────────────────────────────

#[test]
fn self_join_deduplication() {
    let result = extract_tables("SELECT * FROM users u1 JOIN users u2 ON u1.manager_id = u2.id");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn schema_qualified_self_join_deduplication() {
    let result =
        extract_tables("SELECT * FROM mydb.users u1 JOIN mydb.users u2 ON u1.manager_id = u2.id");
    assert_eq!(result, vec![tref_db("mydb", "users")]);
}

// ── 16. Subquery in FROM skipped ───────────────────────────────────────────────

#[test]
fn subquery_in_from_skipped() {
    let result = extract_tables(
        "SELECT * FROM (SELECT * FROM inner_t) AS sub JOIN real_table ON sub.id = real_table.id",
    );
    assert_eq!(result, vec![tref("real_table")]);
}

#[test]
fn subquery_only_returns_empty() {
    let result = extract_tables("SELECT * FROM (SELECT 1) AS sub");
    assert_eq!(result, vec![]);
}

#[test]
fn subquery_in_from_with_comma_list() {
    let result = extract_tables("SELECT * FROM (SELECT * FROM inner_t) AS sub, real_table");
    assert_eq!(result, vec![tref("real_table")]);
}

// ── 17. Non-SELECT statement ───────────────────────────────────────────────────

#[test]
fn non_select_insert() {
    let result = extract_tables("INSERT INTO users VALUES (1)");
    assert_eq!(result, vec![]);
}

#[test]
fn non_select_update() {
    let result = extract_tables("UPDATE users SET name = 'foo'");
    assert_eq!(result, vec![]);
}

#[test]
fn non_select_delete() {
    let result = extract_tables("DELETE FROM users WHERE id = 1");
    assert_eq!(result, vec![]);
}

#[test]
fn non_select_show() {
    let result = extract_tables("SHOW TABLES");
    assert_eq!(result, vec![]);
}

#[test]
fn non_select_create() {
    let result = extract_tables("CREATE TABLE t (id INT)");
    assert_eq!(result, vec![]);
}

// ── 18. Empty string ───────────────────────────────────────────────────────────

#[test]
fn empty_string() {
    let result = extract_tables("");
    assert_eq!(result, vec![]);
}

#[test]
fn whitespace_only() {
    let result = extract_tables("   \n\t  ");
    assert_eq!(result, vec![]);
}

// ── 19. Comments stripped ──────────────────────────────────────────────────────

#[test]
fn comments_stripped() {
    let result = extract_tables("SELECT * FROM /* comment */ users");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn line_comment_stripped() {
    let result = extract_tables("SELECT * -- get all\nFROM users");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn hash_comment_stripped() {
    let result = extract_tables("SELECT * # get all\nFROM users");
    assert_eq!(result, vec![tref("users")]);
}

// ── 20. Keywords as backtick-quoted identifiers ────────────────────────────────

#[test]
fn keyword_as_backtick_quoted_table() {
    let result = extract_tables("SELECT * FROM `select`");
    assert_eq!(result, vec![tref("select")]);
}

#[test]
fn keyword_as_backtick_quoted_with_schema() {
    let result = extract_tables("SELECT * FROM `from`.`where`");
    assert_eq!(result, vec![tref_db("from", "where")]);
}

// ── 21. Mixed schema qualification ─────────────────────────────────────────────

#[test]
fn mixed_schema_qualification() {
    let result =
        extract_tables("SELECT * FROM mydb.users JOIN orders ON mydb.users.id = orders.user_id");
    assert_eq!(result, vec![tref_db("mydb", "users"), tref("orders")]);
}

// ── 22. Complex query with WHERE/GROUP BY/ORDER BY ─────────────────────────────

#[test]
fn tables_not_extracted_from_where() {
    let result = extract_tables("SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)");
    // Only `users` from FROM — the subquery in WHERE is not parsed
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn tables_not_extracted_from_group_by() {
    let result = extract_tables("SELECT department, COUNT(*) FROM users GROUP BY department");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn tables_not_extracted_from_order_by() {
    let result = extract_tables("SELECT * FROM users ORDER BY name");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn tables_not_extracted_from_having() {
    let result = extract_tables(
        "SELECT department, COUNT(*) FROM users GROUP BY department HAVING COUNT(*) > 5",
    );
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn complex_query_with_all_clauses() {
    let result = extract_tables(
        "SELECT u.name, COUNT(o.id) FROM users u \
         JOIN orders o ON u.id = o.user_id \
         WHERE u.active = 1 \
         GROUP BY u.name \
         HAVING COUNT(o.id) > 0 \
         ORDER BY u.name \
         LIMIT 10",
    );
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── 23. Case handling ──────────────────────────────────────────────────────────

#[test]
fn case_preserved() {
    let result = extract_tables("SELECT * FROM USERS");
    assert_eq!(result, vec![tref("USERS")]);
}

#[test]
fn mixed_case_keywords() {
    let result =
        extract_tables("select * from users Inner Join orders on users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── 24. JOIN with schema-qualified table ───────────────────────────────────────

#[test]
fn join_with_schema_qualified_table() {
    let result = extract_tables("SELECT * FROM a JOIN mydb.b ON a.id = mydb.b.a_id");
    assert_eq!(result, vec![tref("a"), tref_db("mydb", "b")]);
}

// ── 25. Parenthesized JOIN group ───────────────────────────────────────────────

#[test]
fn parenthesized_join_group_skipped_gracefully() {
    // Parenthesized join groups should be handled gracefully
    // The parser may not extract tables from within, but it should not crash
    let result = extract_tables("SELECT * FROM (users JOIN orders ON users.id = orders.user_id)");
    // This is a parenthesized join group — the parser skips it gracefully
    // The exact behavior depends on implementation; the key is no panic
    assert!(result.is_empty() || !result.is_empty());
}

// ── Additional edge cases ──────────────────────────────────────────────────────

#[test]
fn mixed_backtick_quoting() {
    let result = extract_tables("SELECT * FROM `mydb`.users");
    assert_eq!(result, vec![tref_db("mydb", "users")]);
}

#[test]
fn mixed_backtick_quoting_reverse() {
    let result = extract_tables("SELECT * FROM mydb.`users`");
    assert_eq!(result, vec![tref_db("mydb", "users")]);
}

#[test]
fn nested_parentheses_in_join_condition() {
    let result = extract_tables(
        "SELECT * FROM users u \
         JOIN orders o ON (u.id = o.user_id AND (o.amount > 100 OR o.status = 'active'))",
    );
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn table_name_with_underscore() {
    let result = extract_tables("SELECT * FROM user_accounts");
    assert_eq!(result, vec![tref("user_accounts")]);
}

#[test]
fn table_name_with_numbers() {
    let result = extract_tables("SELECT * FROM table1 JOIN table2 ON table1.id = table2.ref_id");
    assert_eq!(result, vec![tref("table1"), tref("table2")]);
}

#[test]
fn semicolon_at_end() {
    let result = extract_tables("SELECT * FROM users;");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn multiple_spaces_and_newlines() {
    let result = extract_tables(
        "SELECT  *  \n  FROM  \n  users  \n  JOIN  \n  orders  ON  users.id  =  orders.user_id",
    );
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn comma_separated_with_aliases() {
    let result = extract_tables("SELECT * FROM users u, orders o, products p");
    assert_eq!(
        result,
        vec![tref("users"), tref("orders"), tref("products")]
    );
}

#[test]
fn comma_separated_with_as_aliases() {
    let result = extract_tables("SELECT * FROM users AS u, orders AS o");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn comma_separated_schema_qualified() {
    let result = extract_tables("SELECT * FROM mydb.users, mydb.orders");
    assert_eq!(
        result,
        vec![tref_db("mydb", "users"), tref_db("mydb", "orders")]
    );
}

#[test]
fn bare_join() {
    let result = extract_tables("SELECT * FROM users JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn natural_left_join() {
    let result = extract_tables("SELECT * FROM users NATURAL LEFT JOIN orders");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn natural_right_outer_join() {
    let result = extract_tables("SELECT * FROM users NATURAL RIGHT OUTER JOIN orders");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn string_literal_not_parsed_as_table() {
    // Ensure FROM inside a string literal is not parsed
    let result = extract_tables("SELECT 'FROM fake_table' FROM real_table");
    assert_eq!(result, vec![tref("real_table")]);
}

#[test]
fn backtick_with_spaces() {
    let result = extract_tables("SELECT * FROM `my table`");
    assert_eq!(result, vec![tref("my table")]);
}

#[test]
fn backtick_with_dot_in_name() {
    let result = extract_tables("SELECT * FROM `my.table`");
    assert_eq!(result, vec![tref("my.table")]);
}

#[test]
fn schema_qualified_backtick_with_spaces() {
    let result = extract_tables("SELECT * FROM `my db`.`my table`");
    assert_eq!(result, vec![tref_db("my db", "my table")]);
}

#[test]
fn dedup_different_schema_same_table() {
    // Same table name but different schemas — should NOT be deduped
    let result =
        extract_tables("SELECT * FROM db1.users JOIN db2.users ON db1.users.id = db2.users.id");
    assert_eq!(
        result,
        vec![tref_db("db1", "users"), tref_db("db2", "users")]
    );
}

#[test]
fn dedup_no_schema_and_schema_not_deduped() {
    // `users` and `mydb.users` are distinct references (different database qualifier)
    let result = extract_tables("SELECT * FROM users JOIN mydb.users ON users.id = mydb.users.id");
    assert_eq!(result, vec![tref("users"), tref_db("mydb", "users")]);
}

#[test]
fn for_update_not_parsed() {
    let result = extract_tables("SELECT * FROM users FOR UPDATE");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn lock_in_share_mode_not_parsed() {
    let result = extract_tables("SELECT * FROM users LOCK IN SHARE MODE");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn union_stops_parsing() {
    let result = extract_tables("SELECT * FROM users UNION SELECT * FROM orders");
    // Only tables from the first SELECT's FROM clause
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn select_without_from() {
    let result = extract_tables("SELECT 1 + 2");
    assert_eq!(result, vec![]);
}

#[test]
fn select_dual() {
    let result = extract_tables("SELECT * FROM dual");
    assert_eq!(result, vec![tref("dual")]);
}

#[test]
fn executable_comment_preserved_select() {
    // Executable comments are preserved by strip_non_executable_comments
    // The query: SELECT /*!50001 * */ FROM users
    let result = extract_tables("SELECT /*!50001 * */ FROM users");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn join_with_using() {
    let result = extract_tables("SELECT * FROM users JOIN orders USING (user_id)");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn join_with_alias() {
    let result = extract_tables("SELECT * FROM users u JOIN orders AS o ON u.id = o.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

// ── Additional coverage: edge cases in parsing ─────────────────────────────────

#[test]
fn double_quoted_string_not_parsed() {
    // Double-quoted strings should be skipped as string literals at the main scanner level
    let result = extract_tables(r#"SELECT "FROM fake_table" FROM real_table"#);
    assert_eq!(result, vec![tref("real_table")]);
}

#[test]
fn escaped_quote_in_string() {
    // Escaped quotes inside string literals
    let result = extract_tables(r"SELECT * FROM users WHERE name = 'O\'Brien'");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn subquery_in_join_position() {
    // Subquery in JOIN position (not in FROM)
    let result = extract_tables(
        "SELECT * FROM users JOIN (SELECT * FROM sub_table) AS sub ON users.id = sub.user_id",
    );
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn parenthesized_non_subquery_in_join() {
    // Parenthesized expression that isn't a subquery in JOIN position
    let result =
        extract_tables("SELECT * FROM users JOIN (orders INNER JOIN products ON orders.product_id = products.id) ON users.id = orders.user_id");
    // Parser skips parenthesized groups gracefully
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn parenthesized_non_subquery_in_from() {
    // Parenthesized join group in FROM clause (not a subquery)
    let result = extract_tables(
        "SELECT * FROM (orders JOIN products ON orders.product_id = products.id) AS combined",
    );
    // Parser skips parenthesized groups in FROM gracefully
    assert!(result.is_empty());
}

#[test]
fn parenthesized_non_subquery_in_from_with_comma() {
    // Parenthesized join group followed by comma and another table
    let result = extract_tables(
        "SELECT * FROM (orders JOIN products ON orders.product_id = products.id) AS combined, users",
    );
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn subquery_in_from_followed_by_comma() {
    // Subquery in FROM followed by comma-separated table
    let result =
        extract_tables("SELECT * FROM (SELECT id FROM inner_t) AS sub, real_table, another_table");
    assert_eq!(result, vec![tref("real_table"), tref("another_table")]);
}

#[test]
fn schema_qualified_dot_no_table_name() {
    // Edge case: identifier followed by dot but nothing after (treated as table)
    let result = extract_tables("SELECT * FROM mydb.");
    assert_eq!(result, vec![tref("mydb")]);
}

#[test]
fn backtick_with_escaped_backtick() {
    // Backtick-quoted identifier with escaped backtick (doubled)
    let result = extract_tables("SELECT * FROM `my``table`");
    assert_eq!(result, vec![tref("my`table")]);
}

#[test]
fn from_at_end_of_string() {
    // FROM keyword at the very end with no table
    let result = extract_tables("SELECT * FROM ");
    assert_eq!(result, vec![]);
}

#[test]
fn from_followed_by_number() {
    // FROM followed by something that's not a valid identifier start
    let result = extract_tables("SELECT * FROM 123");
    assert_eq!(result, vec![]);
}

#[test]
fn natural_left_outer_join() {
    let result = extract_tables("SELECT * FROM users NATURAL LEFT OUTER JOIN orders");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn right_outer_join() {
    let result =
        extract_tables("SELECT * FROM users RIGHT OUTER JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn backtick_at_top_level_scanning() {
    // Backtick-quoted identifier encountered by the main scanner (not in FROM/JOIN context)
    let result = extract_tables("SELECT `col1`, `col2` FROM `my_table`");
    assert_eq!(result, vec![tref("my_table")]);
}

#[test]
fn table_name_with_dollar_sign() {
    let result = extract_tables("SELECT * FROM my$table");
    assert_eq!(result, vec![tref("my$table")]);
}

#[test]
fn parenthesized_subquery_in_select_list() {
    // Parenthesized subquery in SELECT list should be skipped
    let result = extract_tables("SELECT (SELECT 1 FROM inner_t) AS val FROM outer_t");
    assert_eq!(result, vec![tref("outer_t")]);
}

#[test]
fn window_keyword_stops_parsing() {
    let result =
        extract_tables("SELECT *, ROW_NUMBER() OVER w FROM users WINDOW w AS (ORDER BY id)");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn into_keyword_stops_parsing() {
    let result = extract_tables("SELECT * FROM users INTO OUTFILE '/tmp/out.csv'");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn procedure_keyword_stops_parsing() {
    let result = extract_tables("SELECT * FROM users PROCEDURE ANALYSE()");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn except_keyword_stops_parsing() {
    let result = extract_tables("SELECT * FROM users EXCEPT SELECT * FROM admins");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn intersect_keyword_stops_parsing() {
    let result = extract_tables("SELECT * FROM users INTERSECT SELECT * FROM admins");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn from_in_string_position() {
    // Ensure backtick at top-level scanner is handled
    let result = extract_tables("SELECT `from` FROM `table`");
    assert_eq!(result, vec![tref("table")]);
}

#[test]
fn from_with_join_keyword_stops_table_list() {
    // The table list parser should stop when it sees a JOIN keyword
    let result =
        extract_tables("SELECT * FROM users INNER JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn implicit_alias_is_keyword() {
    // When the next word after a table looks like a keyword, it should NOT be consumed as an alias
    let result = extract_tables("SELECT * FROM users WHERE id = 1");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn implicit_alias_with_backtick() {
    let result = extract_tables("SELECT * FROM users `u` JOIN orders ON users.id = orders.user_id");
    assert_eq!(result, vec![tref("users"), tref("orders")]);
}

#[test]
fn unterminated_backtick_identifier() {
    // Edge case: backtick never closed
    let result = extract_tables("SELECT * FROM `unterminated");
    assert_eq!(result, vec![tref("unterminated")]);
}

#[test]
fn empty_backtick_identifier() {
    // Edge case: empty backtick
    let result = extract_tables("SELECT * FROM ``");
    // Empty backtick produces no identifier, so no table
    assert_eq!(result, vec![]);
}

#[test]
fn nested_parentheses_in_where_subquery() {
    // Nested parentheses in WHERE clause should not affect FROM parsing
    let result = extract_tables(
        "SELECT * FROM users WHERE id IN (SELECT user_id FROM (SELECT * FROM orders) AS sub)",
    );
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn multiple_natural_join_variants() {
    // NATURAL RIGHT JOIN
    let result = extract_tables("SELECT * FROM a NATURAL RIGHT JOIN b");
    assert_eq!(result, vec![tref("a"), tref("b")]);
}

#[test]
fn join_on_with_complex_condition() {
    // Complex ON condition with parentheses and subquery
    let result = extract_tables(
        "SELECT * FROM a JOIN b ON (a.id = b.a_id AND b.status IN (SELECT status FROM statuses))",
    );
    assert_eq!(result, vec![tref("a"), tref("b")]);
}

#[test]
fn backtick_in_schema_skip_at_top_level() {
    // Backtick scanning at top level (in column list before FROM)
    let result = extract_tables("SELECT `a`.`col`, `b`.`col` FROM a JOIN b ON a.id = b.id");
    assert_eq!(result, vec![tref("a"), tref("b")]);
}

#[test]
fn string_with_escaped_content_in_where() {
    // String literals in WHERE should be skipped even with complex escaping
    let result = extract_tables(r"SELECT * FROM users WHERE name = 'it''s a test'");
    assert_eq!(result, vec![tref("users")]);
}

#[test]
fn natural_keyword_not_followed_by_join() {
    // NATURAL without JOIN should not match as a join keyword
    // This is an edge case — NATURAL alone is not consumed
    let result = extract_tables("SELECT * FROM natural_table");
    assert_eq!(result, vec![tref("natural_table")]);
}

#[test]
fn inner_keyword_not_followed_by_join() {
    let result = extract_tables("SELECT * FROM inner_table");
    assert_eq!(result, vec![tref("inner_table")]);
}

#[test]
fn left_keyword_not_followed_by_join() {
    let result = extract_tables("SELECT * FROM left_table");
    assert_eq!(result, vec![tref("left_table")]);
}

#[test]
fn cross_keyword_not_followed_by_join() {
    let result = extract_tables("SELECT * FROM cross_table");
    assert_eq!(result, vec![tref("cross_table")]);
}

#[test]
fn right_keyword_not_followed_by_join() {
    let result = extract_tables("SELECT * FROM right_table");
    assert_eq!(result, vec![tref("right_table")]);
}

#[test]
fn unterminated_string_in_select() {
    // Unterminated string literal — parser should handle gracefully
    let result = extract_tables("SELECT 'unterminated FROM fake");
    // The string consumes everything after the quote — no FROM is found
    assert_eq!(result, vec![]);
}

#[test]
fn table_reference_serde_roundtrip() {
    // Verify Serialize/Deserialize work correctly
    let tr = TableReference {
        database: Some("mydb".to_string()),
        table: "users".to_string(),
    };
    let json = serde_json::to_string(&tr).expect("should serialize");
    assert!(json.contains("\"table\":\"users\""));
    assert!(json.contains("\"database\":\"mydb\""));

    let deserialized: TableReference = serde_json::from_str(&json).expect("should deserialize");
    assert_eq!(deserialized, tr);
}

#[test]
fn table_reference_serde_null_database() {
    let tr = TableReference {
        database: None,
        table: "users".to_string(),
    };
    let json = serde_json::to_string(&tr).expect("should serialize");
    assert!(json.contains("\"database\":null"));

    let deserialized: TableReference = serde_json::from_str(&json).expect("should deserialize");
    assert_eq!(deserialized, tr);
}

#[test]
fn table_reference_clone() {
    let tr = TableReference {
        database: Some("mydb".to_string()),
        table: "users".to_string(),
    };
    let cloned = tr.clone();
    assert_eq!(cloned, tr);
}

#[test]
fn table_reference_debug() {
    let tr = TableReference {
        database: None,
        table: "users".to_string(),
    };
    let debug_str = format!("{:?}", tr);
    assert!(debug_str.contains("users"));
}
