use jiff::civil::{Date, DateTime, Time};
use jiff::fmt::friendly::SpanPrinter;
use jiff::fmt::temporal::DateTimePrinter;
use jiff::{SignedDuration, Span, SpanRelativeTo};
use mysql_async::Column;

pub const MAX_FRACTIONAL_SECOND_DIGITS: u8 = 6;

const DATE_TIME_SEPARATOR: u8 = b' ';
const DATE_TIME_SEPARATOR_TEXT: &str = " ";
const ZERO_DATE_TEXT: &str = "0000-00-00";
const YEAR_DIGITS: usize = 4;
const MONTH_AND_DAY_DIGITS: usize = 2;
const TIME_UNIT_DIGITS: u8 = 2;
const NANOSECONDS_PER_MICROSECOND: i32 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BinaryDate {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    pub microsecond: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BinaryTime {
    pub is_negative: bool,
    pub days: u32,
    pub hours: u8,
    pub minutes: u8,
    pub seconds: u8,
    pub microseconds: u32,
}

fn fractional_digits(column: &Column) -> u8 {
    column.decimals().min(MAX_FRACTIONAL_SECOND_DIGITS)
}

fn date_time_printer(column: &Column) -> DateTimePrinter {
    DateTimePrinter::new()
        .separator(DATE_TIME_SEPARATOR)
        .precision(Some(fractional_digits(column)))
}

pub(super) fn date_text(date: &BinaryDate, column: &Column) -> String {
    let printer = date_time_printer(column);
    if super::is_date_only_column(column) {
        return date_only_text(date, &printer);
    }
    date_and_time_text(date, &printer)
}

fn date_only_text(date: &BinaryDate, printer: &DateTimePrinter) -> String {
    let Some(valid_date) = calendar_date(date) else {
        return non_calendar_date_text(date);
    };
    printer.date_to_string(&valid_date)
}

fn date_and_time_text(date: &BinaryDate, printer: &DateTimePrinter) -> String {
    let time_of_day = time_of_day(date);
    let Some(valid_date) = calendar_date(date) else {
        let time_text = printer.time_to_string(&time_of_day);
        return [non_calendar_date_text(date), time_text].join(DATE_TIME_SEPARATOR_TEXT);
    };
    printer.datetime_to_string(&DateTime::from_parts(valid_date, time_of_day))
}

fn calendar_date(date: &BinaryDate) -> Option<Date> {
    let year = i16::try_from(date.year).ok()?;
    let month = i8::try_from(date.month).ok()?;
    let day = i8::try_from(date.day).ok()?;
    Date::new(year, month, day).ok()
}

fn is_zero_date(date: &BinaryDate) -> bool {
    date.year == 0 && date.month == 0 && date.day == 0
}

fn non_calendar_date_text(date: &BinaryDate) -> String {
    if is_zero_date(date) {
        return ZERO_DATE_TEXT.to_string();
    }
    zero_padded_date_text(date)
}

/// No calendar library can hold month or day 0, so partial zero dates are padded by hand (ADR 0853e7c9).
fn zero_padded_date_text(date: &BinaryDate) -> String {
    format!(
        "{:0year_width$}-{:0part_width$}-{:0part_width$}",
        date.year,
        date.month,
        date.day,
        year_width = YEAR_DIGITS,
        part_width = MONTH_AND_DAY_DIGITS,
    )
}

fn time_of_day(date: &BinaryDate) -> Time {
    civil_time(date).unwrap_or_else(|| {
        tracing::warn!(
            ?date,
            "MySQL sent an invalid time of day; rendering midnight"
        );
        Time::midnight()
    })
}

fn civil_time(date: &BinaryDate) -> Option<Time> {
    let hour = i8::try_from(date.hour).ok()?;
    let minute = i8::try_from(date.minute).ok()?;
    let second = i8::try_from(date.second).ok()?;
    let subsecond_nanoseconds = nanoseconds_from_microseconds(date.microsecond)?;
    Time::new(hour, minute, second, subsecond_nanoseconds).ok()
}

fn nanoseconds_from_microseconds(microseconds: u32) -> Option<i32> {
    i32::try_from(microseconds)
        .ok()?
        .checked_mul(NANOSECONDS_PER_MICROSECOND)
}

pub(super) fn time_text(time: &BinaryTime, column: &Column) -> String {
    let printer = SpanPrinter::new()
        .hours_minutes_seconds(true)
        .padding(TIME_UNIT_DIGITS)
        .precision(Some(fractional_digits(column)));
    printer.duration_to_string(&signed_duration(time))
}

fn signed_duration(time: &BinaryTime) -> SignedDuration {
    let duration = time_span(time).and_then(|span| {
        let signed_span = signed_span(span, time.is_negative);
        signed_span.to_duration(SpanRelativeTo::days_are_24_hours())
    });
    duration.unwrap_or_else(|error| {
        tracing::warn!(?time, %error, "MySQL sent a TIME outside jiff's range; rendering zero");
        SignedDuration::ZERO
    })
}

fn time_span(time: &BinaryTime) -> Result<Span, jiff::Error> {
    Span::new()
        .try_days(time.days)?
        .try_hours(time.hours)?
        .try_minutes(time.minutes)?
        .try_seconds(time.seconds)?
        .try_microseconds(time.microseconds)
}

fn signed_span(span: Span, is_negative: bool) -> Span {
    if is_negative {
        return span.negate();
    }
    span
}
