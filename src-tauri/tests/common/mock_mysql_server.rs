//! Minimal in-process MySQL protocol mock (opensrv) shared by integration tests.

use async_trait::async_trait;
use jiff::SignedDuration;
use jiff::civil;
use jiff::fmt::temporal::DateTimePrinter;
use opensrv_mysql::{
    AsyncMysqlIntermediary, AsyncMysqlShim, Column, ColumnFlags, ColumnType, ErrorKind, InitWriter,
    IntermediaryOptions, OkResponse, ParamParser, QueryResultWriter, RowWriter,
    StatementMetaWriter, StatusFlags, ToMysqlValue, plain_run_with_options,
    secure_run_with_options,
};
use opensrv_rustls::ServerConfig;

use crate::common::column_definition_patch::{
    ColumnDefinitionPatch, ColumnOverrides, MockColumnOverride,
};
use crate::common::first_packet_reader::FirstPacketReader;
use std::collections::{HashMap, HashSet};
use std::io;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncWrite, BufWriter};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};

const MOCK_SERVER_VERSION: &str = "8.0.36-mock";

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
    DateTime(MockDateTimeValue),
    Time(MockTimeValue),
    Bytes(&'static [u8]),
}

const BINARY_DATETIME_LENGTH: u8 = 7;
const BINARY_DATETIME_WITH_MICROS_LENGTH: u8 = 11;
const TEXT_DATETIME_SEPARATOR: u8 = b' ';
const TEXT_DATETIME_MICROSECOND_DIGITS: u8 = 6;

const TEXT_DATETIME_PRINTER: DateTimePrinter = DateTimePrinter::new()
    .separator(TEXT_DATETIME_SEPARATOR)
    .precision(Some(0));
const TEXT_DATETIME_WITH_MICROS_PRINTER: DateTimePrinter = DateTimePrinter::new()
    .separator(TEXT_DATETIME_SEPARATOR)
    .precision(Some(TEXT_DATETIME_MICROSECOND_DIGITS));

#[derive(Debug, Clone, Copy)]
pub struct MockDateTimeValue(pub civil::DateTime);

impl MockDateTimeValue {
    fn subsec_microseconds(self) -> io::Result<u32> {
        let subsecond = SignedDuration::from_nanos(i64::from(self.0.subsec_nanosecond()));
        u32::try_from(subsecond.as_micros()).map_err(invalid_datetime_part)
    }

    fn text_printer(self) -> io::Result<DateTimePrinter> {
        if self.subsec_microseconds()? == 0 {
            return Ok(TEXT_DATETIME_PRINTER);
        }
        Ok(TEXT_DATETIME_WITH_MICROS_PRINTER)
    }
}

fn invalid_datetime_part(error: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, error.to_string())
}

fn binary_datetime_length(has_fraction: bool) -> u8 {
    if has_fraction {
        return BINARY_DATETIME_WITH_MICROS_LENGTH;
    }
    BINARY_DATETIME_LENGTH
}

fn datetime_byte(part: i8) -> io::Result<u8> {
    u8::try_from(part).map_err(invalid_datetime_part)
}

impl ToMysqlValue for MockDateTimeValue {
    fn to_mysql_text<W: Write>(&self, w: &mut W) -> io::Result<()> {
        let text = self.text_printer()?.datetime_to_string(&self.0);
        write_lenenc_str(w, text.as_bytes())
    }

    fn to_mysql_bin<W: Write>(&self, w: &mut W, c: &Column) -> io::Result<()> {
        let is_datetime_column = matches!(
            c.coltype,
            ColumnType::MYSQL_TYPE_DATETIME | ColumnType::MYSQL_TYPE_TIMESTAMP
        );
        if !is_datetime_column {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("tried to use {:?} as {:?}", self, c.coltype),
            ));
        }

        let microseconds = self.subsec_microseconds()?;
        let has_fraction = microseconds != 0;
        let year = u16::try_from(self.0.year()).map_err(invalid_datetime_part)?;

        w.write_all(&[binary_datetime_length(has_fraction)])?;
        w.write_all(&year.to_le_bytes())?;
        w.write_all(&[
            datetime_byte(self.0.month())?,
            datetime_byte(self.0.day())?,
            datetime_byte(self.0.hour())?,
            datetime_byte(self.0.minute())?,
            datetime_byte(self.0.second())?,
        ])?;

        if has_fraction {
            w.write_all(&microseconds.to_le_bytes())?;
        }

        Ok(())
    }
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
    pub fn with_rows(
        query: &'static str,
        columns: Vec<MockColumnDef>,
        rows: Vec<Vec<MockCell>>,
    ) -> Self {
        Self {
            query,
            columns,
            rows,
            error: None,
            affected_rows: None,
        }
    }

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

