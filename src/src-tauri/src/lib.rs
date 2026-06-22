mod app_config;
mod app_info;
mod document_windows;
mod launch_args;
mod markdown_files;

use std::time::Instant;
use tauri::{webview::PageLoadEvent, Emitter, Manager, RunEvent};

const APPROVED_FILE_DROP_EVENT: &str = "j3markdown://approved-file-drop";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    run_with_start(Instant::now())
}

pub fn run_with_start(started_at: Instant) {
    let builder_started_at = Instant::now();

    log_startup_mark("rust main entered", started_at, started_at);

    let builder = tauri::Builder::default()
        .manage(document_windows::DetachedWindowDocuments::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let approved_paths = markdown_files::approve_dropped_markdown_file_paths(paths);
                if let Err(error) = window.emit(APPROVED_FILE_DROP_EVENT, approved_paths) {
                    eprintln!("failed to emit approved file drop event: {error}");
                }
            }
        })
        .on_page_load(move |_webview, payload| {
            let event_name = match payload.event() {
                PageLoadEvent::Started => "WebView page load started",
                PageLoadEvent::Finished => "WebView page load finished",
            };

            log_startup_mark(event_name, started_at, Instant::now());
        })
        .setup(move |app| {
            let setup_started_at = Instant::now();
            log_startup_measure(
                "rust main to Tauri setup start",
                started_at,
                started_at,
                setup_started_at,
            );

            let config_started_at = Instant::now();
            app_config::ensure_app_config_file_for_startup()?;
            log_startup_measure(
                "Tauri setup: ensure executable-local config",
                started_at,
                config_started_at,
                Instant::now(),
            );

            let icon_started_at = Instant::now();
            if let Some(icon) = app.default_window_icon().cloned() {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_icon(icon)?;
                }
            }
            log_startup_measure(
                "Tauri setup: set main window icon",
                started_at,
                icon_started_at,
                Instant::now(),
            );

            log_startup_measure(
                "Tauri setup total",
                started_at,
                setup_started_at,
                Instant::now(),
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info::get_about_info,
            app_info::get_about_text,
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
        ]);

    log_startup_measure(
        "Tauri builder configuration",
        started_at,
        builder_started_at,
        Instant::now(),
    );

    log_startup_mark("Tauri app build enter", started_at, Instant::now());

    let app_build_started_at = Instant::now();
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    log_startup_measure(
        "Tauri app build total",
        started_at,
        app_build_started_at,
        Instant::now(),
    );

    log_startup_mark("Tauri app event loop enter", started_at, Instant::now());
    app.run(move |_app_handle, event| {
        if let RunEvent::Ready = event {
            log_startup_mark("Tauri runtime ready", started_at, Instant::now());
        }
    });
}

fn log_startup_mark(name: &str, origin: Instant, instant: Instant) {
    if !startup_profile_enabled() {
        return;
    }

    eprintln!(
        "[startup-profile] {name:<44} start={:>8.2}ms end={:>8.2}ms duration={:>8.2}ms",
        elapsed_ms(origin, instant),
        elapsed_ms(origin, instant),
        0.0
    );
}

fn log_startup_measure(name: &str, origin: Instant, start: Instant, end: Instant) {
    if !startup_profile_enabled() {
        return;
    }

    eprintln!(
        "[startup-profile] {name:<44} start={:>8.2}ms end={:>8.2}ms duration={:>8.2}ms",
        elapsed_ms(origin, start),
        elapsed_ms(origin, end),
        end.duration_since(start).as_secs_f64() * 1000.0
    );
}

fn elapsed_ms(origin: Instant, instant: Instant) -> f64 {
    instant.duration_since(origin).as_secs_f64() * 1000.0
}

fn startup_profile_enabled() -> bool {
    matches!(
        std::env::var("J3MARKDOWN_STARTUP_PROFILE").as_deref(),
        Ok("1")
    )
}
