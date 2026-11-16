//! The shared cell decoder (`cell_values`): every MySQL column type in the text and binary
//! protocols, cross-protocol temporal and FLOAT equality, renderers, accessors and the
//! column-type source-scan guard.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::{Column, Value};
use sqllumen_lib::mysql::cell_values::{
    cell_json, column_type_display_name, debug_text, decode_cell, decode_owned_cell,
    float_as_mysql_prints_it, grid_cell_json, json_from_i64, json_from_u64, minus_sign, CellValue,
    DecodedRow, GridCellVariant, JS_SAFE_INTEGER_MAX,
};

const COLUMN_TYPE_TOKEN: &str = "MYSQL_TYPE_";
const DECODER_DIRECTORY: &str = "src/mysql/cell_values";
const TWO_POW_53: i64 = 9_007_199_254_740_992;
const BINARY_CHARACTER_SET: u16 = 63;
const UTF8MB4_BIN_CHARACTER_SET: u16 = 46;
const NOT_FIXED_DECIMALS: u8 = 31;

fn column(column_type: ColumnType) -> Column {
    Column::new(column_type)
}

fn flagged_column(column_type: ColumnType, flags: ColumnFlags) -> Column {
    Column::new(column_type).with_flags(flags)
}

fn precise_column(column_type: ColumnType, decimals: u8) -> Column {
    Column::new(column_type).with_decimals(decimals)
}

fn binary_column(column_type: ColumnType) -> Column {
    flagged_column(column_type, ColumnFlags::BINARY_FLAG).with_character_set(BINARY_CHARACTER_SET)
}

fn bin_collated_column(column_type: ColumnType) -> Column {
    flagged_column(column_type, ColumnFlags::BINARY_FLAG)
        .with_character_set(UTF8MB4_BIN_CHARACTER_SET)
}

fn plain_float_column() -> Column {
    precise_column(ColumnType::MYSQL_TYPE_FLOAT, NOT_FIXED_DECIMALS)
}

fn text_cell(text: &str, column: &Column) -> CellValue {
    decode_cell(&Value::Bytes(text.as_bytes().to_vec()), column)
}

fn temporal(text: &str) -> CellValue {
    CellValue::Temporal(text.to_string())
}

fn assert_protocols_agree(text: &str, binary: &Value, column: &Column) {
    let from_text = text_cell(text, column);
    let from_binary = decode_cell(binary, column);
    assert_eq!(
        from_binary, from_text,
        "binary {binary:?} and text {text:?} disagree for {column:?}"
    );
}

mod source_scan_guard {
    use super::*;

    fn rust_files_under(directory: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(directory)
            .expect("should list source directory")
            .map(|entry| entry.expect("should read directory entry").path())
            .flat_map(|path| rust_files_at(&path))
            .collect()
    }

    fn rust_files_at(path: &Path) -> Vec<PathBuf> {
        if path.is_dir() {
            return rust_files_under(path);
        }
        let is_rust_file = path.extension().is_some_and(|extension| extension == "rs");
        if is_rust_file {
            return vec![path.to_path_buf()];
        }
        Vec::new()
    }

    #[test]
    fn driver_column_types_are_only_interpreted_inside_cell_values() {
        let manifest_directory = Path::new(env!("CARGO_MANIFEST_DIR"));
        let decoder_directory = manifest_directory.join(DECODER_DIRECTORY);
        let offenders: Vec<PathBuf> = rust_files_under(&manifest_directory.join("src"))
            .into_iter()
            .filter(|path| !path.starts_with(&decoder_directory))
            .filter(|path| {
                let source = std::fs::read_to_string(path).expect("should read source file");
                source.contains(COLUMN_TYPE_TOKEN)
            })
            .collect();
        assert!(
            offenders.is_empty(),
            "column types must be decoded through cell_values only: {offenders:?}"
        );
    }

    #[test]
    fn the_value_serialization_module_is_gone() {
        let manifest_directory = Path::new(env!("CARGO_MANIFEST_DIR"));
        let removed = manifest_directory.join("src/mysql/multi_result/value_serialization.rs");
        assert!(!removed.exists());
    }
}