/// A text-protocol query answered with a generated row stream. Covers the
/// step kinds the result-ceiling and export tests need:
/// - **rows then an error** (`end_error`): ERR is sent in place of EOF;
/// - **throttled rows** (`throttle`): the server pauses between ticks, and
///   because the accepted socket is unbuffered the client sees a real partial
///   stream;
/// - **kill-aware streams** (`stops_on_kill`): a `KILL QUERY` received on any
///   connection ends the stream with error 1317.
///
/// Optional leading OK packets give it the shape of a `CALL` whose **last**
/// result set is the stream (opensrv can't flag more results after a row set).
#[derive(Debug, Clone)]
pub struct MockStreamStep {
    pub query: &'static str,
    pub leading_ok_affected: Vec<u64>,
    pub columns: Vec<MockColumnDef>,
    pub rows: MockStreamRows,
    /// `(rows per tick, pause)`; `None` streams without pauses.
    pub throttle: Option<(usize, Duration)>,
    /// Error sent instead of the end-of-rows packet after every row was written.
    pub end_error: Option<(ErrorKind, &'static [u8])>,
    pub stops_on_kill: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct MockStreamRows {
    pub count: usize,
    pub make_row: fn(usize) -> Vec<MockCell>,
}

impl MockStreamStep {
    /// A plain stream of `rows.count` rows with no pauses, error or kill hook.
    pub fn new(query: &'static str, columns: Vec<MockColumnDef>, rows: MockStreamRows) -> Self {
        Self {
            query,
            leading_ok_affected: Vec::new(),
            columns,
            rows,
            throttle: None,
            end_error: None,
            stops_on_kill: false,
        }
    }
}

/// Everything a scripted mock server answers.
#[derive(Debug, Clone, Default)]
pub struct MockScript {
    pub steps: Vec<MockQueryStep>,
    pub multi_result_steps: Vec<MockMultiResultStep>,
    pub stream_steps: Vec<MockStreamStep>,
    /// When true, a `KILL QUERY` that arrives after a stream finished stays
    /// pending and makes the **next** text query on any connection fail with
    /// 1317 (reproduces a late ceiling KILL landing on the next statement).
    pub kill_hits_next_statement: bool,
    /// Login name the server refuses during authentication (wrong-credentials tests).
    pub rejected_username: Option<&'static str>,
    pub column_overrides: HashMap<&'static str, MockColumnOverride>,
}

/// How a recorded statement reached the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MockQueryKind {
    Text,
    Prepared,
    InitDb,
}

/// One statement received by the server, tagged with the connection that sent it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedQuery {
    pub connection_id: u32,
    pub kind: MockQueryKind,
    pub sql: String,
}

/// Kill-hook state shared by every connection of one mock server. Every mock
/// connection reports the same `CONNECTION_ID()`, so the hook does not match
/// on thread id.
#[derive(Debug, Default)]
struct MockKillState {
    pending: AtomicBool,
    hits_next_statement: AtomicBool,
    received: AtomicUsize,
    killed_thread_ids: Mutex<Vec<u64>>,
}

impl MockKillState {
    fn record_kill(&self, kill_sql: &str) {
        self.received.fetch_add(1, Ordering::SeqCst);
        self.pending.store(true, Ordering::SeqCst);
        let thread_id = kill_sql
            .split_whitespace()
            .last()
            .and_then(|last_word| last_word.parse::<u64>().ok());
        if let Some(thread_id) = thread_id {
            self.killed_thread_ids
                .lock()
                .expect("killed thread ids lock poisoned")
                .push(thread_id);
        }
    }
}

fn is_kill_query(normalized_sql: &str) -> bool {
    normalized_sql
        .to_ascii_uppercase()
        .starts_with(KILL_QUERY_PREFIX)
}

const KILL_QUERY_PREFIX: &str = "KILL QUERY";
const FIRST_MOCK_CONNECTION_ID: u32 = 1;

