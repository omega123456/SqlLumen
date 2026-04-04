use std::io::Write;
use std::sync::{Mutex, MutexGuard, Once};

static TRACING: Once = Once::new();
static CAPTURE_LOCK: Mutex<()> = Mutex::new(());
static LOG_LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Clone, Default)]
struct CapturedWriter;

impl Write for CapturedWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let text = String::from_utf8_lossy(buf).into_owned();
        let mut lines = LOG_LINES.lock().expect("log capture mutex poisoned");
        lines.push(text);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn ensure_tracing() {
    TRACING.call_once(|| {
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_writer(CapturedWriter::default)
            .try_init();
    });
}

fn reset_captured_logs() {
    let mut lines = LOG_LINES.lock().expect("log capture mutex poisoned");
    lines.clear();
}

pub struct LogCaptureGuard {
    _lock: MutexGuard<'static, ()>,
}

impl LogCaptureGuard {
    pub fn start() -> Self {
        let lock = CAPTURE_LOCK.lock().expect("log capture lock poisoned");
        ensure_tracing();
        reset_captured_logs();
        Self { _lock: lock }
    }

    pub fn contents(&self) -> String {
        LOG_LINES
            .lock()
            .expect("log capture mutex poisoned")
            .join("")
    }
}
