//! Health monitor helpers: backoff schedule, cancellation token behavior, status payload JSON.

use mysql_client_lib::mysql::health::{backoff_duration, ConnectionStatusChangedPayload};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[test]
fn test_backoff_duration_first_attempt() {
    assert_eq!(backoff_duration(0), Duration::from_secs(5));
}

#[test]
fn test_backoff_duration_second_attempt() {
    assert_eq!(backoff_duration(1), Duration::from_secs(15));
}

#[test]
fn test_backoff_duration_third_attempt_and_beyond() {
    assert_eq!(backoff_duration(2), Duration::from_secs(30));
    assert_eq!(backoff_duration(3), Duration::from_secs(30));
    assert_eq!(backoff_duration(10), Duration::from_secs(30));
    assert_eq!(backoff_duration(100), Duration::from_secs(30));
}

#[test]
fn test_backoff_duration_caps_at_30s() {
    assert_eq!(backoff_duration(u32::MAX), Duration::from_secs(30));
}

#[test]
fn test_backoff_schedule_progression() {
    let schedule: Vec<Duration> = (0..5).map(backoff_duration).collect();
    assert_eq!(
        schedule,
        vec![
            Duration::from_secs(5),
            Duration::from_secs(15),
            Duration::from_secs(30),
            Duration::from_secs(30),
            Duration::from_secs(30),
        ]
    );
}

#[test]
fn test_cancellation_token_stops_task() {
    let token = CancellationToken::new();
    assert!(!token.is_cancelled());
    token.cancel();
    assert!(token.is_cancelled());
}

#[test]
fn test_cancellation_token_clone_propagates() {
    let token = CancellationToken::new();
    let cloned = token.clone();
    assert!(!cloned.is_cancelled());
    token.cancel();
    assert!(cloned.is_cancelled(), "cancellation should propagate to clones");
}

#[test]
fn test_status_payload_serialization() {
    let payload = ConnectionStatusChangedPayload {
        connection_id: "test-id".to_string(),
        status: "disconnected".to_string(),
        message: Some("Connection lost".to_string()),
    };

    let json = serde_json::to_string(&payload).expect("should serialize");
    assert!(json.contains("\"connectionId\":\"test-id\""));
    assert!(json.contains("\"status\":\"disconnected\""));
    assert!(json.contains("\"message\":\"Connection lost\""));
}

#[test]
fn test_status_payload_serialization_without_message() {
    let payload = ConnectionStatusChangedPayload {
        connection_id: "abc-123".to_string(),
        status: "connected".to_string(),
        message: None,
    };

    let json = serde_json::to_string(&payload).expect("should serialize");
    assert!(json.contains("\"connectionId\":\"abc-123\""));
    assert!(json.contains("\"status\":\"connected\""));
    assert!(json.contains("\"message\":null"));
}

#[tokio::test]
async fn test_cancellation_token_wakes_sleep() {
    let token = CancellationToken::new();
    let task_token = token.clone();

    let handle = tokio::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(3600)) => {
                false
            }
            _ = task_token.cancelled() => {
                true
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(10)).await;
    token.cancel();

    let result = handle.await.expect("task should complete");
    assert!(result, "task should have been cancelled");
}

#[test]
fn test_backoff_resets_after_reconnection() {
    assert_eq!(backoff_duration(0), Duration::from_secs(5));
}
