use mysql_client_lib::commands::frontend_log::log_frontend_impl;
use std::fmt;
use std::sync::{Arc, Mutex};
use tracing::Level;
use tracing::Subscriber;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::prelude::*;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Registry;

#[derive(Clone)]
struct Captured {
    level: Level,
    message: String,
}

struct CaptureLayer {
    events: Arc<Mutex<Vec<Captured>>>,
}

impl CaptureLayer {
    fn new(events: Arc<Mutex<Vec<Captured>>>) -> Self {
        Self { events }
    }
}

impl<S: Subscriber> Layer<S> for CaptureLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let level = *event.metadata().level();
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        self.events.lock().unwrap().push(Captured {
            level,
            message: visitor.message,
        });
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: String,
}

impl tracing::field::Visit for MessageVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message.push_str(value);
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{value:?}");
        }
    }
}

fn with_capture<F>(f: F) -> Vec<Captured>
where
    F: FnOnce(),
{
    let events: Arc<Mutex<Vec<Captured>>> = Arc::new(Mutex::new(Vec::new()));
    let subscriber = Registry::default()
        .with(LevelFilter::TRACE)
        .with(CaptureLayer::new(events.clone()));
    let _guard = subscriber.set_default();
    f();
    let out = events.lock().unwrap().clone();
    out
}

#[test]
fn log_frontend_impl_dispatches_each_tracing_level() {
    let recorded = with_capture(|| {
        for (lvl, text) in [
            ("error", "e"),
            ("warn", "w"),
            ("info", "i"),
            ("debug", "d"),
            ("trace", "t"),
        ] {
            log_frontend_impl(lvl, text).unwrap();
        }
    });

    assert_eq!(recorded.len(), 5);
    assert_eq!(recorded[0].level, Level::ERROR);
    assert_eq!(recorded[0].message, "e");
    assert_eq!(recorded[1].level, Level::WARN);
    assert_eq!(recorded[2].level, Level::INFO);
    assert_eq!(recorded[3].level, Level::DEBUG);
    assert_eq!(recorded[4].level, Level::TRACE);
}

#[test]
fn log_frontend_impl_normalizes_level_case_and_whitespace() {
    let recorded = with_capture(|| {
        log_frontend_impl("  ERROR  ", "x").unwrap();
        log_frontend_impl("InFo", "y").unwrap();
    });

    assert_eq!(recorded.len(), 2);
    assert_eq!(recorded[0].level, Level::ERROR);
    assert_eq!(recorded[0].message, "x");
    assert_eq!(recorded[1].level, Level::INFO);
    assert_eq!(recorded[1].message, "y");
}

#[test]
fn log_frontend_impl_unknown_level_returns_err_and_emits_no_event() {
    let recorded = with_capture(|| {
        let err = log_frontend_impl("bogus", "nope").unwrap_err();
        assert!(err.contains("unknown"), "err={err}");
    });

    assert!(recorded.is_empty());
}
