use crate::logging::log_store::{NewLogEntry, insert_log_entries, open_log_database, prune_logs};
use crate::timestamps::log_timestamp_now;
use jiff::Timestamp;
use std::fmt;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer};

const CHANNEL_CAPACITY: usize = 4096;
const BATCH_SIZE: usize = 128;
const FLUSH_INTERVAL: Duration = Duration::from_millis(250);
const PRUNE_INTERVAL: Duration = Duration::from_hours(1);
pub const SQLITE_LAYER_TARGET: &str = "sqllumen_lib::logging::sqlite_layer";

#[derive(Debug)]
pub struct SqliteLogWriterGuard {
    join_handle: Option<JoinHandle<()>>,
}

impl Drop for SqliteLogWriterGuard {
    fn drop(&mut self) {
        let _ = self.join_handle.take();
    }
}

#[derive(Clone)]
pub struct SqliteLogLayer {
    sender: SyncSender<NewLogEntry>,
    dropped_messages: Arc<AtomicU64>,
}

impl SqliteLogLayer {
    fn new(sender: SyncSender<NewLogEntry>) -> Self {
        Self {
            sender,
            dropped_messages: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl<S> Layer<S> for SqliteLogLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
        let metadata = event.metadata();
        let is_log_writer_event = metadata.target() == SQLITE_LAYER_TARGET;
        if is_log_writer_event {
            return;
        }

        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let message = visitor.finish();

        let entry = NewLogEntry {
            timestamp: log_timestamp_now(),
            level: metadata.level().as_str().to_string(),
            level_num: level_to_num(*metadata.level()),
            target: metadata.target().to_string(),
            message,
        };

        if let Err(error) = self.sender.try_send(entry) {
            self.report_dropped_entry(error);
        }
    }
}

impl SqliteLogLayer {
    fn report_dropped_entry(&self, error: TrySendError<NewLogEntry>) {
        match error {
            TrySendError::Full(_) => {
                let dropped = self.dropped_messages.fetch_add(1, Ordering::Relaxed) + 1;
                eprintln!(
                    "[WARN] {SQLITE_LAYER_TARGET}: sqlite log channel full, dropped log record count={dropped}"
                );
            }
            TrySendError::Disconnected(_) => {
                eprintln!(
                    "[WARN] {SQLITE_LAYER_TARGET}: sqlite log channel disconnected; dropping log record"
                );
            }
        }
    }
}

pub struct SqliteLogging {
    pub layer: SqliteLogLayer,
    pub guard: SqliteLogWriterGuard,
}

pub fn init_sqlite_layer(log_db_path: &Path) -> Result<SqliteLogging, String> {
    let mut write_conn =
        open_log_database(log_db_path).map_err(|error| format!("open log database: {error}"))?;
    prune_logs(&write_conn, Timestamp::now())
        .map_err(|error| format!("prune log database: {error}"))?;

    let (sender, receiver) = mpsc::sync_channel(CHANNEL_CAPACITY);
    let join_handle = thread::Builder::new()
        .name("sqllumen-log-writer".to_string())
        .spawn(move || run_writer_loop(&mut write_conn, receiver))
        .map_err(|error| format!("spawn log writer thread: {error}"))?;

    Ok(SqliteLogging {
        layer: SqliteLogLayer::new(sender),
        guard: SqliteLogWriterGuard {
            join_handle: Some(join_handle),
        },
    })
}

fn run_writer_loop(write_conn: &mut rusqlite::Connection, receiver: Receiver<NewLogEntry>) {
    let mut writer = LogWriter {
        write_conn,
        receiver,
        buffer: Vec::with_capacity(BATCH_SIZE),
        last_flush: Instant::now(),
        last_prune: Instant::now(),
    };
    while writer.process_next() {
        writer.prune_if_due();
    }
}

struct LogWriter<'a> {
    write_conn: &'a mut rusqlite::Connection,
    receiver: Receiver<NewLogEntry>,
    buffer: Vec<NewLogEntry>,
    last_flush: Instant,
    last_prune: Instant,
}

impl LogWriter<'_> {
    fn process_next(&mut self) -> bool {
        match self.receiver.recv_timeout(FLUSH_INTERVAL) {
            Ok(entry) => {
                self.accept(entry);
                true
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.flush_pending();
                true
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.flush_pending();
                false
            }
        }
    }

    fn accept(&mut self, entry: NewLogEntry) {
        self.buffer.push(entry);
        drain_receiver(&self.receiver, &mut self.buffer);
        let should_flush =
            is_batch_full(&self.buffer) || has_elapsed(self.last_flush, FLUSH_INTERVAL);
        if should_flush {
            flush_buffer(self.write_conn, &mut self.buffer);
            self.last_flush = Instant::now();
        }
    }

    fn flush_pending(&mut self) {
        if self.buffer.is_empty() {
            return;
        }
        flush_buffer(self.write_conn, &mut self.buffer);
        self.last_flush = Instant::now();
    }

    fn prune_if_due(&mut self) {
        if !has_elapsed(self.last_prune, PRUNE_INTERVAL) {
            return;
        }
        if let Err(error) = prune_logs(self.write_conn, Timestamp::now()) {
            tracing::warn!(
                target: SQLITE_LAYER_TARGET,
                error = %error,
                "failed to prune log database"
            );
        }
        self.last_prune = Instant::now();
    }
}

fn is_batch_full(buffer: &[NewLogEntry]) -> bool {
    buffer.len() >= BATCH_SIZE
}

fn has_elapsed(since: Instant, interval: Duration) -> bool {
    since.elapsed() >= interval
}

fn drain_receiver(receiver: &Receiver<NewLogEntry>, buffer: &mut Vec<NewLogEntry>) {
    while !is_batch_full(buffer) {
        match receiver.try_recv() {
            Ok(entry) => buffer.push(entry),
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
        }
    }
}

fn flush_buffer(write_conn: &mut rusqlite::Connection, buffer: &mut Vec<NewLogEntry>) {
    if buffer.is_empty() {
        return;
    }

    if let Err(error) = insert_log_entries(write_conn, buffer) {
        tracing::warn!(
            target: SQLITE_LAYER_TARGET,
            error = %error,
            count = buffer.len(),
            "failed to persist log batch"
        );
    }
    buffer.clear();
}

fn level_to_num(level: Level) -> i64 {
    match level {
        Level::TRACE => 10,
        Level::DEBUG => 20,
        Level::INFO => 30,
        Level::WARN => 40,
        Level::ERROR => 50,
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: Option<String>,
    fields: Vec<String>,
}

impl MessageVisitor {
    fn finish(self) -> String {
        match (self.message, self.fields.is_empty()) {
            (Some(message), true) => message,
            (Some(message), false) => format!("{message} {}", self.fields.join(" ")),
            (None, false) => self.fields.join(" "),
            (None, true) => String::new(),
        }
    }

    fn record_debug_value(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if is_message_field(field) {
            self.message = Some(format!("{value:?}").trim_matches('"').to_string());
            return;
        }
        self.fields.push(format!("{}={value:?}", field.name()));
    }
}

fn is_message_field(field: &Field) -> bool {
    field.name() == "message"
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.record_debug_value(field, value);
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if is_message_field(field) {
            self.message = Some(value.to_string());
            return;
        }
        self.fields.push(format!("{}={value}", field.name()));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.fields.push(format!("{}={value}", field.name()));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.fields.push(format!("{}={value}", field.name()));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.fields.push(format!("{}={value}", field.name()));
    }
}
