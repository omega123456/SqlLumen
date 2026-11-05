//! Minimal in-process MySQL protocol mock (opensrv) shared by integration tests.

use async_trait::async_trait;
use opensrv_mysql::{
    AsyncMysqlIntermediary, AsyncMysqlShim, Column, ColumnFlags, ColumnType, ErrorKind, InitWriter,
    OkResponse, ParamParser, QueryResultWriter, RowWriter, StatementMetaWriter, StatusFlags,
    ToMysqlValue,
};
use std::collections::HashMap;
use std::io;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::BufWriter;
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpListener;

#[derive(Debug, Clone)]
pub struct MockColumnDef {
    pub name: &'static str,
    pub coltype: ColumnType,
    pub colflags: ColumnFlags,
}

#[derive(Debug, Clone)]
pub enum MockCell {
    Null,
    I8(i8),
    U32(u32),
    I64(i64),
    U64(u64),
    F64(f64),
    DateTime(chrono::NaiveDateTime),
    Time(MockTimeValue),
    Bytes(&'static [u8]),
}

#[derive(Debug, Clone, Copy)]
pub struct MockTimeValue {
    pub negative: bool,
    pub hours: u32,
    pub minutes: u8,
    pub seconds: u8,
    pub microseconds: u32,
}

impl MockTimeValue {
    fn format_text(self) -> String {
        let sign = if self.negative { "-" } else { "" };
        if self.microseconds == 0 {
            format!(
                "{sign}{:02}:{:02}:{:02}",
                self.hours, self.minutes, self.seconds
            )
        } else {
            format!(
                "{sign}{:02}:{:02}:{:02}.{:06}",
                self.hours, self.minutes, self.seconds, self.microseconds
            )
        }
    }

    fn day_hour_parts(self) -> (u32, u8) {
        ((self.hours / 24), (self.hours % 24) as u8)
    }
}

impl ToMysqlValue for MockTimeValue {
    fn to_mysql_text<W: Write>(&self, w: &mut W) -> io::Result<()> {
        write_lenenc_str(w, self.format_text().as_bytes())
    }

    fn to_mysql_bin<W: Write>(&self, w: &mut W, c: &Column) -> io::Result<()> {
        if c.coltype != ColumnType::MYSQL_TYPE_TIME {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("tried to use {:?} as {:?}", self, c.coltype),
            ));
        }

        let (days, hours) = self.day_hour_parts();
        let has_fraction = self.microseconds != 0;

        w.write_all(&[if has_fraction { 12 } else { 8 }])?;
        w.write_all(&[u8::from(self.negative)])?;
        w.write_all(&days.to_le_bytes())?;
        w.write_all(&[hours, self.minutes, self.seconds])?;

        if has_fraction {
            w.write_all(&self.microseconds.to_le_bytes())?;
        }

        Ok(())
    }
}

fn write_lenenc_str<W: Write>(w: &mut W, bytes: &[u8]) -> io::Result<()> {
    write_lenenc_int(w, bytes.len() as u64)?;
    w.write_all(bytes)
}

fn write_lenenc_int<W: Write>(w: &mut W, value: u64) -> io::Result<()> {
    match value {
        0..=250 => w.write_all(&[value as u8]),
        251..=65_535 => {
            w.write_all(&[0xFC])?;
            w.write_all(&(value as u16).to_le_bytes())
        }
        65_536..=16_777_215 => {
            w.write_all(&[0xFD])?;
            let bytes = value.to_le_bytes();
            w.write_all(&bytes[..3])
        }
        _ => {
            w.write_all(&[0xFE])?;
            w.write_all(&value.to_le_bytes())
        }
    }
}

#[derive(Debug, Clone)]
pub struct MockQueryResponse {
    pub query: &'static str,
    pub columns: Vec<MockColumnDef>,
    pub row: Vec<MockCell>,
}