const QUERY_INTERRUPTED_MESSAGE: &[u8] = b"Query execution was interrupted";

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
    /// Generated row streams paired with their opensrv column definitions.
    stream_steps: Arc<Vec<(MockStreamStep, Vec<Column>)>>,
    kill: Arc<MockKillState>,
    /// Prepared statement ids (this connection) that are `KILL QUERY`s.
    kill_statement_ids: HashSet<u32>,
    /// Every statement received across all connections, tagged by connection.
    recorded_queries: Arc<Mutex<Vec<RecordedQuery>>>,
    /// Id of the connection this backend clone serves (assigned on accept).
    connection_id: u32,
    rejected_username: Option<&'static str>,
    column_overrides: ColumnOverrides,
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
            stream_steps: Arc::default(),
            kill: Arc::default(),
            kill_statement_ids: HashSet::new(),
            recorded_queries: Arc::default(),
            connection_id: FIRST_MOCK_CONNECTION_ID,
            rejected_username: None,
            column_overrides: Arc::default(),
        }
    }

    fn record(&self, kind: MockQueryKind, sql: &str) {
        self.recorded_queries
            .lock()
            .expect("recorded queries lock poisoned")
            .push(RecordedQuery {
                connection_id: self.connection_id,
                kind,
                sql: sql.to_string(),
            });
    }

    fn record_text(&self, sql: &str) {
        self.text_queries
            .lock()
            .expect("text queries lock poisoned")
            .push(sql.to_string());
    }

    fn find_stream_step(&self, query: &str) -> Option<&(MockStreamStep, Vec<Column>)> {
        let normalized = Self::normalize_query(query);
        self.stream_steps
            .iter()
            .find(|(step, _)| Self::normalize_query(step.query).eq_ignore_ascii_case(&normalized))
    }

    async fn write_stream_step<'a, W: AsyncWrite + Send + Unpin>(
        prepared: &'a (MockStreamStep, Vec<Column>),
        kill: &MockKillState,
        mut results: QueryResultWriter<'a, W>,
    ) -> io::Result<()> {
        let (step, columns) = prepared;
        for &affected_rows in &step.leading_ok_affected {
            results = results
                .complete_one(OkResponse {
                    affected_rows,
                    status_flags: StatusFlags::SERVER_MORE_RESULTS_EXISTS,
                    ..Default::default()
                })
                .await?;
        }
        if step.stops_on_kill {
            // A KILL left over from an earlier statement must not end this one.
            kill.pending.store(false, Ordering::SeqCst);
        }
        let mut writer = results.start(columns).await?;
        let rows_end = write_stream_rows(&mut writer, step, kill).await?;
        if rows_end == StreamRowsEnd::Killed {
            return writer
                .finish_error(ErrorKind::ER_QUERY_INTERRUPTED, &QUERY_INTERRUPTED_MESSAGE)
                .await;
        }
        if let Some((kind, message)) = step.end_error {
            return writer.finish_error(kind, &message).await;
        }
        writer.finish().await
    }

    async fn pause_after_throttled_row(throttle: Option<(usize, Duration)>, index: usize) {
        let Some((rows_per_tick, pause)) = throttle else {
            return;
        };
        let completes_tick = (index + 1).is_multiple_of(rows_per_tick.max(1));
        if completes_tick {
            tokio::time::sleep(pause).await;
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

    /// mysql_async rejects prepare replies whose parameter count differs from the bound values,
    /// so declare one parameter per `?` placeholder outside quoted strings and identifiers.
    fn placeholder_params(query: &str) -> Vec<Column> {
        let mut quote: Option<char> = None;
        let mut count = 0;
        for character in query.chars() {
            let is_placeholder = quote.is_none() && character == '?';
            count += usize::from(is_placeholder);
            quote = Self::next_quote_state(quote, character);
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

    fn next_quote_state(quote: Option<char>, character: char) -> Option<char> {
        match (quote, character) {
            (Some(open_quote), current) if current == open_quote => None,
            (Some(open_quote), _) => Some(open_quote),
            (None, '\'' | '"' | '`') => Some(character),
            (None, _) => None,
        }
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

    async fn write_step<W: AsyncWrite + Send + Unpin>(
        step: &MockQueryStep,
        results: QueryResultWriter<'_, W>,
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

    async fn write_rows<W: AsyncWrite + Send + Unpin>(
        writer: &mut RowWriter<'_, W>,
        rows: &[Vec<MockCell>],
    ) -> io::Result<()> {
        for row in rows {
            Self::write_row_cells(writer, row)?;
            writer.end_row().await?;
        }
        Ok(())
    }

    fn write_row_cells<W: AsyncWrite + Send + Unpin>(
        writer: &mut RowWriter<'_, W>,
        row: &[MockCell],
    ) -> io::Result<()> {
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
        Ok(())
    }

    async fn write_multi_result_step<'a, W: AsyncWrite + Send + Unpin>(
        step: &'a MockMultiResultStep,
        columns: &'a [Column],
        mut results: QueryResultWriter<'a, W>,
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
impl<W: AsyncWrite + Send + Unpin> AsyncMysqlShim<W> for MockMySqlBackend {
    type Error = io::Error;

    fn version(&self) -> String {
        MOCK_SERVER_VERSION.to_string()
    }

    fn connect_id(&self) -> u32 {
        self.connection_id
    }

    async fn authenticate(
        &self,
        _auth_plugin: &str,
        username: &[u8],
        _salt: &[u8],
        _auth_data: &[u8],
    ) -> bool {
        let rejected = self.rejected_username.map(str::as_bytes);
        rejected != Some(username)
    }

    async fn on_prepare<'a>(
        &'a mut self,
        query: &'a str,
        info: StatementMetaWriter<'a, W>,
    ) -> Result<(), Self::Error> {
        let normalized = Self::normalize_query(query);
        self.record(MockQueryKind::Prepared, &normalized);

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

        // Every statement gets its own id: mysql_async caches prepared statements per connection,
        // and opensrv parses each execute using the parameter count declared for that id.
        let statement_id = self.next_statement_id;
        self.next_statement_id += 1;
        let params = Self::placeholder_params(query);

        if let Some(step) = self.find_step(query) {
            let columns = Self::step_columns(&step);
            self.prepared_steps.insert(statement_id, step);
            return info.reply(statement_id, &params, &columns).await;
        }

        // A prepared KILL is only recognised on execute, which sees just the statement
        // id, so remember which ids are KILLs. A scripted step for the KILL (e.g. an
        // error) takes precedence above.
        if is_kill_query(&normalized) {
            self.kill_statement_ids.insert(statement_id);
        }

        info.reply(statement_id, &params, &[]).await
    }

    async fn on_execute<'a>(
        &'a mut self,
        id: u32,
        _params: ParamParser<'a>,
        results: QueryResultWriter<'a, W>,
    ) -> Result<(), Self::Error> {
        if id == VERSION_STATEMENT_ID {
            let cols = [Column {
                table: String::new(),
                column: "VERSION()".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            }];
            let mut writer = results.start(&cols).await?;
            writer.write_col(MOCK_SERVER_VERSION.as_bytes())?;
            return writer.finish().await;
        }

        if let Some(step) = self.prepared_steps.get(&id) {
            return Self::write_step(step, results).await;
        }

        if self.kill_statement_ids.contains(&id) {
            self.kill.record_kill(KILL_QUERY_PREFIX);
        }

        results.completed(OkResponse::default()).await
    }

    async fn on_close<'a>(&'a mut self, _stmt: u32) {}

    async fn on_init<'a>(
        &'a mut self,
        db: &'a str,
        writer: InitWriter<'a, W>,
    ) -> Result<(), Self::Error> {
        // opensrv routes both COM_INIT_DB and `USE db` queries here.
        let query = format!("USE {db}");
        self.record_text(&query);
        self.record(MockQueryKind::InitDb, &query);
        if let Some((kind, message)) = self.find_step(&query).and_then(|step| step.error) {
            return writer.error(kind, message).await;
        }
        writer.ok().await
    }

    async fn on_query<'a>(
        &'a mut self,
        query: &'a str,
        results: QueryResultWriter<'a, W>,
    ) -> Result<(), Self::Error> {
        let normalized = Self::normalize_query(query);
        self.record_text(&normalized);
        self.record(MockQueryKind::Text, &normalized);

        if normalized.eq_ignore_ascii_case("SELECT VERSION()") {
            let cols = [Column {
                table: String::new(),
                column: "VERSION()".to_string(),
                coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
                colflags: ColumnFlags::empty(),
            }];
            let mut writer = results.start(&cols).await?;
            writer.write_col(MOCK_SERVER_VERSION)?;
            return writer.finish().await;
        }

        if is_kill_query(&normalized) {
            if let Some(step) = self.find_step(query) {
                return Self::write_step(&step, results).await;
            }
            self.kill.record_kill(&normalized);
            return results.completed(OkResponse::default()).await;
        }

        if self.kill.hits_next_statement.load(Ordering::SeqCst)
            && self.kill.pending.swap(false, Ordering::SeqCst)
        {
            return results
                .error(ErrorKind::ER_QUERY_INTERRUPTED, QUERY_INTERRUPTED_MESSAGE)
                .await;
        }

        if let Some((step, columns)) = self.find_multi_result_step(query) {
            return Self::write_multi_result_step(step, columns, results).await;
        }

        if let Some(prepared) = self.find_stream_step(query) {
            return Self::write_stream_step(prepared, &self.kill, results).await;
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
    live_connections: Arc<AtomicUsize>,
    connection_tasks: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>,
    text_queries: Arc<Mutex<Vec<String>>>,
    recorded_queries: Arc<Mutex<Vec<RecordedQuery>>>,
    kill: Arc<MockKillState>,
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

    /// Start a server from a full [`MockScript`] (row streams, kill hook, …).
    pub async fn start_with(script: MockScript) -> Self {
        Self::start_backend(Self::script_backend(script)).await
    }

    /// Like [`Self::start_with`], with TLS offered to clients using `tls_config`.
    pub async fn start_with_tls(script: MockScript, tls_config: Arc<ServerConfig>) -> Self {
        Self::start_serving(Self::script_backend(script), Some(tls_config)).await
    }

    fn script_backend(script: MockScript) -> MockMySqlBackend {
        let mut backend = MockMySqlBackend::with_steps(script.steps);
        backend.multi_result_steps = Arc::new(
            script
                .multi_result_steps
                .into_iter()
                .map(|step| {
                    let columns = MockMySqlBackend::mock_columns(&step.columns);
                    (step, columns)
                })
                .collect(),
        );
        backend.stream_steps = Arc::new(
            script
                .stream_steps
                .into_iter()
                .map(|step| {
                    let columns = MockMySqlBackend::mock_columns(&step.columns);
                    (step, columns)
                })
                .collect(),
        );
        backend
            .kill
            .hits_next_statement
            .store(script.kill_hits_next_statement, Ordering::SeqCst);
        backend.rejected_username = script.rejected_username;
        backend.column_overrides = Arc::new(script.column_overrides);
        backend
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
        Self::start_serving(backend, None).await
    }

    async fn start_serving(backend: MockMySqlBackend, tls: Option<Arc<ServerConfig>>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("should bind mock mysql server");
        let port = listener
            .local_addr()
            .expect("should read local addr")
            .port();

        let connections = Arc::new(AtomicUsize::new(0));
        let live_connections = Arc::new(AtomicUsize::new(0));
        let text_queries = Arc::clone(&backend.text_queries);
        let recorded_queries = Arc::clone(&backend.recorded_queries);
        let kill = Arc::clone(&backend.kill);
        let connection_tasks = Arc::new(Mutex::new(Vec::new()));
        let accept_loop = AcceptLoop {
            listener,
            backend,
            tls,
            accepted: Arc::clone(&connections),
            live: Arc::clone(&live_connections),
            tasks: Arc::clone(&connection_tasks),
        };
        let accept_task = tokio::spawn(accept_loop.run());

        Self {
            port,
            accept_task,
            connections,
            live_connections,
            connection_tasks,
            text_queries,
            recorded_queries,
            kill,
        }
    }

    /// Number of `KILL QUERY` statements executed against this server.
    pub fn kill_count(&self) -> usize {
        self.kill.received.load(Ordering::SeqCst)
    }

    /// Thread ids named by the `KILL QUERY <id>` text statements received so far.
    pub fn killed_thread_ids(&self) -> Vec<u64> {
        self.kill
            .killed_thread_ids
            .lock()
            .expect("killed thread ids lock poisoned")
            .clone()
    }

    /// Number of client connections accepted so far.
    pub fn connection_count(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }

    /// Number of client connections currently open.
    pub fn live_connection_count(&self) -> usize {
        self.live_connections.load(Ordering::SeqCst)
    }

    /// Every statement received so far, tagged with the connection that sent it.
    pub fn recorded_queries(&self) -> Vec<RecordedQuery> {
        self.recorded_queries
            .lock()
            .expect("recorded queries lock poisoned")
            .clone()
    }

    /// Statements received on one connection, in arrival order.
    pub fn queries_on_connection(&self, connection_id: u32) -> Vec<RecordedQuery> {
        self.recorded_queries()
            .into_iter()
            .filter(|query| query.connection_id == connection_id)
            .collect()
    }

    /// Id of the first connection that received `sql` (whitespace-normalized match).
    pub fn connection_that_sent(&self, sql: &str) -> Option<u32> {
        let normalized = MockMySqlBackend::normalize_query(sql);
        self.recorded_queries()
            .into_iter()
            .find(|query| query.sql.eq_ignore_ascii_case(&normalized))
            .map(|query| query.connection_id)
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

#[derive(PartialEq, Eq)]
enum StreamRowsEnd {
    Completed,
    Killed,
}

async fn write_stream_rows<W: AsyncWrite + Send + Unpin>(
    writer: &mut RowWriter<'_, W>,
    step: &MockStreamStep,
    kill: &MockKillState,
) -> io::Result<StreamRowsEnd> {
    for index in 0..step.rows.count {
        let is_killed = step.stops_on_kill && kill.pending.swap(false, Ordering::SeqCst);
        if is_killed {
            return Ok(StreamRowsEnd::Killed);
        }
        MockMySqlBackend::write_rows(writer, &[(step.rows.make_row)(index)]).await?;
        MockMySqlBackend::pause_after_throttled_row(step.throttle, index).await;
    }
    Ok(StreamRowsEnd::Completed)
}

struct AcceptLoop {
    listener: TcpListener,
    backend: MockMySqlBackend,
    tls: Option<Arc<ServerConfig>>,
    accepted: Arc<AtomicUsize>,
    live: Arc<AtomicUsize>,
    tasks: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>,
}

struct LiveConnectionGuard {
    live: Arc<AtomicUsize>,
}

impl LiveConnectionGuard {
    fn open(live: &Arc<AtomicUsize>) -> Self {
        live.fetch_add(1, Ordering::SeqCst);
        Self {
            live: Arc::clone(live),
        }
    }
}

impl Drop for LiveConnectionGuard {
    fn drop(&mut self) {
        self.live.fetch_sub(1, Ordering::SeqCst);
    }
}

impl AcceptLoop {
    async fn run(self) {
        while let Ok((stream, _)) = self.listener.accept().await {
            let accepted_before = self.accepted.fetch_add(1, Ordering::SeqCst);
            let mut backend = self.backend.clone();
            backend.connection_id = FIRST_MOCK_CONNECTION_ID
                + u32::try_from(accepted_before).expect("connection count fits in u32");
            let live_guard = LiveConnectionGuard::open(&self.live);
            let task = tokio::spawn(serve_connection(
                backend,
                stream,
                ConnectionExtras {
                    tls: self.tls.clone(),
                    live_guard,
                },
            ));
            self.tasks
                .lock()
                .expect("connection tasks lock poisoned")
                .push(task);
        }
    }
}

struct ConnectionExtras {
    tls: Option<Arc<ServerConfig>>,
    live_guard: LiveConnectionGuard,
}

async fn serve_connection(backend: MockMySqlBackend, stream: TcpStream, extras: ConnectionExtras) {
    let ConnectionExtras { tls, live_guard } = extras;
    if let Err(error) = serve_mysql_protocol(backend, stream, tls).await {
        eprintln!("mock mysql server error: {error}");
    }
    drop(live_guard);
}

type PlainReader = FirstPacketReader<OwnedReadHalf>;
type PlainWriter = BufWriter<OwnedWriteHalf>;

async fn serve_mysql_protocol(
    mut backend: MockMySqlBackend,
    stream: TcpStream,
    tls: Option<Arc<ServerConfig>>,
) -> io::Result<()> {
    let (reader, writer) = stream.into_split();
    // opensrv only flushes at the end of a command, so zero capacity sends throttled rows one by one.
    let mut writer = BufWriter::with_capacity(0, writer);
    let (client_wants_tls, handshake) =
        AsyncMysqlIntermediary::<MockMySqlBackend, PlainReader, PlainWriter>::init_before_ssl(
            &mut backend,
            FirstPacketReader::new(reader),
            &mut writer,
            &tls,
        )
        .await?;
    let options = IntermediaryOptions::default();
    let tls_config = tls.filter(|_| client_wants_tls);
    let Some(tls_config) = tls_config else {
        let patched_writer = ColumnDefinitionPatch::new(writer, backend.column_overrides.clone());
        return plain_run_with_options(backend, patched_writer, options, handshake).await;
    };
    secure_run_with_options(backend, writer, options, tls_config, handshake).await
}

impl Drop for MockMySqlServer {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}
