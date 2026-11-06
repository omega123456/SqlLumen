//! Streaming row sinks (`export::stream_writer`): CSV, JSON and SQL output is
//! byte-identical to the slice writers; XLSX (constant-memory) is read back
//! from the archive and compared cell by cell, with the bold header, freeze
//! pane, first-1,000-row column widths and the sheet-limit stop.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sqllumen_lib::export::stream_writer::{
    RowSink, RowWrite, XLSX_SHEET_ROW_LIMIT, XLSX_WIDTH_SAMPLE_ROWS,
};
use sqllumen_lib::export::{csv_writer, json_writer, sql_writer, xlsx_writer, ExportFormat};

fn columns() -> Vec<String> {
    vec![
        "id".to_string(),
        "name".to_string(),
        "active".to_string(),
        "score".to_string(),
        "meta".to_string(),
    ]
}

fn rows() -> Vec<Vec<Value>> {
    vec![
        vec![
            json!(1),
            json!("Alice, \"Al\""),
            json!(true),
            json!(1.5),
            json!({"tags": ["a", "b"], "nested": {"k": null}}),
        ],
        vec![
            json!(2),
            json!("O'Brien \\ back\nslash"),
            json!(false),
            Value::Null,
            json!([1, "two", {}]),
        ],
        vec![json!(3), Value::Null, Value::Null, json!(-7), json!({})],
        vec![
            json!(18_446_744_073_709_551_615u64),
            json!("emoji 😀 and tab\t"),
            json!(true),
            json!(0),
            json!([]),
        ],
    ]
}

fn temp(name: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(name);
    (dir, path)
}

fn stream(
    format: &ExportFormat,
    path: &Path,
    columns: &[String],
    rows: &[Vec<Value>],
    include_headers: bool,
    table_name: Option<&str>,
) -> sqllumen_lib::export::stream_writer::StreamSummary {
    let mut sink =
        RowSink::create(format, path, columns, include_headers, table_name).expect("create sink");
    for row in rows {
        assert_eq!(sink.write_row(row).expect("write row"), RowWrite::Written);
    }
    sink.finish().expect("finish sink")
}

#[test]
fn csv_stream_is_byte_identical_to_the_slice_writer() {
    for include_headers in [true, false] {
        let (_dir, path) = temp("out.csv");
        let summary = stream(
            &ExportFormat::Csv,
            &path,
            &columns(),
            &rows(),
            include_headers,
            None,
        );

        let mut expected = Vec::new();
        csv_writer::write_csv(&mut expected, &columns(), &rows(), include_headers).expect("csv");
        let actual = std::fs::read(&path).expect("read csv");
        assert_eq!(actual, expected, "include_headers={include_headers}");
        assert_eq!(summary.rows_written, 4);
        assert_eq!(summary.bytes_written, expected.len() as u64);
        assert!(!summary.stopped_at_sheet_limit);
    }
}

#[test]
fn json_stream_is_byte_identical_to_the_slice_writer() {
    let cases: Vec<Vec<Vec<Value>>> = vec![rows(), rows()[..1].to_vec(), vec![]];
    for case in cases {
        let (_dir, path) = temp("out.json");
        let summary = stream(&ExportFormat::Json, &path, &columns(), &case, true, None);

        let mut expected = Vec::new();
        json_writer::write_json(&mut expected, &columns(), &case, true).expect("json");
        let actual = std::fs::read(&path).expect("read json");
        assert_eq!(
            String::from_utf8(actual).expect("utf8"),
            String::from_utf8(expected.clone()).expect("utf8"),
            "rows={}",
            case.len()
        );
        assert_eq!(summary.rows_written, case.len() as u64);
        assert_eq!(summary.bytes_written, expected.len() as u64);
    }
}

#[test]
fn json_stream_matches_for_rows_without_columns_and_short_rows() {
    let (_dir, path) = temp("short.json");
    let short_rows = vec![vec![json!(1)], vec![]];
    stream(
        &ExportFormat::Json,
        &path,
        &columns(),
        &short_rows,
        false,
        None,
    );
    let mut expected = Vec::new();
    json_writer::write_json(&mut expected, &columns(), &short_rows, false).expect("json");
    assert_eq!(std::fs::read(&path).expect("read"), expected);

    let (_dir, path) = temp("empty-objects.json");
    stream(
        &ExportFormat::Json,
        &path,
        &[],
        &[vec![], vec![]],
        false,
        None,
    );
    let mut expected = Vec::new();
    json_writer::write_json(&mut expected, &[], &[Vec::<Value>::new(), vec![]], false)
        .expect("json");
    assert_eq!(std::fs::read(&path).expect("read"), expected);
}

