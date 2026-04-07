// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(coverage))]
fn main() {
    sqllumen_lib::run()
}

#[cfg(coverage)]
fn main() {
    sqllumen_lib::run()
}