mod integers {
    use super::*;

    #[test]
    fn tinyint_one_keeps_values_above_one_in_both_protocols() {
        let tinyint_one = column(ColumnType::MYSQL_TYPE_TINY).with_column_length(1);
        assert_eq!(text_cell("7", &tinyint_one), CellValue::Signed(7));
        assert_eq!(
            decode_cell(&Value::Int(7), &tinyint_one),
            CellValue::Signed(7)
        );
        assert_eq!(
            cell_json(&text_cell("7", &tinyint_one)),
            serde_json::json!(7)
        );
    }

    #[test]
    fn unsigned_tinyint_decodes_the_same_in_both_protocols() {
        let unsigned_tinyint =
            flagged_column(ColumnType::MYSQL_TYPE_TINY, ColumnFlags::UNSIGNED_FLAG);
        assert_eq!(
            text_cell("255", &unsigned_tinyint),
            CellValue::Unsigned(255)
        );
        assert_protocols_agree("255", &Value::UInt(255), &unsigned_tinyint);
    }

    #[test]
    fn every_integer_type_agrees_across_protocols() {
        let integer_types = [
            ColumnType::MYSQL_TYPE_TINY,
            ColumnType::MYSQL_TYPE_SHORT,
            ColumnType::MYSQL_TYPE_INT24,
            ColumnType::MYSQL_TYPE_LONG,
            ColumnType::MYSQL_TYPE_LONGLONG,
        ];
        for integer_type in integer_types {
            assert_protocols_agree("-42", &Value::Int(-42), &column(integer_type));
            let unsigned = flagged_column(integer_type, ColumnFlags::UNSIGNED_FLAG);
            assert_protocols_agree("42", &Value::UInt(42), &unsigned);
        }
        let year = flagged_column(ColumnType::MYSQL_TYPE_YEAR, ColumnFlags::UNSIGNED_FLAG);
        assert_protocols_agree("2024", &Value::UInt(2024), &year);
    }

    #[test]
    fn integers_beyond_two_pow_53_become_json_strings() {
        let bigint = column(ColumnType::MYSQL_TYPE_LONGLONG);
        let unsigned_bigint =
            flagged_column(ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::UNSIGNED_FLAG);

        let above = text_cell("9007199254740992", &bigint);
        assert_eq!(above, CellValue::Signed(TWO_POW_53));
        assert_eq!(cell_json(&above), serde_json::json!("9007199254740992"));
        let below = decode_cell(&Value::Int(-TWO_POW_53), &bigint);
        assert_eq!(cell_json(&below), serde_json::json!("-9007199254740992"));
        let largest = text_cell("18446744073709551615", &unsigned_bigint);
        assert_eq!(largest, CellValue::Unsigned(u64::MAX));
        assert_eq!(
            cell_json(&largest),
            serde_json::json!("18446744073709551615")
        );
        let safe = decode_cell(&Value::Int(JS_SAFE_INTEGER_MAX), &bigint);
        assert_eq!(cell_json(&safe), serde_json::json!(JS_SAFE_INTEGER_MAX));
    }

    #[test]
    fn json_integer_helpers_clamp_at_the_js_safe_range() {
        assert_eq!(
            json_from_i64(-JS_SAFE_INTEGER_MAX),
            serde_json::json!(-JS_SAFE_INTEGER_MAX)
        );
        assert_eq!(
            json_from_i64(i64::MIN),
            serde_json::json!(i64::MIN.to_string())
        );
        assert_eq!(json_from_u64(1), serde_json::json!(1));
        assert_eq!(
            json_from_u64(u64::MAX),
            serde_json::json!(u64::MAX.to_string())
        );
    }

    #[test]
    fn unparseable_integer_text_stays_text() {
        let int = column(ColumnType::MYSQL_TYPE_LONG);
        assert_eq!(text_cell("abc", &int), CellValue::Text("abc".to_string()));
        let unsigned = flagged_column(ColumnType::MYSQL_TYPE_LONG, ColumnFlags::UNSIGNED_FLAG);
        assert_eq!(text_cell("-3", &unsigned), CellValue::Signed(-3));
    }
}

mod bits_and_decimals {
    use super::*;