#[test]
fn sql_stream_is_byte_identical_to_the_slice_writer() {
    let backtick_columns: Vec<String> = vec!["a`b".into(), "c".into(), "d".into(), "e".into()];
    let cases = [
        (columns(), None, "exported_results"),
        (backtick_columns, Some("my`table"), "my`table"),
    ];
    for (cols, table_name, slice_table) in cases {
        let (_dir, path) = temp("out.sql");
        let summary = stream(
            &ExportFormat::SqlInsert,
            &path,
            &cols,
            &rows(),
            true,
            table_name,
        );
        let mut expected = Vec::new();
        sql_writer::write_sql(&mut expected, &cols, &rows(), true, slice_table).expect("sql");
        assert_eq!(
            String::from_utf8(std::fs::read(&path).expect("read")).expect("utf8"),
            String::from_utf8(expected.clone()).expect("utf8")
        );
        assert_eq!(summary.bytes_written, expected.len() as u64);
    }
}

#[test]
fn sql_stream_refuses_an_empty_table_name() {
    let (_dir, path) = temp("out.sql");
    let error = RowSink::create(&ExportFormat::SqlInsert, &path, &columns(), true, Some(""))
        .err()
        .expect("empty table name is refused");
    assert!(error.contains("table_name must not be empty"), "{error}");
}

#[test]
fn bytes_written_tracks_text_output_and_is_zero_for_xlsx_until_saved() {
    let (_dir, path) = temp("progress.csv");
    let mut sink = RowSink::create(&ExportFormat::Csv, &path, &columns(), true, None).expect("csv");
    for _ in 0..2_000 {
        sink.write_row(&rows()[0]).expect("row");
    }
    assert_eq!(sink.rows_written(), 2_000);
    assert!(
        sink.bytes_written() > 0,
        "the csv buffer spilled to the file"
    );
    assert!(!sink.stopped_at_sheet_limit());
    let summary = sink.finish().expect("finish");
    assert_eq!(
        summary.bytes_written,
        std::fs::metadata(&path).expect("meta").len()
    );

    let (_dir, path) = temp("progress.json");
    let mut sink =
        RowSink::create(&ExportFormat::Json, &path, &columns(), true, None).expect("json");
    sink.write_row(&rows()[0]).expect("row");
    assert!(sink.bytes_written() > 0);

    let (_dir, path) = temp("progress.sql");
    let mut sink =
        RowSink::create(&ExportFormat::SqlInsert, &path, &columns(), true, None).expect("sql");
    sink.write_row(&rows()[0]).expect("row");
    assert!(sink.bytes_written() > 0);

    let (_dir, path) = temp("progress.xlsx");
    let mut sink =
        RowSink::create(&ExportFormat::Xlsx, &path, &columns(), true, None).expect("xlsx");
    sink.write_row(&rows()[0]).expect("row");
    assert_eq!(sink.bytes_written(), 0);
    assert_eq!(sink.rows_written(), 1);
    let summary = sink.finish().expect("finish");
    assert!(summary.bytes_written > 0);
}

#[test]
fn creating_a_sink_in_a_missing_directory_fails() {
    let (dir, _) = temp("unused");
    let missing = dir.path().join("missing").join("out.csv");
    for format in [
        ExportFormat::Csv,
        ExportFormat::Json,
        ExportFormat::SqlInsert,
    ] {
        let error = RowSink::create(&format, &missing, &columns(), true, None)
            .err()
            .expect("missing directory");
        assert!(error.starts_with("Failed to create file:"), "{error}");
    }

    let mut sink =
        RowSink::create(&ExportFormat::Xlsx, &missing, &columns(), true, None).expect("xlsx");
    sink.write_row(&rows()[0]).expect("buffered row");
    let error = sink.finish().expect_err("xlsx save fails");
    assert!(error.starts_with("Failed to write XLSX:"), "{error}");
}

// ── XLSX read-back ────────────────────────────────────────────────────────────

fn zip_entry(path: &Path, name: &str) -> Option<String> {
    let file = std::fs::File::open(path).expect("open xlsx");
    let mut archive = zip::ZipArchive::new(file).expect("xlsx is a zip archive");
    let mut entry = archive.by_name(name).ok()?;
    let mut xml = String::new();
    entry.read_to_string(&mut xml).expect("read entry");
    Some(xml)
}

fn sheet_xml(path: &Path) -> String {
    zip_entry(path, "xl/worksheets/sheet1.xml").expect("sheet1.xml")
}

