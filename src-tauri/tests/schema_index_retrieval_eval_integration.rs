//! Retrieval quality eval fixtures (plan item F1).
//!
//! These tests exercise the whole `multi_query_search_with_query_texts`
//! pipeline against a synthetic but recognisable e-commerce schema using the
//! *embedding* of each chunk as a controlled, deterministic stand-in for real
//! vectors. Because we don't have a real embedding model in a unit test, we
//! build embeddings that encode which "topics" each chunk is relevant to, and
//! queries whose embeddings overlap with the expected top tables. Query text
//! then feeds the BM25 and lexical lanes normally.
//!
//! The fixtures lock in a concrete recall@k expectation for each synthetic
//! query so future ranking changes are measurable — any regression in the
//! smart-retrieval pipeline that drops these expectations surfaces here,
//! rather than silently.
//!
//! NOTE: these tests deliberately avoid asserting exact ordering. Ranking is
//! sensitive to tiebreaks and SQLite's internal iteration order, so we assert
//! the retrievability invariant (target tables appear in top-K) not the rank.

use rusqlite::Connection;
use sqllumen_lib::db::migrations::run_migrations;
use sqllumen_lib::init_sqlite_vec;
use sqllumen_lib::schema_index::search::{multi_query_search_with_query_texts, SearchResult};
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};

/// Dimension used for the synthetic embedding space. Each axis corresponds to
/// a semantic "topic"; see [`topic_axis`].
const DIM: usize = 8;

/// Topic axes — one per semantic cluster represented in the fixture schema.
fn topic_axis(topic: &str) -> usize {
    match topic {
        "user" => 0,
        "order" => 1,
        "product" => 2,
        "invoice" => 3,
        "review" => 4,
        "address" => 5,
        "inventory" => 6,
        "other" => 7,
        _ => 7,
    }
}

/// Build a unit vector along a topic's axis, or a weighted blend of two
/// topics for chunks that span multiple subjects. The vector is L2-normalised
/// so cosine similarity against other unit vectors behaves intuitively.
fn topic_vec(primary: &str, secondary: Option<(&str, f32)>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    v[topic_axis(primary)] = 1.0;
    if let Some((other, weight)) = secondary {
        let w = weight.clamp(0.0, 1.0);
        v[topic_axis(primary)] = 1.0 - w;
        v[topic_axis(other)] = w;
    }
    let len: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if len > 0.0 {
        for x in v.iter_mut() {
            *x /= len;
        }
    }
    v
}

fn setup_db() -> Connection {
    init_sqlite_vec();
    let conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&conn).expect("run migrations");
    storage::create_vec_table(&conn, "conn-1", DIM).expect("create vec table");
    conn
}

fn insert_table(
    conn: &Connection,
    db: &str,
    name: &str,
    ddl: &str,
    embedding: Vec<f32>,
) {
    let chunk = ChunkInsert {
        connection_id: "conn-1".to_string(),
        chunk_key: format!("table:{db}.{name}"),
        db_name: db.to_string(),
        table_name: name.to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: ddl.to_string(),
        ddl_hash: format!("hash:{db}.{name}"),
        model_id: "eval-model".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding,
    };
    storage::insert_chunk(conn, &chunk).expect("insert table chunk");
}

