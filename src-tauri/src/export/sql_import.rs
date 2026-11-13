//! SQL script import engine — parses .sql files into individual statements
//! (handling DELIMITER directives, comments, string literals, backticks)
//! and executes them sequentially against a MySQL connection pool.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use crate::commands::query_history_bridge;
use crate::db::history::NewHistoryEntry;
use crate::mysql::sql_chars::{
    has_char_at, has_text_at, has_text_at_ignore_ascii_case, is_ascii_whitespace_at,
    is_escape_before_char, is_line_break_char,
};
use crate::state::{ImportError, ImportJobProgress};

mod import_run;
mod script_parser;
pub use import_run::*;
pub use script_parser::*;
