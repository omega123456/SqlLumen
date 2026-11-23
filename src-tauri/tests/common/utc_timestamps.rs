use jiff::Timestamp;
use jiff::civil;
use jiff::tz::TimeZone;

pub fn utc_timestamp(datetime: civil::DateTime) -> Timestamp {
    datetime
        .to_zoned_datetime(TimeZone::UTC)
        .expect("UTC civil datetime should always resolve")
        .timestamp()
}
