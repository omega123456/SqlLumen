use sqllumen_lib::logging::parse_log_level_setting;

#[test]
fn parse_log_level_accepts_known_levels() {
    assert!(parse_log_level_setting("DEBUG").is_some());
    assert!(parse_log_level_setting("warn").is_some());
    assert!(parse_log_level_setting("bogus").is_none());
}

#[test]
fn parse_log_level_accepts_trace_and_info() {
    assert!(parse_log_level_setting(" trace ").is_some());
    assert!(parse_log_level_setting("INFO").is_some());
}
