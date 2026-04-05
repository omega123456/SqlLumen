//! Minimal in-process MySQL protocol mock (opensrv) shared by integration tests.

use async_trait::async_trait;
use opensrv_mysql::{
    AsyncMysqlIntermediary, AsyncMysqlShim, Column, ColumnFlags, ColumnType, ErrorKind,
    InitWriter, OkResponse, ParamParser, QueryResultWriter, StatementMetaWriter, ToMysqlValue,
};
use std::collections::HashMap;
use std::io;
use std::io::Write;
use std::sync::Arc;
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
}

impl From<MockQueryResponse> for MockQueryStep {
    fn from(response: MockQueryResponse) -> Self {
        Self {
            query: response.query,
            columns: response.columns,
            rows: vec![response.row],
            error: None,
        }
    }
}

#[derive(Clone)]
struct MockMySqlBackend {
    steps: Arc<Vec<MockQueryStep>>,
    unsupported_prepared_prefixes: Arc<Vec<String>>,
    prepared_steps: HashMap<u32, MockQueryStep>,
    next_statement_id: u32,
}

const VERSION_STATEMENT_ID: u32 = 1;
const FIRST_QUERY_STATEMENT_ID: u32 = 2;
const EMPTY_STATEMENT_ID: u32 = u32::MAX;

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
            unsupported_prepared_prefixes: Arc::new(
                unsupported_prepared_prefixes
                    .into_iter()
                    .map(|prefix| prefix.to_ascii_uppercase())
                    .collect(),
            ),
            prepared_steps: HashMap::new(),
            next_statement_id: FIRST_QUERY_STATEMENT_ID,
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

    fn find_step(&self, query: &str) -> Option<MockQueryStep> {
        let normalized = Self::normalize_query(query);
        self.steps
            .iter()
            .find(|step| Self::normalize_query(step.query).eq_ignore_ascii_case(&normalized))
            .cloned()
    }

    fn rejects_prepared_statement(&self, query: &str) -> bool {
        let normalized = Self::normalize_query(query).to_ascii_uppercase();
        self.unsupported_prepared_prefixes
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
    }

    fn step_columns(step: &MockQueryStep) -> Vec<Column> {
        step.columns
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

        let columns = Self::step_columns(step);

        let mut writer = results.start(&columns).await?;
        for row in &step.rows {
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

        if let Some(step) = self.find_step(query) {
            let statement_id = self.next_statement_id;
            self.next_statement_id += 1;
            let columns = Self::step_columns(&step);
            self.prepared_steps.insert(statement_id, step);
            return info.reply(statement_id, &[], &columns).await;
        }

        info.reply(EMPTY_STATEMENT_ID, &[], &[]).await
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
        _db: &'a str,
        writer: InitWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        writer.ok().await
    }

    async fn on_query<'a>(
        &'a mut self,
        query: &'a str,
        results: QueryResultWriter<'a, BufWriter<OwnedWriteHalf>>,
    ) -> Result<(), Self::Error> {
        let normalized = Self::normalize_query(query);

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

        if let Some(step) = self.find_step(query) {
            return Self::write_step(&step, results).await;
        }

        results.completed(OkResponse::default()).await
    }
}

pub struct MockMySqlServer {
    pub port: u16,
    accept_task: tokio::task::JoinHandle<()>,
}

impl MockMySqlServer {
    pub async fn start(response: MockQueryResponse) -> Self {
        Self::start_script(vec![response.into()]).await
    }

    pub async fn start_script(steps: Vec<MockQueryStep>) -> Self {
        Self::start_script_with_unsupported_prepared_prefixes(steps, vec![]).await
    }

    pub async fn start_script_with_unsupported_prepared_prefixes(
        steps: Vec<MockQueryStep>,
        unsupported_prepared_prefixes: Vec<&'static str>,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("should bind mock mysql server");
        let port = listener
            .local_addr()
            .expect("should read local addr")
            .port();
        let backend = MockMySqlBackend::with_steps_and_unsupported_prepared_prefixes(
            steps,
            unsupported_prepared_prefixes
                .into_iter()
                .map(str::to_string)
                .collect(),
        );

        let accept_task = tokio::spawn(async move {
            loop {
                let (stream, _) = match listener.accept().await {
                    Ok(parts) => parts,
                    Err(_) => {
                        break;
                    }
                };
                let backend = backend.clone();
                tokio::spawn(async move {
                    let (reader, writer) = stream.into_split();
                    let writer = BufWriter::new(writer);
                    if let Err(error) = AsyncMysqlIntermediary::run_on(backend, reader, writer).await {
                        eprintln!("mock mysql server error: {error}");
                    }
                });
            }
        });

        Self { port, accept_task }
    }
}

impl Drop for MockMySqlServer {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}
