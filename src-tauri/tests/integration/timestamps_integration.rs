//! Stored and logged timestamp text (`timestamps.rs`).

use crate::common::utc_timestamps::utc_timestamp;
use jiff::{Timestamp, civil};
use sqllumen_lib::timestamps::{
    days_before, log_timestamp, log_timestamp_now, stored_timestamp, stored_timestamp_now,
    unix_seconds_now,
};

fn sample_instant() -> Timestamp {
    utc_timestamp(civil::date(2026, 6, 6).at(12, 0, 0, 123_456_789))
}

#[test]
fn stored_timestamp_prints_six_fraction_digits_with_utc_offset() {
    assert_eq!(
        stored_timestamp(sample_instant()),
        "2026-06-06T12:00:00.123456+00:00"
    );
}

#[test]
fn stored_timestamp_keeps_six_zero_digits_for_whole_seconds() {
    let whole_second = utc_timestamp(civil::date(2026, 6, 6).at(12, 0, 0, 0));

    assert_eq!(
        stored_timestamp(whole_second),
        "2026-06-06T12:00:00.000000+00:00"
    );
}

#[test]
fn log_timestamp_matches_the_existing_millisecond_zulu_rows() {
    assert_eq!(log_timestamp(sample_instant()), "2026-06-06T12:00:00.123Z");
}

#[test]
fn now_variants_use_the_same_shapes() {
    let stored = stored_timestamp_now();
    let logged = log_timestamp_now();

    assert!(
        stored.ends_with("+00:00"),
        "unexpected stored text: {stored}"
    );
    assert!(logged.ends_with('Z'), "unexpected log text: {logged}");
    assert_eq!(stored.len(), "2026-06-06T12:00:00.123456+00:00".len());
    assert_eq!(logged.len(), "2026-06-06T12:00:00.123Z".len());
}

#[test]
fn days_before_steps_back_whole_utc_days() {
    let expected = utc_timestamp(civil::date(2026, 5, 30).at(12, 0, 0, 123_456_789));

    assert_eq!(days_before(sample_instant(), 7), expected);
}

#[test]
fn unix_seconds_now_matches_the_current_timestamp() {
    let before = Timestamp::now().as_second();
    let seconds = unix_seconds_now();
    let after = Timestamp::now().as_second();

    assert!(before <= seconds && seconds <= after);
}