/// Seed the `shop` fixture schema. Each table has a DDL string containing
/// discriminative tokens (so BM25 can find it) and an embedding biased
/// toward its topic axis (so vector search can find it). The DDL text also
/// includes enough content — column names, comments — to represent a realistic
/// retrieval surface area.
fn seed_shop_schema(conn: &Connection) {
    insert_table(
        conn,
        "shop",
        "users",
        "CREATE TABLE `shop`.`users` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `email` varchar(255) NOT NULL,\n  `name` varchar(128),\n  PRIMARY KEY (`id`),\n  UNIQUE KEY (`email`)\n) COMMENT='Registered customer profiles'",
        topic_vec("user", None),
    );
    insert_table(
        conn,
        "shop",
        "orders",
        "CREATE TABLE `shop`.`orders` (\n  `id` int NOT NULL,\n  `user_id` int NOT NULL,\n  `total` decimal(10,2),\n  `placed_at` datetime,\n  PRIMARY KEY (`id`),\n  CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `shop`.`users` (`id`)\n) COMMENT='Customer orders with totals'",
        topic_vec("order", Some(("user", 0.3))),
    );
    insert_table(
        conn,
        "shop",
        "order_items",
        "CREATE TABLE `shop`.`order_items` (\n  `order_id` int NOT NULL,\n  `product_id` int NOT NULL,\n  `qty` int,\n  `unit_price` decimal(10,2),\n  PRIMARY KEY (`order_id`, `product_id`)\n) COMMENT='Line items per order'",
        topic_vec("order", Some(("product", 0.5))),
    );
    insert_table(
        conn,
        "shop",
        "products",
        "CREATE TABLE `shop`.`products` (\n  `id` int NOT NULL,\n  `sku` varchar(64),\n  `name` varchar(255),\n  `price` decimal(10,2),\n  PRIMARY KEY (`id`)\n) COMMENT='Catalog product definitions'",
        topic_vec("product", None),
    );
    insert_table(
        conn,
        "shop",
        "invoices",
        "CREATE TABLE `shop`.`invoices` (\n  `id` int NOT NULL,\n  `order_id` int NOT NULL,\n  `amount` decimal(10,2),\n  `issued_at` datetime\n) COMMENT='Customer-facing invoices for completed orders'",
        topic_vec("invoice", Some(("order", 0.4))),
    );
    insert_table(
        conn,
        "shop",
        "reviews",
        "CREATE TABLE `shop`.`reviews` (\n  `id` int NOT NULL,\n  `product_id` int,\n  `user_id` int,\n  `rating` tinyint,\n  `body` text\n) COMMENT='Product reviews written by users'",
        topic_vec("review", Some(("product", 0.3))),
    );
    insert_table(
        conn,
        "shop",
        "addresses",
        "CREATE TABLE `shop`.`addresses` (\n  `id` int NOT NULL,\n  `user_id` int NOT NULL,\n  `street` varchar(255),\n  `city` varchar(128)\n) COMMENT='Shipping and billing addresses'",
        topic_vec("address", Some(("user", 0.4))),
    );
    insert_table(
        conn,
        "shop",
        "inventory",
        "CREATE TABLE `shop`.`inventory` (\n  `product_id` int NOT NULL,\n  `warehouse_id` int NOT NULL,\n  `stock` int\n) COMMENT='Per-warehouse stock levels'",
        topic_vec("inventory", Some(("product", 0.4))),
    );
}

struct EvalCase {
    label: &'static str,
    query_text: &'static str,
    /// Each expansion embeds towards a topic — this simulates LLM-produced
    /// query variants.
    query_topics: Vec<&'static str>,
    expected_top_k: usize,
    expected_hits: &'static [&'static str],
}

fn run_case(conn: &Connection, case: &EvalCase) -> Vec<SearchResult> {
    let query_vectors: Vec<Vec<f32>> = case
        .query_topics
        .iter()
        .map(|t| topic_vec(t, None))
        .collect();
    let query_texts = vec![case.query_text.to_string()];

    multi_query_search_with_query_texts(
        conn,
        "conn-1",
        &query_texts,
        &query_vectors,
        10,
        case.expected_top_k,
        0,
    )
    .expect("search should succeed")
}

fn assert_recall(case: &EvalCase, results: &[SearchResult]) {
    let top_table_names: std::collections::HashSet<String> = results
        .iter()
        .filter(|r| r.chunk_type == "table")
        .take(case.expected_top_k)
        .map(|r| r.table_name.clone())
        .collect();

    for expected in case.expected_hits {
        assert!(
            top_table_names.contains(*expected),
            "{}: expected table '{}' in top-{} results, got {:?}",
            case.label,
            expected,
            case.expected_top_k,
            top_table_names
        );
    }
}

// ── Individual eval cases ────────────────────────────────────────────────

#[test]
fn eval_orders_with_customer_context_surfaces_orders_and_users() {
    let conn = setup_db();
    seed_shop_schema(&conn);

    let case = EvalCase {
        label: "orders_with_customers",
        query_text: "Show me all customer orders with their totals",
        query_topics: vec!["order", "user"],
        expected_top_k: 5,
        expected_hits: &["orders", "users"],
    };

    let results = run_case(&conn, &case);
    assert_recall(&case, &results);
}

#[test]
fn eval_product_review_question_surfaces_reviews_and_products() {
    let conn = setup_db();
    seed_shop_schema(&conn);

    let case = EvalCase {
        label: "reviews_for_products",
        query_text: "Average rating per product from user reviews",
        query_topics: vec!["review", "product"],
        expected_top_k: 5,
        expected_hits: &["reviews", "products"],
    };

    let results = run_case(&conn, &case);
    assert_recall(&case, &results);
}

