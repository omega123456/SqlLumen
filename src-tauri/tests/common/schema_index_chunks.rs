use rusqlite::Connection;
use sqllumen_lib::schema_index::storage;
use sqllumen_lib::schema_index::types::{ChunkInsert, ChunkType};

pub struct TestTableChunk<'a> {
    pub connection_id: &'a str,
    pub db_name: &'a str,
    pub table_name: &'a str,
    pub embedding: Vec<f32>,
}

pub fn insert_table_chunk(conn: &Connection, chunk: TestTableChunk<'_>) -> i64 {
    let TestTableChunk {
        connection_id,
        db_name,
        table_name,
        embedding,
    } = chunk;
    let insert = ChunkInsert {
        connection_id: connection_id.to_string(),
        chunk_key: format!("table:{db_name}.{table_name}"),
        db_name: db_name.to_string(),
        table_name: table_name.to_string(),
        chunk_type: ChunkType::Table,
        ddl_text: format!("CREATE TABLE `{table_name}` (id INT PRIMARY KEY)"),
        ddl_hash: format!("hash_{table_name}"),
        model_id: "test-model".to_string(),
        ref_db_name: None,
        ref_table_name: None,
        embedding,
        text_for_embedding: None,
        row_count_approx: None,
    };
    storage::insert_chunk(conn, &insert).expect("insert table chunk")
}

pub const DEFAULT_CONNECTION_ID: &str = "conn-1";
pub const DEFAULT_DATABASE: &str = "testdb";

pub fn insert_default_table_chunk(conn: &Connection, table_name: &str, embedding: Vec<f32>) -> i64 {
    insert_table_chunk(
        conn,
        TestTableChunk {
            connection_id: DEFAULT_CONNECTION_ID,
            db_name: DEFAULT_DATABASE,
            table_name,
            embedding,
        },
    )
}
