// No console window behind the app in release builds; dev builds keep it for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    koffer_lib::run()
}