    #[test]
    fn bit_values_decode_as_big_endian_unsigned_integers() {
        let bit = column(ColumnType::MYSQL_TYPE_BIT);
        let two_bytes = Value::Bytes(vec![0x01, 0x00]);
        assert_eq!(decode_cell(&two_bytes, &bit), CellValue::Bit(256));
        assert_eq!(decode_cell(&Value::Bytes(vec![]), &bit), CellValue::Bit(0));
        let all_ones = decode_cell(&Value::Bytes(vec![0xFF; 8]), &bit);
        assert_eq!(
            cell_json(&all_ones),
            serde_json::json!(u64::MAX.to_string())
        );
    }

    #[test]
    fn decimals_stay_exact_text_in_both_protocols() {
        for decimal_type in [
            ColumnType::MYSQL_TYPE_DECIMAL,
            ColumnType::MYSQL_TYPE_NEWDECIMAL,
        ] {
            let decimal = column(decimal_type);
            let cell = text_cell("99999999999999999.99", &decimal);
            assert_eq!(cell, CellValue::Decimal("99999999999999999.99".to_string()));
            assert_eq!(cell_json(&cell), serde_json::json!("99999999999999999.99"));
        }
    }
}

mod floats {
    use super::*;

    struct FloatCase {
        stored: f32,
        mysql_text: &'static str,
    }

    const FLOAT_CASES: [FloatCase; 5] = [
        FloatCase {
            stored: 1.1,
            mysql_text: "1.1",
        },
        FloatCase {
            stored: 0.1,
            mysql_text: "0.1",
        },
        FloatCase {
            stored: 1.234_567_9,
            mysql_text: "1.23457",
        },
        FloatCase {
            stored: 123_456_789.0,
            mysql_text: "123457000",
        },
        FloatCase {
            stored: 3.402_823_5e38,
            mysql_text: "3.40282e38",
        },
    ];

    #[test]
    fn binary_float_matches_the_text_protocol_six_significant_digits() {
        let float = plain_float_column();
        for case in FLOAT_CASES {
            assert_protocols_agree(case.mysql_text, &Value::Float(case.stored), &float);
        }
        assert_eq!(
            cell_json(&decode_cell(&Value::Float(1.1), &float)),
            serde_json::json!(1.1)
        );
    }

    #[test]
    fn fixed_decimal_float_matches_the_text_protocol_decimals() {
        let two_decimals = precise_column(ColumnType::MYSQL_TYPE_FLOAT, 2);
        assert_eq!(
            decode_cell(&Value::Float(12_345.67), &two_decimals),
            CellValue::Float(12_345.67)
        );
        assert_protocols_agree("12345.67", &Value::Float(12_345.67), &two_decimals);
        let four_decimals = precise_column(ColumnType::MYSQL_TYPE_FLOAT, 4);
        assert_protocols_agree("1234.5680", &Value::Float(1_234.568), &four_decimals);
    }

    #[test]
    fn double_keeps_its_full_value() {
        let double = column(ColumnType::MYSQL_TYPE_DOUBLE);
        let precise = 1.234_567_890_123_4_f64;
        assert_eq!(
            decode_cell(&Value::Double(precise), &double),
            CellValue::Float(precise)
        );
        assert_protocols_agree("2.5", &Value::Double(2.5), &double);
    }

    #[test]
    fn non_finite_floats_render_as_null() {
        let float = plain_float_column();
        let not_a_number = decode_cell(&Value::Float(f32::NAN), &float);
        assert_eq!(cell_json(&not_a_number), serde_json::Value::Null);
        assert!(float_as_mysql_prints_it(f32::INFINITY).is_infinite());
    }

    #[test]
    fn unparseable_float_text_stays_text() {
        let double = column(ColumnType::MYSQL_TYPE_DOUBLE);
        assert_eq!(
            text_cell("nope", &double),
            CellValue::Text("nope".to_string())
        );
    }
}

mod temporals {
    use super::*;

