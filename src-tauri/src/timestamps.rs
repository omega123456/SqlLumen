use jiff::fmt::temporal::DateTimePrinter;
use jiff::tz::{Offset, TimeZone};
use jiff::{Timestamp, ToSpan};

const STORED_FRACTIONAL_SECOND_DIGITS: u8 = 6;
const LOG_FRACTIONAL_SECOND_DIGITS: u8 = 3;
const FOLDER_TIMESTAMP_FORMAT: &str = "%Y%m%dT%H%M%S%.3fZ";

const STORED_TIMESTAMP_PRINTER: DateTimePrinter =
    DateTimePrinter::new().precision(Some(STORED_FRACTIONAL_SECOND_DIGITS));
const LOG_TIMESTAMP_PRINTER: DateTimePrinter =
    DateTimePrinter::new().precision(Some(LOG_FRACTIONAL_SECOND_DIGITS));

pub fn stored_timestamp(timestamp: Timestamp) -> String {
    STORED_TIMESTAMP_PRINTER.timestamp_with_offset_to_string(&timestamp, Offset::UTC)
}

pub fn stored_timestamp_now() -> String {
    stored_timestamp(Timestamp::now())
}

pub fn log_timestamp(timestamp: Timestamp) -> String {
    LOG_TIMESTAMP_PRINTER.timestamp_to_string(&timestamp)
}

pub fn log_timestamp_now() -> String {
    log_timestamp(Timestamp::now())
}

pub fn folder_timestamp(timestamp: Timestamp) -> String {
    timestamp.strftime(FOLDER_TIMESTAMP_FORMAT).to_string()
}

pub fn folder_timestamp_now() -> String {
    folder_timestamp(Timestamp::now())
}

pub fn days_before(timestamp: Timestamp, days: i64) -> Timestamp {
    timestamp
        .to_zoned_datetime(TimeZone::UTC)
        .saturating_sub(days.days())
        .timestamp()
}

pub fn unix_seconds_now() -> i64 {
    Timestamp::now().as_second()
}