#[derive(Debug, Clone)]
pub struct MockQueryStep {
    pub query: &'static str,
    pub columns: Vec<MockColumnDef>,
    pub rows: Vec<Vec<MockCell>>,
    pub error: Option<(ErrorKind, &'static [u8])>,
    /// When `Some(n)`, this step completes with an OK packet reporting `n`
    /// affected rows instead of emitting a result set. Used to drive write
    /// impls (UPDATE/DELETE) that require `rows_affected() == 1`.
    pub affected_rows: Option<u64>,
}

impl From<MockQueryResponse> for MockQueryStep {
    fn from(response: MockQueryResponse) -> Self {
        Self {
            query: response.query,
            columns: response.columns,
            rows: vec![response.row],
            error: None,
            affected_rows: None,
        }
    }
}

impl MockQueryStep {
    /// Build a step that completes with an OK packet reporting `affected_rows`.
    /// Reached by both `on_query` and the prepared-statement `on_execute` path
    /// via the shared `write_step`.
    pub fn ok_affected(query: &'static str, affected_rows: u64) -> Self {
        Self {
            query,
            columns: Vec::new(),
            rows: Vec::new(),
            error: None,
            affected_rows: Some(affected_rows),
        }
    }
}

/// A text-protocol query answered like a stored procedure `CALL`: column-less
/// OK packets flagged "more results exist", then one row-bearing result set.
///
/// opensrv 0.7 always negotiates `CLIENT_DEPRECATE_EOF` and never sets
/// `SERVER_MORE_RESULTS_EXISTS` on a row set's terminating OK packet, so a row
/// set can only be the last one in a reply.
#[derive(Debug, Clone)]
pub struct MockMultiResultStep {
    pub query: &'static str,
    /// Affected-row counts of the OK packets sent before the result set.
    pub leading_ok_affected: Vec<u64>,
    pub columns: Vec<MockColumnDef>,
    pub rows: Vec<Vec<MockCell>>,
}

#[derive(Clone)]
struct MockMySqlBackend {
    steps: Arc<Vec<MockQueryStep>>,
    /// Multi-result steps paired with their opensrv column definitions, built
    /// up front because the result writer borrows columns for the whole reply.
    multi_result_steps: Arc<Vec<(MockMultiResultStep, Vec<Column>)>>,
    unsupported_prepared_prefixes: Arc<Vec<String>>,
    prepared_steps: HashMap<u32, MockQueryStep>,
    next_statement_id: u32,
    /// Text-protocol (COM_QUERY) statements received across all connections.
    text_queries: Arc<Mutex<Vec<String>>>,
}

const VERSION_STATEMENT_ID: u32 = 1;
const FIRST_QUERY_STATEMENT_ID: u32 = 2;

impl MockMySqlBackend {
    fn new(response: MockQueryResponse) -> Self {
        Self::with_steps(vec![response.into()])
    }

    fn with_steps(steps: Vec<MockQueryStep>) -> Self {
        Self::with_steps_and_unsupported_prepared_prefixes(steps, vec![])
    }

    fn with_steps_and_unsupported_prepared_prefixes(
        steps: Vec<MockQueryStep>,
        unsupported_prepared_prefixes: Vec<String>,
    ) -> Self {
        Self {
            steps: Arc::new(steps),
            multi_result_steps: Arc::default(),
            unsupported_prepared_prefixes: Arc::new(
                unsupported_prepared_prefixes
                    .into_iter()
                    .map(|prefix| prefix.to_ascii_uppercase())
                    .collect(),
            ),
            prepared_steps: HashMap::new(),
            next_statement_id: FIRST_QUERY_STATEMENT_ID,
            text_queries: Arc::default(),
        }
    }