    const DATE_TIME_TYPES: [ColumnType; 4] = [
        ColumnType::MYSQL_TYPE_DATETIME,
        ColumnType::MYSQL_TYPE_DATETIME2,
        ColumnType::MYSQL_TYPE_TIMESTAMP,
        ColumnType::MYSQL_TYPE_TIMESTAMP2,
    ];
    const DATE_TYPES: [ColumnType; 2] =
        [ColumnType::MYSQL_TYPE_DATE, ColumnType::MYSQL_TYPE_NEWDATE];
    const TIME_TYPES: [ColumnType; 2] = [ColumnType::MYSQL_TYPE_TIME, ColumnType::MYSQL_TYPE_TIME2];

    struct PrecisionCase {
        decimals: u8,
        microsecond: u32,
        fraction: &'static str,
    }

    const PRECISION_CASES: [PrecisionCase; 7] = [
        PrecisionCase {
            decimals: 0,
            microsecond: 0,
            fraction: "",
        },
        PrecisionCase {
            decimals: 1,
            microsecond: 100_000,
            fraction: ".1",
        },
        PrecisionCase {
            decimals: 2,
            microsecond: 120_000,
            fraction: ".12",
        },
        PrecisionCase {
            decimals: 3,
            microsecond: 123_000,
            fraction: ".123",
        },
        PrecisionCase {
            decimals: 4,
            microsecond: 123_400,
            fraction: ".1234",
        },
        PrecisionCase {
            decimals: 5,
            microsecond: 123_450,
            fraction: ".12345",
        },
        PrecisionCase {
            decimals: 6,
            microsecond: 123_456,
            fraction: ".123456",
        },
    ];

    fn datetime_agrees_at_every_precision(column_type: ColumnType) {
        for case in &PRECISION_CASES {
            let precise = precise_column(column_type, case.decimals);
            let binary = Value::Date(2024, 3, 5, 13, 4, 5, case.microsecond);
            let text = ["2024-03-05 13:04:05", case.fraction].concat();
            assert_protocols_agree(&text, &binary, &precise);
        }
    }

    fn date_agrees_at_every_precision(column_type: ColumnType) {
        let binary = Value::Date(2024, 3, 5, 0, 0, 0, 0);
        for case in &PRECISION_CASES {
            let precise = precise_column(column_type, case.decimals);
            assert_protocols_agree("2024-03-05", &binary, &precise);
        }
    }

    fn time_agrees_at_every_precision(column_type: ColumnType) {
        for case in &PRECISION_CASES {
            let precise = precise_column(column_type, case.decimals);
            let binary = Value::Time(false, 1, 1, 2, 3, case.microsecond);
            let text = ["25:02:03", case.fraction].concat();
            assert_protocols_agree(&text, &binary, &precise);
        }
    }

    #[test]
    fn datetime_and_timestamp_agree_across_protocols_at_every_precision() {
        DATE_TIME_TYPES
            .into_iter()
            .for_each(datetime_agrees_at_every_precision);
    }

    #[test]
    fn midnight_datetimes_keep_their_time_part() {
        let datetime = precise_column(ColumnType::MYSQL_TYPE_DATETIME, 0);
        let binary = Value::Date(2024, 3, 5, 0, 0, 0, 0);
        assert_eq!(
            decode_cell(&binary, &datetime),
            temporal("2024-03-05 00:00:00")
        );
    }

    #[test]
    fn dates_agree_across_protocols_whatever_the_reported_precision() {
        DATE_TYPES
            .into_iter()
            .for_each(date_agrees_at_every_precision);
    }

    #[test]
    fn times_agree_across_protocols_at_every_precision() {
        TIME_TYPES
            .into_iter()
            .for_each(time_agrees_at_every_precision);
    }

    #[test]
    fn negative_and_extreme_times_keep_sign_and_total_hours() {
        let time = precise_column(ColumnType::MYSQL_TYPE_TIME, 0);
        assert_protocols_agree("-02:15:00", &Value::Time(true, 0, 2, 15, 0, 0), &time);
        assert_protocols_agree("838:59:59", &Value::Time(false, 34, 22, 59, 59, 0), &time);
        assert_protocols_agree("-838:59:59", &Value::Time(true, 34, 22, 59, 59, 0), &time);
        let fractional = precise_column(ColumnType::MYSQL_TYPE_TIME, 3);
        let negative_fraction = Value::Time(true, 0, 0, 0, 1, 500_000);
        assert_protocols_agree("-00:00:01.500", &negative_fraction, &fractional);
    }

