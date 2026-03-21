// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(coverage))]
fn main() {
    mysql_client_lib::run()
}

#[cfg(coverage)]
fn main() {
    mysql_client_lib::run()
}