    fn normalize_query(query: &str) -> String {
        query
            .trim()
            .trim_end_matches(';')
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// sqlx 0.9 rejects prepare replies whose parameter count differs from the bound arguments,
    /// so declare one parameter per `?` placeholder outside quoted strings and identifiers.
    fn placeholder_params(query: &str) -> Vec<Column> {
        let mut quote: Option<char> = None;
        let mut count = 0;
        for ch in query.chars() {
            match (quote, ch) {
                (Some(q), c) if c == q => quote = None,
                (Some(_), _) => {}
                (None, '\'' | '"' | '`') => quote = Some(ch),
                (None, '?') => count += 1,
                _ => {}
            }
        }
        (0..count)
            .map(|_| Column {
                table: String::new(),
                column: "?".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            })
            .collect()
    }

    fn find_step(&self, query: &str) -> Option<MockQueryStep> {
        let normalized = Self::normalize_query(query);
        self.steps
            .iter()
            .find(|step| Self::normalize_query(step.query).eq_ignore_ascii_case(&normalized))
            .cloned()
    }

    fn find_multi_result_step(&self, query: &str) -> Option<&(MockMultiResultStep, Vec<Column>)> {
        let normalized = Self::normalize_query(query);
        self.multi_result_steps
            .iter()
            .find(|(step, _)| Self::normalize_query(step.query).eq_ignore_ascii_case(&normalized))
    }

    fn rejects_prepared_statement(&self, query: &str) -> bool {
        let normalized = Self::normalize_query(query).to_ascii_uppercase();
        self.unsupported_prepared_prefixes
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
    }

    fn step_columns(step: &MockQueryStep) -> Vec<Column> {
        Self::mock_columns(&step.columns)
    }

    fn mock_columns(columns: &[MockColumnDef]) -> Vec<Column> {
        columns
            .iter()
            .map(|col| Column {
                table: String::new(),
                column: col.name.to_string(),
                coltype: col.coltype,
                colflags: col.colflags,
            })
            .collect()
    }

    async fn write_step(
        step: &MockQueryStep,
        results: QueryResultWriter<'_, BufWriter<OwnedWriteHalf>>,
    ) -> io::Result<()> {
        if let Some((kind, message)) = step.error {
            return results.error(kind, message).await;
        }

        if let Some(affected_rows) = step.affected_rows {
            return results
                .completed(OkResponse {
                    affected_rows,
                    ..Default::default()
                })
                .await;
        }

        let columns = Self::step_columns(step);

        let mut writer = results.start(&columns).await?;
        Self::write_rows(&mut writer, &step.rows).await?;
        writer.finish().await
    }

    async fn write_rows(
        writer: &mut RowWriter<'_, BufWriter<OwnedWriteHalf>>,
        rows: &[Vec<MockCell>],
    ) -> io::Result<()> {
        for row in rows {
            for cell in row {
                match cell {
                    MockCell::Null => writer.write_col(Option::<u8>::None)?,
                    MockCell::I8(value) => writer.write_col(*value)?,
                    MockCell::U32(value) => writer.write_col(*value)?,
                    MockCell::I64(value) => writer.write_col(*value)?,
                    MockCell::U64(value) => writer.write_col(*value)?,
                    MockCell::F64(value) => writer.write_col(*value)?,
                    MockCell::DateTime(value) => writer.write_col(*value)?,
                    MockCell::Time(value) => writer.write_col(*value)?,
                    MockCell::Bytes(value) => writer.write_col(*value)?,
                }
            }
            writer.end_row().await?;
        }
        Ok(())
    }

    async fn write_multi_result_step<'a>(
        step: &'a MockMultiResultStep,
        columns: &'a [Column],
        mut results: QueryResultWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> io::Result<()> {
        for &affected_rows in &step.leading_ok_affected {
            results = results
                .complete_one(OkResponse {
                    affected_rows,
                    status_flags: StatusFlags::SERVER_MORE_RESULTS_EXISTS,
                    ..Default::default()
                })
                .await?;
        }
        let mut writer = results.start(columns).await?;
        Self::write_rows(&mut writer, &step.rows).await?;
        writer.finish().await
    }
}

#[async_trait]
impl AsyncMysqlShim<BufWriter<OwnedWriteHalf>> for MockMySqlBackend {
    type Error = io::Error;

    async fn on_prepare<'a>(
        &'a mut self,
        query: &'a str,
        info: StatementMetaWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        let normalized = Self::normalize_query(query);

        if normalized.eq_ignore_ascii_case("SELECT VERSION()") {
            let columns = vec![Column {
                table: String::new(),
                column: "VERSION()".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            }];
            return info.reply(VERSION_STATEMENT_ID, &[], &columns).await;
        }

        if self.rejects_prepared_statement(query) {
            return info
                .error(
                    ErrorKind::ER_UNSUPPORTED_PS,
                    b"This command is not supported in the prepared statement protocol yet",
                )
                .await;
        }

        // Every statement gets its own id: sqlx caches prepared statements per SQL text, and
        // opensrv parses each execute using the parameter count declared for that id.
        let statement_id = self.next_statement_id;
        self.next_statement_id += 1;
        let params = Self::placeholder_params(query);

        if let Some(step) = self.find_step(query) {
            let columns = Self::step_columns(&step);
            self.prepared_steps.insert(statement_id, step);
            return info.reply(statement_id, &params, &columns).await;
        }

        info.reply(statement_id, &params, &[]).await
    }

    async fn on_execute<'a>(
        &'a mut self,
        id: u32,
        _params: ParamParser<'a>,
        results: QueryResultWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        if id == VERSION_STATEMENT_ID {
            let cols = [Column {
                table: String::new(),
                column: "VERSION()".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            }];
            let mut writer = results.start(&cols).await?;
            writer.write_col(b"8.0.36-mock".as_slice())?;
            return writer.finish().await;
        }

        if let Some(step) = self.prepared_steps.get(&id) {
            return Self::write_step(step, results).await;
        }

        results.completed(OkResponse::default()).await
    }