    #[test]
    fn zero_dates_render_from_constants() {
        let date = precise_column(ColumnType::MYSQL_TYPE_DATE, 0);
        let datetime_3 = precise_column(ColumnType::MYSQL_TYPE_DATETIME, 3);
        let zero = Value::Date(0, 0, 0, 0, 0, 0, 0);
        assert_protocols_agree("0000-00-00", &zero, &date);
        assert_protocols_agree("0000-00-00 00:00:00.000", &zero, &datetime_3);
    }

    #[test]
    fn partial_zero_and_out_of_calendar_dates_are_padded() {
        let date = precise_column(ColumnType::MYSQL_TYPE_DATE, 0);
        let datetime = precise_column(ColumnType::MYSQL_TYPE_DATETIME, 0);
        let partial = Value::Date(2024, 0, 15, 0, 0, 0, 0);
        assert_protocols_agree("2024-00-15", &partial, &date);
        assert_protocols_agree("2024-00-15 00:00:00", &partial, &datetime);
        let invalid_day = Value::Date(2024, 2, 31, 8, 30, 0, 0);
        assert_protocols_agree("2024-02-31 08:30:00", &invalid_day, &datetime);
    }

    #[test]
    fn precision_above_six_is_clamped() {
        let expression = precise_column(ColumnType::MYSQL_TYPE_DATETIME, 31);
        let binary = Value::Date(2024, 3, 5, 13, 4, 5, 123_456);
        assert_eq!(
            decode_cell(&binary, &expression),
            temporal("2024-03-05 13:04:05.123456")
        );
    }

    #[test]
    fn invalid_binary_time_of_day_renders_midnight() {
        let datetime = precise_column(ColumnType::MYSQL_TYPE_DATETIME, 0);
        let impossible = Value::Date(2024, 3, 5, 25, 0, 0, 0);
        assert_eq!(
            decode_cell(&impossible, &datetime),
            temporal("2024-03-05 00:00:00")
        );
    }

    #[test]
    fn time_outside_jiff_range_renders_zero() {
        let time = precise_column(ColumnType::MYSQL_TYPE_TIME, 0);
        let impossible = Value::Time(false, u32::MAX, 0, 0, 0, 0);
        assert_eq!(decode_cell(&impossible, &time), temporal("00:00:00"));
    }
}

