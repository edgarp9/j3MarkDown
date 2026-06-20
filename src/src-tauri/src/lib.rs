mod app_config;
mod app_info;
mod document_windows;
mod launch_args;
mod markdown_files;

use tauri::{Emitter, Manager};

const APPROVED_FILE_DROP_EVENT: &str = "j3markdown://approved-file-drop";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(document_windows::DetachedWindowDocuments::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let approved_paths = markdown_files::approve_dropped_markdown_file_paths(paths);
                if let Err(error) = window.emit(APPROVED_FILE_DROP_EVENT, approved_paths) {
                    eprintln!("failed to emit approved file drop event: {error}");
                }
            }
        })
        .setup(|app| {
            app_config::ensure_app_config_file_for_startup()?;

            if let Some(icon) = app.default_window_icon().cloned() {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_icon(icon)?;
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info::get_about_info,
            app_info::open_about_link,
            app_config::read_editor_theme_setting,
            app_config::save_editor_theme_setting,
            app_config::read_ui_language_setting,
            app_config::save_ui_language_setting,
            launch_args::get_launch_paths,
            document_windows::open_markdown_document_in_new_window,
            document_windows::complete_detached_window_broadcast_handoff,
            document_windows::take_detached_window_document,
            markdown_files::open_markdown_file,
            markdown_files::open_markdown_file_at_path,
            markdown_files::open_markdown_files_at_paths,
            markdown_files::save_markdown_file,
            markdown_files::select_markdown_save_path,
            markdown_files::save_markdown_file_as,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
