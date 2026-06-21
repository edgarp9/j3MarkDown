use serde::Serialize;
use std::{fs, io};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const ABOUT_GITHUB_URL: &str = "https://github.com/edgarp9";
const ABOUT_TEXT: &str = include_str!("../../about.txt");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AboutInfo {
    version: String,
    github_url: String,
}

#[tauri::command]
pub fn get_about_info() -> AboutInfo {
    about_info()
}

#[tauri::command]
pub fn get_about_text(handle: AppHandle) -> String {
    read_release_text_resource(&handle, "about.txt", ABOUT_TEXT)
}

#[tauri::command]
pub fn open_about_link() -> Result<(), String> {
    open_url_in_default_browser(ABOUT_GITHUB_URL)
        .map_err(|error| format!("기본 브라우저를 열 수 없습니다: {error}"))
}

fn about_info() -> AboutInfo {
    AboutInfo {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        github_url: ABOUT_GITHUB_URL.to_owned(),
    }
}

fn read_release_text_resource(handle: &AppHandle, resource_name: &str, fallback: &str) -> String {
    handle
        .path()
        .resolve(resource_name, BaseDirectory::Resource)
        .ok()
        .and_then(|resource_path| fs::read_to_string(resource_path).ok())
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

#[cfg(windows)]
fn open_url_in_default_browser(url: &str) -> io::Result<()> {
    use std::ptr;

    const SW_SHOWNORMAL: i32 = 1;

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut std::ffi::c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }

    let operation = windows_wide_null("open");
    let file = windows_wide_null(url);
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    if result <= 32 {
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("ShellExecuteW failed with code {result}"),
        ))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn windows_wide_null(value: &str) -> Vec<u16> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "macos")]
fn open_url_in_default_browser(url: &str) -> io::Result<()> {
    std::process::Command::new("open").arg(url).spawn()?.wait()?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_in_default_browser(url: &str) -> io::Result<()> {
    std::process::Command::new("xdg-open").arg(url).spawn()?.wait()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{about_info, ABOUT_GITHUB_URL, ABOUT_TEXT};
    use serde_json::json;

    #[test]
    fn about_info_contract_has_stable_fields() {
        let info = about_info();

        assert_eq!(
            serde_json::to_value(&info).expect("about info should serialize"),
            json!({
                "version": env!("CARGO_PKG_VERSION"),
                "githubUrl": ABOUT_GITHUB_URL,
            })
        );
    }

    #[test]
    fn bundled_about_text_is_available_as_fallback() {
        assert!(ABOUT_TEXT.contains("j3Markdown"));
        assert!(ABOUT_TEXT.contains("THIRD_PARTY_NOTICES.txt"));
    }
}
