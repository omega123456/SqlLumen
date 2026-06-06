use crate::logging::log_store::{insert_log_entries, open_log_database, prune_logs, NewLogEntry};
use chrono::{SecondsFormat, Utc};
use std::fmt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer};

const CHANNEL_CAPACITY: usize = 4096;
const BATCH_SIZE: usize = 128;
const FLUSH_INTERVAL: Duration = Duration::from_millis(250);
const PRUNE_INTERVAL: Duration = Duration::from_secs(60 * 60);
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
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        if metadata.target() == SQLITE_LAYER_TARGET {
            return;
        }

        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let message = visitor.finish();

        let entry = NewLogEntry {
            timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            level: metadata.level().as_str().to_string(),
            level_num: level_to_num(*metadata.level()),
            target: metadata.target().to_string(),
            message,
        };

        if let Err(error) = self.sender.try_send(entry) {
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
}

pub fn init_sqlite_layer(
    log_db_path: &Path,
) -> Result<(SqliteLogLayer, SqliteLogWriterGuard), String> {
    let mut write_conn =
        open_log_database(log_db_path).map_err(|error| format!("open log database: {error}"))?;
    prune_logs(&write_conn, Utc::now()).map_err(|error| format!("prune log database: {error}"))?;

    let (sender, receiver) = mpsc::sync_channel(CHANNEL_CAPACITY);
    let join_handle = thread::Builder::new()
        .name("sqllumen-log-writer".to_string())
        .spawn(move || run_writer_loop(&mut write_conn, receiver))
        .map_err(|error| format!("spawn log writer thread: {error}"))?;

    Ok((
        SqliteLogLayer::new(sender),
        SqliteLogWriterGuard {
            join_handle: Some(join_handle),
        },
    ))
}

fn run_writer_loop(write_conn: &mut rusqlite::Connection, receiver: Receiver<NewLogEntry>) {
    let mut buffer = Vec::with_capacity(BATCH_SIZE);
    let mut last_flush = Instant::now();
    let mut last_prune = Instant::now();

    loop {
        match receiver.recv_timeout(FLUSH_INTERVAL) {
            Ok(entry) => {
                buffer.push(entry);
                drain_receiver(&receiver, &mut buffer);

                if buffer.len() >= BATCH_SIZE || last_flush.elapsed() >= FLUSH_INTERVAL {
                    flush_buffer(write_conn, &mut buffer);
                    last_flush = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !buffer.is_empty() {
                    flush_buffer(write_conn, &mut buffer);
                    last_flush = Instant::now();
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if !buffer.is_empty() {
                    flush_buffer(write_conn, &mut buffer);
                }
                break;
            }
        }

        if last_prune.elapsed() >= PRUNE_INTERVAL {
            if let Err(error) = prune_logs(write_conn, Utc::now()) {
                tracing::warn!(
                    target: SQLITE_LAYER_TARGET,
                    error = %error,
                    "failed to prune log database"
                );
            }
            last_prune = Instant::now();
        }
    }
}

fn drain_receiver(receiver: &Receiver<NewLogEntry>, buffer: &mut Vec<NewLogEntry>) {
    while buffer.len() < BATCH_SIZE {
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
        if field.name() == "message" {
            self.message = Some(format!("{value:?}").trim_matches('"').to_string());
        } else {
            self.fields.push(format!("{}={value:?}", field.name()));
        }
    }
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.record_debug_value(field, value);
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = Some(value.to_string());
        } else {
            self.fields.push(format!("{}={value}", field.name()));
        }
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