mod strings_and_binary {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};

    #[test]
    fn text_types_decode_as_text() {
        let text_types = [
            ColumnType::MYSQL_TYPE_VARCHAR,
            ColumnType::MYSQL_TYPE_VAR_STRING,
            ColumnType::MYSQL_TYPE_STRING,
            ColumnType::MYSQL_TYPE_BLOB,
            ColumnType::MYSQL_TYPE_TINY_BLOB,
            ColumnType::MYSQL_TYPE_MEDIUM_BLOB,
            ColumnType::MYSQL_TYPE_LONG_BLOB,
            ColumnType::MYSQL_TYPE_ENUM,
            ColumnType::MYSQL_TYPE_SET,
            ColumnType::MYSQL_TYPE_JSON,
        ];
        for text_type in text_types {
            let cell = text_cell("{\"a\": 1}", &column(text_type));
            assert_eq!(
                cell,
                CellValue::Text("{\"a\": 1}".to_string()),
                "{text_type:?}"
            );
        }
    }

    #[test]
    fn binary_flagged_strings_and_blobs_decode_as_bytes() {
        let binary_types = [
            ColumnType::MYSQL_TYPE_STRING,
            ColumnType::MYSQL_TYPE_VAR_STRING,
            ColumnType::MYSQL_TYPE_TINY_BLOB,
            ColumnType::MYSQL_TYPE_BLOB,
            ColumnType::MYSQL_TYPE_MEDIUM_BLOB,
            ColumnType::MYSQL_TYPE_LONG_BLOB,
        ];
        let bytes = vec![0xDE, 0xAD, 0xBE, 0xEF];
        for binary_type in binary_types {
            let binary = binary_column(binary_type);
            let cell = decode_cell(&Value::Bytes(bytes.clone()), &binary);
            assert_eq!(cell, CellValue::Bytes(bytes.clone()), "{binary_type:?}");
            assert_eq!(cell_json(&cell), serde_json::json!(STANDARD.encode(&bytes)));
        }
    }

    #[test]
    fn geometry_and_null_types_and_null_values() {
        let geometry = column(ColumnType::MYSQL_TYPE_GEOMETRY);
        assert_eq!(
            text_cell("POINT", &geometry),
            CellValue::Text("POINT".to_string())
        );
        let null_type = column(ColumnType::MYSQL_TYPE_NULL);
        assert_eq!(decode_cell(&Value::NULL, &null_type), CellValue::Null);
        assert_eq!(cell_json(&CellValue::Null), serde_json::Value::Null);
    }

    #[test]
    fn bin_collated_text_decodes_as_text_not_bytes() {
        let text_types = [
            (ColumnType::MYSQL_TYPE_VAR_STRING, "VARCHAR"),
            (ColumnType::MYSQL_TYPE_STRING, "CHAR"),
            (ColumnType::MYSQL_TYPE_BLOB, "TEXT"),
            (ColumnType::MYSQL_TYPE_LONG_BLOB, "LONGTEXT"),
        ];
        for (text_type, display_name) in text_types {
            let bin_collated = bin_collated_column(text_type);
            assert_eq!(
                text_cell("abc", &bin_collated),
                CellValue::Text("abc".to_string()),
                "{text_type:?}"
            );
            assert_eq!(column_type_display_name(&bin_collated), display_name);
        }
        let varbinary = binary_column(ColumnType::MYSQL_TYPE_VAR_STRING);
        assert_eq!(column_type_display_name(&varbinary), "VARBINARY");
    }

    #[test]
    fn owned_decoding_moves_valid_text_and_repairs_invalid_utf8() {
        let varchar = column(ColumnType::MYSQL_TYPE_VAR_STRING);
        assert_eq!(
            decode_owned_cell(Value::Bytes(b"plain".to_vec()), &varchar),
            CellValue::Text("plain".to_string())
        );
        assert_eq!(
            decode_owned_cell(Value::Bytes(vec![b'a', 0xFF]), &varchar),
            CellValue::Text("a\u{FFFD}".to_string())
        );
    }

    #[test]
    fn invalid_utf8_text_is_decoded_lossily() {
        let varchar = column(ColumnType::MYSQL_TYPE_VAR_STRING);
        let cell = decode_cell(&Value::Bytes(vec![b'a', 0xFF]), &varchar);
        assert_eq!(cell, CellValue::Text("a\u{FFFD}".to_string()));
    }
}

mod renderers {
    use super::*;

    #[test]
    fn grid_variants_render_blob_placeholders_and_binary_keys() {
        let length = CellValue::Unsigned(2_048);
        assert_eq!(
            grid_cell_json(length.clone(), GridCellVariant::BlobPlaceholder),
            serde_json::json!("[BLOB - 2 KB]")
        );
        let signed_length = CellValue::Signed(10);
        assert_eq!(
            grid_cell_json(signed_length.clone(), GridCellVariant::BlobPlaceholder),
            serde_json::json!("[BLOB - 10 B]")
        );
        let negative = CellValue::Signed(-1);
        assert_eq!(
            grid_cell_json(negative.clone(), GridCellVariant::BlobPlaceholder),
            serde_json::Value::Null
        );
        assert_eq!(
            grid_cell_json(CellValue::Null, GridCellVariant::BlobPlaceholder),
            serde_json::Value::Null
        );
    }

    #[test]
    fn binary_primary_keys_render_as_upper_hex() {
        let key = CellValue::Bytes(vec![0xDE, 0xAD]);
        assert_eq!(
            grid_cell_json(key.clone(), GridCellVariant::BinaryPrimaryKey),
            serde_json::json!("0xDEAD")
        );
        let text_key = CellValue::Text("AB".to_string());
        assert_eq!(
            grid_cell_json(text_key.clone(), GridCellVariant::BinaryPrimaryKey),
            serde_json::json!("0x4142")
        );
        assert_eq!(
            grid_cell_json(CellValue::Null, GridCellVariant::BinaryPrimaryKey),
            serde_json::Value::Null
        );
        assert_eq!(
            grid_cell_json(CellValue::Signed(3), GridCellVariant::Value),
            serde_json::json!(3)
        );
    }