    async fn on_close<'a>(&'a mut self, _stmt: u32) {}

    async fn on_init<'a>(
        &'a mut self,
        db: &'a str,
        writer: InitWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        // opensrv routes both COM_INIT_DB and `USE db` queries here.
        let query = format!("USE {db}");
        self.text_queries
            .lock()
            .expect("text queries lock poisoned")
            .push(query.clone());
        if let Some((kind, message)) = self.find_step(&query).and_then(|step| step.error) {
            return writer.error(kind, message).await;
        }
        writer.ok().await
    }

    async fn on_query<'a>(
        &'a mut self,
        query: &'a str,
        results: QueryResultWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        let normalized = Self::normalize_query(query);
        self.text_queries
            .lock()
            .expect("text queries lock poisoned")
            .push(normalized.clone());

        if normalized.eq_ignore_ascii_case("SELECT VERSION()") {
            let cols = [Column {
                table: String::new(),
                column: "VERSION()".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            }];
            let mut writer = results.start(&cols).await?;
            writer.write_col("8.0.36-mock")?;
            return writer.finish().await;
        }

        if let Some((step, columns)) = self.find_multi_result_step(query) {
            return Self::write_multi_result_step(step, columns, results).await;
        }

        if let Some(step) = self.find_step(query) {
            return Self::write_step(&step, results).await;
        }

        results.completed(OkResponse::default()).await
    }
}

pub struct MockMySqlServer {
    pub port: u16,
    accept_task: tokio::task::JoinHandle<()>,
    connections: Arc<AtomicUsize>,
    connection_tasks: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>,
    text_queries: Arc<Mutex<Vec<String>>>,
}

impl MockMySqlServer {
    pub async fn start(response: MockQueryResponse) -> Self {
        Self::start_script(vec![response.into()]).await
    }

    pub async fn start_script(steps: Vec<MockQueryStep>) -> Self {
        Self::start_script_with_unsupported_prepared_prefixes(steps, vec![]).await
    }

    /// Like [`Self::start_script`], plus text queries answered with several
    /// result sets (see [`MockMultiResultStep`]).
    pub async fn start_script_with_multi_results(
        steps: Vec<MockQueryStep>,
        multi_result_steps: Vec<MockMultiResultStep>,
    ) -> Self {
        let mut backend = MockMySqlBackend::with_steps(steps);
        backend.multi_result_steps = Arc::new(
            multi_result_steps
                .into_iter()
                .map(|step| {
                    let columns = MockMySqlBackend::mock_columns(&step.columns);
                    (step, columns)
                })
                .collect(),
        );
        Self::start_backend(backend).await
    }

    pub async fn start_script_with_unsupported_prepared_prefixes(
        steps: Vec<MockQueryStep>,
        unsupported_prepared_prefixes: Vec<&'static str>,
    ) -> Self {
        Self::start_backend(
            MockMySqlBackend::with_steps_and_unsupported_prepared_prefixes(
                steps,
                unsupported_prepared_prefixes
                    .into_iter()
                    .map(str::to_string)
                    .collect(),
            ),
        )
        .await
    }

    async fn start_backend(backend: MockMySqlBackend) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("should bind mock mysql server");
        let port = listener
            .local_addr()
            .expect("should read local addr")
            .port();

        let connections = Arc::new(AtomicUsize::new(0));
        let text_queries = Arc::clone(&backend.text_queries);
        let accepted = Arc::clone(&connections);
        let connection_tasks = Arc::new(Mutex::new(Vec::new()));
        let tasks = Arc::clone(&connection_tasks);
        let accept_task = tokio::spawn(async move {
            loop {
                let (stream, _) = match listener.accept().await {
                    Ok(parts) => parts,
                    Err(_) => {
                        break;
                    }
                };
                accepted.fetch_add(1, Ordering::SeqCst);
                let backend = backend.clone();
                let task = tokio::spawn(async move {
                    let (reader, writer) = stream.into_split();
                    let writer = BufWriter::new(writer);
                    if let Err(error) =
                        AsyncMysqlIntermediary::run_on(backend, reader, writer).await
                    {
                        eprintln!("mock mysql server error: {error}");
                    }
                });
                tasks
                    .lock()
                    .expect("connection tasks lock poisoned")
                    .push(task);
            }
        });

        Self {
            port,
            accept_task,
            connections,
            connection_tasks,
            text_queries,
        }
    }

    /// Number of client connections accepted so far.
    pub fn connection_count(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }

    /// Close the `index`-th accepted connection (0-based, in accept order) from
    /// the server side, as if the server had killed an idle session.
    pub fn drop_connection(&self, index: usize) {
        self.connection_tasks
            .lock()
            .expect("connection tasks lock poisoned")
            .get(index)
            .expect("connection index should exist")
            .abort();
    }

    /// Text-protocol statements received so far (whitespace-normalized).
    pub fn text_queries(&self) -> Vec<String> {
        self.text_queries
            .lock()
            .expect("text queries lock poisoned")
            .clone()
    }
}

impl Drop for MockMySqlServer {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}