/// Cells as `ref -> (type, value, style)`, with shared and inline strings resolved.
fn sheet_cells(path: &Path) -> BTreeMap<String, (String, String, String)> {
    let shared: Vec<String> = zip_entry(path, "xl/sharedStrings.xml")
        .map(|xml| {
            regex::Regex::new(r"(?s)<si><t[^>]*>(.*?)</t></si>")
                .expect("regex")
                .captures_iter(&xml)
                .map(|c| c[1].to_string())
                .collect()
        })
        .unwrap_or_default();
    let cell_re =
        regex::Regex::new(r#"(?s)<c r="([A-Z]+[0-9]+)"([^>]*)>(.*?)</c>"#).expect("regex");
    let attr_re = |name: &str| regex::Regex::new(&format!(r#"{name}="([^"]*)""#)).expect("regex");
    let (type_re, style_re) = (attr_re("t"), attr_re("s"));
    let value_re = regex::Regex::new(r"<v>(.*?)</v>").expect("regex");
    let inline_re = regex::Regex::new(r"(?s)<is><t[^>]*>(.*?)</t></is>").expect("regex");

    let xml = sheet_xml(path);
    cell_re
        .captures_iter(&xml)
        .map(|c| {
            let attrs = &c[2];
            let body = &c[3];
            let kind = type_re
                .captures(attrs)
                .map_or("n".to_string(), |t| t[1].to_string());
            let style = style_re
                .captures(attrs)
                .map_or(String::new(), |s| s[1].to_string());
            let (kind, value) = match kind.as_str() {
                "s" => {
                    let index: usize = value_re.captures(body).expect("v")[1].parse().expect("idx");
                    ("str".to_string(), shared[index].clone())
                }
                "inlineStr" => (
                    "str".to_string(),
                    inline_re.captures(body).expect("is")[1].to_string(),
                ),
                other => (
                    other.to_string(),
                    value_re.captures(body).expect("v")[1].to_string(),
                ),
            };
            (c[1].to_string(), (kind, value, style))
        })
        .collect()
}

fn cols_section(path: &Path) -> String {
    let xml = sheet_xml(path);
    let start = xml.find("<cols>").expect("<cols>");
    let end = xml.find("</cols>").expect("</cols>");
    xml[start..end].to_string()
}

fn flat_rows(count: usize) -> Vec<Vec<Value>> {
    (0..count)
        .map(|i| {
            vec![
                json!(i),
                json!(format!("name-{i}")),
                json!(i % 2 == 0),
                if i % 3 == 0 {
                    Value::Null
                } else {
                    json!(i as f64 / 4.0)
                },
                json!({"i": i}),
            ]
        })
        .collect()
}

#[test]
fn xlsx_stream_has_the_slice_writers_cells_bold_header_and_freeze_pane() {
    let (_dir, stream_path) = temp("stream.xlsx");
    let (_dir2, slice_path) = temp("slice.xlsx");
    let summary = stream(
        &ExportFormat::Xlsx,
        &stream_path,
        &columns(),
        &rows(),
        true,
        None,
    );
    xlsx_writer::write_xlsx(
        slice_path.to_str().expect("path"),
        &columns(),
        &rows(),
        true,
    )
    .expect("slice xlsx");

    assert_eq!(summary.rows_written, 4);
    let stream_cells = sheet_cells(&stream_path);
    let slice_cells = sheet_cells(&slice_path);
    let strip_style = |cells: &BTreeMap<String, (String, String, String)>| {
        cells
            .iter()
            .map(|(r, (k, v, _))| (r.clone(), (k.clone(), v.clone())))
            .collect::<BTreeMap<_, _>>()
    };
    assert_eq!(strip_style(&stream_cells), strip_style(&slice_cells));

    // Spot-check types: number, string, boolean, NULL left empty.
    assert_eq!(stream_cells["A2"], ("n".into(), "1".into(), String::new()));
    assert_eq!(stream_cells["C2"].0, "b");
    assert_eq!(stream_cells["C2"].1, "1");
    assert_eq!(stream_cells["B2"].0, "str");
    assert!(!stream_cells.contains_key("B4"), "NULL is an empty cell");

    // Bold header row: header cells share a style whose font is bold.
    let header_style = &stream_cells["A1"].2;
    assert!(!header_style.is_empty(), "header cells are styled");
    for col in ["B1", "C1", "D1", "E1"] {
        assert_eq!(&stream_cells[col].2, header_style);
    }
    let styles = zip_entry(&stream_path, "xl/styles.xml").expect("styles.xml");
    assert!(styles.contains("<b/>"), "a bold font is defined");

    // Freeze pane below the header, as the slice writer.
    let xml = sheet_xml(&stream_path);
    assert!(
        xml.contains(
            r#"<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>"#
        ),
        "{xml}"
    );
    assert!(sheet_xml(&slice_path).contains(r#"state="frozen""#));
    assert!(
        xml.contains("Query Results")
            || zip_entry(&stream_path, "xl/workbook.xml")
                .expect("wb")
                .contains("Query Results")
    );
    assert_eq!(cols_section(&stream_path), cols_section(&slice_path));
}

#[test]
fn xlsx_stream_without_headers_starts_at_a1_without_a_freeze_pane() {
    let (_dir, path) = temp("noheaders.xlsx");
    stream(&ExportFormat::Xlsx, &path, &columns(), &rows(), false, None);
    let cells = sheet_cells(&path);
    assert_eq!(cells["A1"], ("n".into(), "1".into(), String::new()));
    assert!(!sheet_xml(&path).contains("<pane"));
}

#[test]
fn xlsx_stream_sizes_columns_from_the_first_1000_rows_only() {
    let mut all = flat_rows(XLSX_WIDTH_SAMPLE_ROWS + 500);
    // A long value after the sample must not widen its column.
    all[XLSX_WIDTH_SAMPLE_ROWS + 10][1] = json!("x".repeat(45));
    let (_dir, stream_path) = temp("wide.xlsx");
    let summary = stream(
        &ExportFormat::Xlsx,
        &stream_path,
        &columns(),
        &all,
        true,
        None,
    );
    assert_eq!(summary.rows_written, all.len() as u64);

    // The slice writer over just the sample yields the expected widths.
    let (_dir2, sample_path) = temp("sample.xlsx");
    xlsx_writer::write_xlsx(
        sample_path.to_str().expect("path"),
        &columns(),
        &all[..XLSX_WIDTH_SAMPLE_ROWS],
        true,
    )
    .expect("slice xlsx");
    assert_eq!(cols_section(&stream_path), cols_section(&sample_path));
    let (_dir3, full_path) = temp("full.xlsx");
    xlsx_writer::write_xlsx(full_path.to_str().expect("path"), &columns(), &all, true)
        .expect("slice xlsx");
    assert_ne!(
        cols_section(&stream_path),
        cols_section(&full_path),
        "scanning every row would have widened the name column"
    );

    // Rows past the sample are streamed in order.
    let cells = sheet_cells(&stream_path);
    let last = all.len() + 1;
    assert_eq!(cells[&format!("A{last}")].1, (all.len() - 1).to_string());
    assert_eq!(
        cells[&format!("B{}", XLSX_WIDTH_SAMPLE_ROWS + 12)].1,
        "x".repeat(45)
    );
}

#[test]
fn xlsx_stream_stops_at_the_sheet_row_limit_and_reports_it() {
    assert_eq!(XLSX_SHEET_ROW_LIMIT, 1_048_576);
    for (include_headers, limit, data_rows) in [(true, 4u32, 3u64), (false, 3, 3)] {
        let (_dir, path) = temp("limit.xlsx");
        let mut sink = RowSink::create_with_sheet_row_limit(
            &ExportFormat::Xlsx,
            &path,
            &columns(),
            include_headers,
            None,
            limit,
        )
        .expect("xlsx");
        let rows = flat_rows(6);
        let outcomes: Vec<RowWrite> = rows
            .iter()
            .map(|row| sink.write_row(row).expect("row"))
            .collect();
        assert_eq!(
            outcomes,
            vec![
                RowWrite::Written,
                RowWrite::Written,
                RowWrite::Written,
                RowWrite::SheetLimitReached,
                RowWrite::SheetLimitReached,
                RowWrite::SheetLimitReached,
            ]
        );
        assert!(sink.stopped_at_sheet_limit());
        assert_eq!(sink.rows_written(), data_rows);
        let summary = sink.finish().expect("finish");
        assert!(summary.stopped_at_sheet_limit);
        assert_eq!(summary.rows_written, data_rows);

        let cells = sheet_cells(&path);
        let max_row = cells
            .keys()
            .map(|r| {
                r.trim_start_matches(char::is_alphabetic)
                    .parse::<u32>()
                    .expect("row")
            })
            .max()
            .expect("cells");
        assert_eq!(max_row, limit, "include_headers={include_headers}");
    }
}

#[test]
fn xlsx_stream_stops_at_the_limit_after_the_width_sample() {
    let limit = (XLSX_WIDTH_SAMPLE_ROWS + 6) as u32;
    let (_dir, path) = temp("limit-after-sample.xlsx");
    let mut sink = RowSink::create_with_sheet_row_limit(
        &ExportFormat::Xlsx,
        &path,
        &columns(),
        true,
        None,
        limit,
    )
    .expect("xlsx");
    let rows = flat_rows(XLSX_WIDTH_SAMPLE_ROWS + 10);
    let written = rows
        .iter()
        .filter(|row| sink.write_row(row).expect("row") == RowWrite::Written)
        .count();
    assert_eq!(written, XLSX_WIDTH_SAMPLE_ROWS + 5);
    let summary = sink.finish().expect("finish");
    assert!(summary.stopped_at_sheet_limit);
    assert_eq!(summary.rows_written, (XLSX_WIDTH_SAMPLE_ROWS + 5) as u64);
}