    #[test]
    fn debug_text_names_each_kind_of_cell() {
        assert_eq!(debug_text(&CellValue::Null), "None");
        assert_eq!(debug_text(&CellValue::Signed(-1)), "Some(-1)");
        assert_eq!(debug_text(&CellValue::Unsigned(2)), "Some(2)");
        assert_eq!(debug_text(&CellValue::Bit(3)), "Some(3)");
        assert_eq!(debug_text(&CellValue::Float(1.5)), "Some(1.5)");
        assert_eq!(debug_text(&temporal("10:00:00")), "Some(\"10:00:00\")");
        assert_eq!(debug_text(&CellValue::Bytes(vec![1, 2])), "bytes(len=2)");
    }

    #[test]
    fn minus_sign_marks_negative_values() {
        assert_eq!(minus_sign(true), "-");
        assert_eq!(minus_sign(false), "");
    }
}

mod accessors {
    use super::*;

    fn metadata_row() -> DecodedRow {
        let columns: Arc<[Column]> = Arc::from(vec![
            column(ColumnType::MYSQL_TYPE_VAR_STRING).with_name(b"TABLE_NAME"),
            binary_column(ColumnType::MYSQL_TYPE_VAR_STRING).with_name(b"TABLE_COMMENT"),
            column(ColumnType::MYSQL_TYPE_VAR_STRING).with_name(b"ENGINE"),
            column(ColumnType::MYSQL_TYPE_LONGLONG).with_name(b"TABLE_ROWS"),
            flagged_column(ColumnType::MYSQL_TYPE_LONGLONG, ColumnFlags::UNSIGNED_FLAG)
                .with_name(b"DATA_LENGTH"),
        ]);
        let values = [
            Value::Bytes(b"users".to_vec()),
            Value::Bytes(b"people".to_vec()),
            Value::NULL,
            Value::Bytes(b"-5".to_vec()),
            Value::Bytes(b"18446744073709551615".to_vec()),
        ];
        DecodedRow::new(columns, values.to_vec())
    }

    #[test]
    fn text_accessors_read_by_index_and_name_and_tolerate_varbinary() {
        let row = metadata_row();
        assert_eq!(row.required_text(0), Ok("users".to_string()));
        assert_eq!(row.required_text("TABLE_NAME"), Ok("users".to_string()));
        assert_eq!(row.required_text("TABLE_COMMENT"), Ok("people".to_string()));
        assert_eq!(row.optional_text("ENGINE"), Ok(None));
        assert_eq!(row.optional_text(3), Ok(Some("-5".to_string())));
        assert_eq!(row.cells().len(), 5);
    }

    #[test]
    fn integer_accessors_convert_between_signedness_when_lossless() {
        let row = metadata_row();
        assert_eq!(row.signed("TABLE_ROWS"), Ok(-5));
        assert_eq!(row.unsigned("DATA_LENGTH"), Ok(u64::MAX));
        assert!(row.unsigned("TABLE_ROWS").is_err());
        assert!(row.signed("DATA_LENGTH").is_err());
        assert!(row.signed("ENGINE").is_err());
    }

    #[test]
    fn integer_accessors_parse_numeric_text() {
        let columns: Arc<[Column]> = Arc::from(vec![
            column(ColumnType::MYSQL_TYPE_VAR_STRING),
            column(ColumnType::MYSQL_TYPE_BIT),
        ]);
        let row = DecodedRow::new(
            columns,
            vec![Value::Bytes(b"12".to_vec()), Value::Bytes(vec![1])],
        );
        assert_eq!(row.signed(0), Ok(12));
        assert_eq!(row.unsigned(0), Ok(12));
        assert_eq!(row.signed(1), Ok(1));
        assert_eq!(row.unsigned(1), Ok(1));
        assert_eq!(row.required_text(1), Ok("1".to_string()));
    }