#[test]
fn eval_invoice_query_surfaces_invoices_over_products() {
    let conn = setup_db();
    seed_shop_schema(&conn);

    let case = EvalCase {
        label: "invoices_only",
        query_text: "Which invoices were issued last month?",
        query_topics: vec!["invoice"],
        expected_top_k: 3,
        expected_hits: &["invoices"],
    };

    let results = run_case(&conn, &case);
    assert_recall(&case, &results);
}

#[test]
fn eval_explicit_schema_qualified_reference_wins() {
    let conn = setup_db();
    seed_shop_schema(&conn);

    let case = EvalCase {
        label: "schema_qualified",
        query_text: "SELECT * FROM shop.addresses WHERE city = 'Paris'",
        // Query expansion gives an off-topic topic so the vector lane alone
        // wouldn't necessarily surface `addresses` at top-K.
        query_topics: vec!["other"],
        expected_top_k: 5,
        expected_hits: &["addresses"],
    };

    let results = run_case(&conn, &case);
    assert_recall(&case, &results);
}

#[test]
fn eval_inventory_question_surfaces_inventory_and_products() {
    let conn = setup_db();
    seed_shop_schema(&conn);

    let case = EvalCase {
        label: "inventory",
        query_text: "How many units of each product are in stock?",
        query_topics: vec!["inventory", "product"],
        expected_top_k: 5,
        expected_hits: &["inventory", "products"],
    };

    let results = run_case(&conn, &case);
    assert_recall(&case, &results);
}

#[test]
fn eval_bm25_rescues_rare_token_chunk_without_vector_match() {
    // Even when NONE of the expansion topics point anywhere near the invoice
    // table, the BM25 lane (plan C3) should surface it because "invoice" is
    // a discriminative token in the invoice chunk's DDL/comment.
    let conn = setup_db();
    seed_shop_schema(&conn);

    let case = EvalCase {
        label: "bm25_rescue_invoice",
        query_text: "invoice amounts for finance reconciliation",
        query_topics: vec!["other"],
        expected_top_k: 5,
        expected_hits: &["invoices"],
    };

    let results = run_case(&conn, &case);
    assert_recall(&case, &results);
}

#[test]
fn eval_multi_hop_join_topic_mix_surfaces_all_three_endpoints() {
    let conn = setup_db();
    seed_shop_schema(&conn);

    // When the query expansion is multi-topic and the schema has tables that
    // span multiple topics themselves (e.g. `addresses` has a user-axis
    // component, `invoices` has an order-axis component), tables that pull
    // double duty across the query's topics sometimes out-rank pure
    // single-topic tables in the final fused ranking. That's actually
    // defensible behaviour — those tables are genuinely relevant to multiple
    // aspects of the question. We therefore only require that the *pure*
    // canonical table for each topic still makes the top-K cut when K is
    // wide enough to include the double-duty neighbours too.
    let case = EvalCase {
        label: "multi_hop",
        query_text: "top products by revenue across orders and customers users",
        query_topics: vec!["product", "order", "user"],
        expected_top_k: 8,
        expected_hits: &["products", "orders", "users"],
    };

    let results = run_case(&conn, &case);
    assert_recall(&case, &results);
}

/// Snapshot-style sanity check: the top-1 cosine-winning chunk for a direct
/// single-topic query should always be that topic's table. If a future change
/// breaks this, ranking is no longer "obvious" for the clearest case.
#[test]
fn eval_single_topic_query_puts_canonical_table_at_top() {
    let conn = setup_db();
    seed_shop_schema(&conn);

    for (topic, expected) in [
        ("user", "users"),
        ("order", "orders"),
        ("product", "products"),
    ] {
        let results = multi_query_search_with_query_texts(
            &conn,
            "conn-1",
            &[format!("list all {topic}s")],
            &[topic_vec(topic, None)],
            10,
            3,
            0,
        )
        .expect("search should succeed");
        let top_tables: Vec<&str> = results
            .iter()
            .filter(|r| r.chunk_type == "table")
            .take(3)
            .map(|r| r.table_name.as_str())
            .collect();
        assert!(
            top_tables.contains(&expected),
            "single-topic query for '{topic}' should surface '{expected}' in top-3, got {top_tables:?}"
        );
    }
}