    #[test]
    fn accessors_report_missing_columns_and_unexpected_nulls() {
        let row = metadata_row();
        let missing = row.required_text("NOPE").expect_err("missing column");
        assert!(missing.contains("NOPE"), "{missing}");
        assert!(row.cell(99).is_err());
        let null = row.required_text("ENGINE").expect_err("NULL is not text");
        assert!(null.contains("NULL"), "{null}");
        assert_eq!(row.cell(0), Ok(&CellValue::Text("users".to_string())));
    }

    #[test]
    fn numeric_and_temporal_cells_read_as_text() {
        let columns: Arc<[Column]> = Arc::from(vec![
            column(ColumnType::MYSQL_TYPE_DOUBLE),
            column(ColumnType::MYSQL_TYPE_DATE),
            column(ColumnType::MYSQL_TYPE_NEWDECIMAL),
        ]);
        let values = [
            Value::Double(2.5),
            Value::Date(2024, 1, 2, 0, 0, 0, 0),
            Value::Bytes(b"3".to_vec()),
        ];
        let row = DecodedRow::new(columns, values.to_vec());
        assert_eq!(row.required_text(0), Ok("2.5".to_string()));
        assert_eq!(row.required_text(1), Ok("2024-01-02".to_string()));
        assert_eq!(row.signed(2), Ok(3));
        assert!(row.unsigned(1).is_err());
    }

    #[test]
    fn column_metadata_is_exposed_by_index() {
        let row = metadata_row();
        assert_eq!(row.columns().len(), 5);
        assert_eq!(row.column_name(2), "ENGINE");
        assert_eq!(row.column_name(99), "");
    }

    #[test]
    fn optional_bytes_returns_raw_bytes_text_bytes_or_none() {
        let columns: Arc<[Column]> = Arc::from(vec![
            binary_column(ColumnType::MYSQL_TYPE_BLOB),
            column(ColumnType::MYSQL_TYPE_VAR_STRING),
            column(ColumnType::MYSQL_TYPE_VAR_STRING),
        ]);
        let values = [
            Value::Bytes(vec![0, 255]),
            Value::Bytes(b"abc".to_vec()),
            Value::NULL,
        ];
        let row = DecodedRow::new(columns, values.to_vec());
        assert_eq!(row.clone().into_optional_bytes(0), Ok(Some(vec![0, 255])));
        assert_eq!(
            row.clone().into_optional_bytes(1),
            Ok(Some(b"abc".to_vec()))
        );
        assert_eq!(row.clone().into_optional_bytes(2), Ok(None));
    }

    #[test]
    fn optional_unsigned_reads_values_above_the_signed_range() {
        let row = metadata_row();
        assert_eq!(row.optional_unsigned("DATA_LENGTH"), Ok(Some(u64::MAX)));
        assert_eq!(row.optional_unsigned("ENGINE"), Ok(None));
        assert!(row.optional_unsigned("TABLE_ROWS").is_err());
    }

    #[test]
    fn text_or_empty_reads_null_and_missing_columns_as_empty() {
        let row = metadata_row();
        assert_eq!(row.text_or_empty("TABLE_NAME"), "users");
        assert_eq!(row.text_or_empty("ENGINE"), "");
        assert_eq!(row.text_or_empty("NOPE"), "");
    }

    #[test]
    fn into_cells_hands_over_every_decoded_cell() {
        let cells = metadata_row().into_cells();
        assert_eq!(cells.len(), 5);
        assert_eq!(cells[0], CellValue::Text("users".to_string()));
    }

    #[test]
    fn optional_signed_maps_null_to_none_and_rejects_non_integers() {
        let row = metadata_row();
        assert_eq!(row.optional_signed("TABLE_ROWS"), Ok(Some(-5)));
        assert_eq!(row.optional_signed("ENGINE"), Ok(None));
        let not_signed = row
            .optional_signed("TABLE_NAME")
            .expect_err("text is not a signed integer");
        assert!(not_signed.contains("TABLE_NAME"), "{not_signed}");
    }
}
