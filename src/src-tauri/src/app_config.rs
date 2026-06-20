use std::{
    env,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io,
    io::Write,
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
};

const DEFAULT_APP_CONFIG: &str =
    "# j3Markdown executable-local configuration\nschema_version = 1\neditor_theme = \"classic\"\nui_language = \"en\"\n";
const EDITOR_THEME_KEY: &str = "editor_theme";
const DEFAULT_EDITOR_THEME: &str = "classic";
const SUPPORTED_EDITOR_THEMES: &[&str] = &[
    "classic",
    "classic-dark",
    "nord-dark",
    "lagoon",
    "lagoon-dark",
    "berry",
    "berry-dark",
];
const UI_LANGUAGE_KEY: &str = "ui_language";
const DEFAULT_UI_LANGUAGE: &str = "en";
const SUPPORTED_UI_LANGUAGES: &[&str] = &["en", "ko"];
static NEXT_APP_CONFIG_TEMP_FILE_ID: AtomicU64 = AtomicU64::new(1);

pub fn ensure_app_config_file_for_startup() -> io::Result<()> {
    let path = app_config_path().map_err(|error| {
        io::Error::new(
            error.kind(),
            format!("failed to resolve executable-local app config path: {error}"),
        )
    })?;

    ensure_app_config_file_for_startup_at_path(&path)
}

#[tauri::command]
pub async fn read_editor_theme_setting() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = app_config_path().map_err(|error| {
            format!("failed to resolve executable-local app config path: {error}")
        })?;

        read_editor_theme_setting_at_path(&path)
            .map_err(|error| format!("failed to read editor theme setting: {error}"))
    })
    .await
    .map_err(|error| format!("failed to join editor theme setting read task: {error}"))?
}

#[tauri::command]
pub async fn save_editor_theme_setting(theme_id: String) -> Result<(), String> {
    if !is_supported_editor_theme(&theme_id) {
        return Err(format!("unsupported editor theme setting: {theme_id}"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let path = app_config_path().map_err(|error| {
            format!("failed to resolve executable-local app config path: {error}")
        })?;

        save_editor_theme_setting_at_path(&path, &theme_id)
            .map_err(|error| format!("failed to save editor theme setting: {error}"))
    })
    .await
    .map_err(|error| format!("failed to join editor theme setting save task: {error}"))?
}

#[tauri::command]
pub async fn read_ui_language_setting() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = app_config_path().map_err(|error| {
            format!("failed to resolve executable-local app config path: {error}")
        })?;

        read_ui_language_setting_at_path(&path)
            .map_err(|error| format!("failed to read UI language setting: {error}"))
    })
    .await
    .map_err(|error| format!("failed to join UI language setting read task: {error}"))?
}

#[tauri::command]
pub async fn save_ui_language_setting(language_id: String) -> Result<(), String> {
    if !is_supported_ui_language(&language_id) {
        return Err(format!("unsupported UI language setting: {language_id}"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let path = app_config_path().map_err(|error| {
            format!("failed to resolve executable-local app config path: {error}")
        })?;

        save_ui_language_setting_at_path(&path, &language_id)
            .map_err(|error| format!("failed to save UI language setting: {error}"))
    })
    .await
    .map_err(|error| format!("failed to join UI language setting save task: {error}"))?
}

fn app_config_path() -> io::Result<PathBuf> {
    let executable_path = env::current_exe()?;
    Ok(config_path_for_executable(&executable_path))
}

fn config_path_for_executable(executable_path: &Path) -> PathBuf {
    let mut config_path = executable_path.to_path_buf();
    config_path.set_extension("toml");
    config_path
}

fn ensure_app_config_file_at_path(path: &Path) -> io::Result<()> {
    let file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            ensure_existing_app_config_path_is_file(path)?;
            return Ok(());
        }
        Err(error) => return Err(error),
    };

    write_default_app_config_to_created_file(path, file, |file| {
        file.write_all(DEFAULT_APP_CONFIG.as_bytes())
    })
}

fn write_default_app_config_to_created_file(
    path: &Path,
    mut file: fs::File,
    write_default_config: impl FnOnce(&mut fs::File) -> io::Result<()>,
) -> io::Result<()> {
    if let Err(error) = write_default_config(&mut file) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error);
    }

    Ok(())
}

fn ensure_existing_app_config_path_is_file(path: &Path) -> io::Result<()> {
    if fs::metadata(path)?.is_file() {
        return Ok(());
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        format!(
            "app config path exists but is not a file: {}",
            path.display()
        ),
    ))
}

fn ensure_app_config_file_for_startup_at_path(path: &Path) -> io::Result<()> {
    ensure_app_config_file_at_path(path).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "failed to create executable-local app config at {}: {error}",
                path.display()
            ),
        )
    })
}

fn read_editor_theme_setting_at_path(path: &Path) -> io::Result<String> {
    read_basic_string_setting_at_path(
        path,
        EDITOR_THEME_KEY,
        DEFAULT_EDITOR_THEME,
        is_supported_editor_theme,
    )
}

fn save_editor_theme_setting_at_path(path: &Path, theme_id: &str) -> io::Result<()> {
    save_basic_string_setting_at_path(path, EDITOR_THEME_KEY, theme_id)
}

fn read_ui_language_setting_at_path(path: &Path) -> io::Result<String> {
    read_basic_string_setting_at_path(
        path,
        UI_LANGUAGE_KEY,
        DEFAULT_UI_LANGUAGE,
        is_supported_ui_language,
    )
}

fn save_ui_language_setting_at_path(path: &Path, language_id: &str) -> io::Result<()> {
    save_basic_string_setting_at_path(path, UI_LANGUAGE_KEY, language_id)
}

fn read_basic_string_setting_at_path(
    path: &Path,
    setting_key: &str,
    default_value: &str,
    is_supported_value: impl Fn(&str) -> bool,
) -> io::Result<String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(default_value.to_owned());
        }
        Err(error) => return Err(error),
    };
    Ok(parse_basic_string_setting(&content, setting_key)
        .filter(|value| is_supported_value(value))
        .unwrap_or(default_value)
        .to_owned())
}

fn save_basic_string_setting_at_path(
    path: &Path,
    setting_key: &str,
    setting_value: &str,
) -> io::Result<()> {
    ensure_app_config_file_at_path(path)?;
    let content = fs::read_to_string(path)?;
    write_app_config_atomically(
        path,
        &set_basic_string_setting_in_config(&content, setting_key, setting_value),
    )
}

fn write_app_config_atomically(path: &Path, content: &str) -> io::Result<()> {
    write_app_config_atomically_with_replace(path, content, replace_file)
}

fn write_app_config_atomically_with_replace(
    path: &Path,
    content: &str,
    replace_file: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "app config path must include a file name",
        )
    })?;
    let (temp_path, mut temp_file) = create_app_config_temp_file(parent)?;

    let write_result = (|| {
        temp_file.write_all(content.as_bytes())?;
        temp_file.sync_data()?;
        drop(temp_file);
        replace_file(&temp_path, path)?;
        sync_parent_directory(parent)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    write_result
}

fn create_app_config_temp_file(parent: &Path) -> io::Result<(PathBuf, File)> {
    for _ in 0..32 {
        let temp_path = parent.join(app_config_temp_file_name());
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not create a unique temporary app config file",
    ))
}

fn app_config_temp_file_name() -> OsString {
    let id = NEXT_APP_CONFIG_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    OsString::from(format!(".j3config.{}.{}.tmp", process::id(), id))
}

fn replace_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    match fs::metadata(target_path) {
        Ok(_) => replace_existing_file(temp_path, target_path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::rename(temp_path, target_path),
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn replace_existing_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x00000001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x00000008;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(
            lpExistingFileName: *const u16,
            lpNewFileName: *const u16,
            dwFlags: u32,
        ) -> i32;
    }

    let target_path = windows_path_argument(target_path);
    let temp_path = windows_path_argument(temp_path);
    let replaced = unsafe {
        MoveFileExW(
            temp_path.as_ptr(),
            target_path.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn windows_path_argument(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(not(windows))]
fn replace_existing_file(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    fs::rename(temp_path, target_path)
}

#[cfg(windows)]
fn sync_parent_directory(_parent: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
fn sync_parent_directory(parent: &Path) -> io::Result<()> {
    File::open(parent)?.sync_all()
}

fn parse_basic_string_setting<'a>(content: &'a str, setting_key: &str) -> Option<&'a str> {
    for line in content.lines() {
        let trimmed_line = line.trim_start();
        if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
            continue;
        }

        let Some((key, value)) = trimmed_line.split_once('=') else {
            continue;
        };

        if key.trim() != setting_key {
            continue;
        }

        return parse_toml_basic_string(value.trim());
    }

    None
}

fn parse_toml_basic_string(value: &str) -> Option<&str> {
    let value = value.strip_prefix('"')?;
    let end = value.find('"')?;

    Some(&value[..end])
}

fn set_basic_string_setting_in_config(
    content: &str,
    setting_key: &str,
    setting_value: &str,
) -> String {
    let replacement_line = format!("{setting_key} = \"{setting_value}\"");
    let mut updated = String::with_capacity(content.len() + replacement_line.len() + 2);
    let mut replaced = false;

    for line in content.split_inclusive('\n') {
        let line_without_newline = line.strip_suffix('\n').unwrap_or(line);
        if is_basic_string_setting_line(line_without_newline, setting_key) {
            updated.push_str(&replacement_line);
            if line.ends_with('\n') {
                updated.push('\n');
            }
            replaced = true;
        } else {
            updated.push_str(line);
        }
    }

    if !replaced {
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(&replacement_line);
        updated.push('\n');
    }

    updated
}

fn is_basic_string_setting_line(line: &str, setting_key: &str) -> bool {
    let trimmed_line = line.trim_start();
    if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
        return false;
    }

    let Some((key, _)) = trimmed_line.split_once('=') else {
        return false;
    };

    key.trim() == setting_key
}

fn is_supported_editor_theme(theme_id: &str) -> bool {
    SUPPORTED_EDITOR_THEMES.contains(&theme_id)
}

fn is_supported_ui_language(language_id: &str) -> bool {
    SUPPORTED_UI_LANGUAGES.contains(&language_id)
}

#[cfg(test)]
mod tests {
    use super::{
        config_path_for_executable, ensure_app_config_file_at_path,
        ensure_app_config_file_for_startup_at_path, ensure_existing_app_config_path_is_file,
        read_editor_theme_setting_at_path, read_ui_language_setting_at_path,
        save_editor_theme_setting_at_path, save_ui_language_setting_at_path,
        write_app_config_atomically_with_replace, write_default_app_config_to_created_file,
        DEFAULT_EDITOR_THEME, DEFAULT_UI_LANGUAGE,
    };
    use std::{
        fs, io,
        path::{Path, PathBuf},
        process,
        sync::atomic::{AtomicUsize, Ordering},
    };

    static NEXT_WORKSPACE_ID: AtomicUsize = AtomicUsize::new(1);

    #[test]
    fn derives_config_path_from_executable_name_in_same_directory() {
        let executable_path = PathBuf::from(r"C:\Program Files\j3Markdown\j3Markdown.exe");
        let config_path = config_path_for_executable(&executable_path);

        assert_eq!(
            config_path,
            PathBuf::from(r"C:\Program Files\j3Markdown\j3Markdown.toml")
        );
    }

    #[test]
    fn creates_missing_config_with_default_toml() {
        let workspace = TestWorkspace::new("create-config");
        let config_path = workspace.path("j3Markdown.toml");

        ensure_app_config_file_at_path(&config_path).expect("missing app config should be created");

        let content = fs::read_to_string(&config_path).expect("config should be readable");
        assert!(content.contains("schema_version = 1"));
        assert!(content.contains("editor_theme = \"classic\""));
        assert!(content.contains("ui_language = \"en\""));
    }

    #[test]
    fn preserves_existing_config_content() {
        let workspace = TestWorkspace::new("preserve-config");
        let config_path = workspace.path("j3Markdown.toml");
        let existing_content = "schema_version = 1\nopen_last_tabs = true\n";
        fs::write(&config_path, existing_content).expect("existing config should be written");

        ensure_app_config_file_at_path(&config_path)
            .expect("existing app config should be accepted");

        let content = fs::read_to_string(&config_path).expect("config should be readable");
        assert_eq!(content, existing_content);
    }

    #[test]
    fn rejects_existing_config_path_when_it_is_not_a_file() {
        let workspace = TestWorkspace::new("reject-directory-config-path");
        let config_path = workspace.path("j3Markdown.toml");
        fs::create_dir(&config_path).expect("directory should be created at config path");

        let error = ensure_existing_app_config_path_is_file(&config_path)
            .expect_err("directory at existing app config path should be rejected");

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert!(
            error.to_string().contains("exists but is not a file"),
            "non-file config path error should explain the conflict"
        );
    }

    #[test]
    fn existing_directory_config_path_is_rejected_by_strict_creation_helper() {
        let workspace = TestWorkspace::new("reject-directory-config-path-through-startup");
        let config_path = workspace.path("j3Markdown.toml");
        fs::create_dir(&config_path).expect("directory should be created at config path");

        ensure_app_config_file_at_path(&config_path)
            .expect_err("directory at app config path should be rejected");
    }

    #[test]
    fn startup_config_creation_failure_is_not_recoverable() {
        let workspace = TestWorkspace::new("startup-config-unrecoverable-failure");
        let config_path = workspace.path("missing-parent").join("j3Markdown.toml");

        let error = ensure_app_config_file_for_startup_at_path(&config_path)
            .expect_err("startup config creation failure should fail startup");

        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert!(!config_path.exists());
    }

    #[test]
    fn startup_config_creation_failure_is_returned() {
        let workspace = TestWorkspace::new("startup-config-failure");
        let config_path = workspace.path("missing-parent").join("j3Markdown.toml");

        let error = ensure_app_config_file_for_startup_at_path(&config_path)
            .expect_err("startup config creation failure should be returned");

        assert!(
            error
                .to_string()
                .contains("failed to create executable-local app config"),
            "startup config creation failure should include context"
        );
        assert!(!config_path.exists());
    }

    #[test]
    fn removes_new_config_file_when_default_write_fails() {
        let workspace = TestWorkspace::new("cleanup-config-write-failure");
        let config_path = workspace.path("j3Markdown.toml");
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&config_path)
            .expect("new app config file should be created");

        let error = write_default_app_config_to_created_file(&config_path, file, |_| {
            Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "simulated config write failure",
            ))
        })
        .expect_err("default config write failure should be returned");

        assert_eq!(error.kind(), io::ErrorKind::WriteZero);
        assert!(
            !config_path.exists(),
            "newly created config should be removed after write failure"
        );
    }

    #[test]
    fn reads_existing_editor_theme_from_config() {
        let workspace = TestWorkspace::new("read-editor-theme");
        let config_path = workspace.path("j3Markdown.toml");
        fs::write(
            &config_path,
            "schema_version = 1\neditor_theme = \"lagoon-dark\"\n",
        )
        .expect("editor theme config should be written");

        let theme = read_editor_theme_setting_at_path(&config_path)
            .expect("editor theme should be readable");

        assert_eq!(theme, "lagoon-dark");
    }

    #[test]
    fn missing_editor_theme_reads_default_theme() {
        let workspace = TestWorkspace::new("read-default-editor-theme");
        let config_path = workspace.path("j3Markdown.toml");
        fs::write(&config_path, "schema_version = 1\n")
            .expect("config without editor theme should be written");

        let theme = read_editor_theme_setting_at_path(&config_path)
            .expect("default editor theme should be readable");

        assert_eq!(theme, DEFAULT_EDITOR_THEME);
    }

    #[test]
    fn missing_config_theme_read_uses_default_without_recreating_config() {
        let workspace = TestWorkspace::new("read-default-editor-theme-without-config");
        let config_path = workspace.path("j3Markdown.toml");

        let theme = read_editor_theme_setting_at_path(&config_path)
            .expect("missing config should fall back to the default editor theme");

        assert_eq!(theme, DEFAULT_EDITOR_THEME);
        assert!(
            !config_path.exists(),
            "theme read should not repeat startup config creation"
        );
    }

    #[test]
    fn saves_editor_theme_without_dropping_existing_config() {
        let workspace = TestWorkspace::new("save-editor-theme");
        let config_path = workspace.path("j3Markdown.toml");
        fs::write(
            &config_path,
            "# j3Markdown executable-local configuration\nschema_version = 1\n",
        )
        .expect("config should be written");

        save_editor_theme_setting_at_path(&config_path, "berry-dark")
            .expect("editor theme should be saved");

        let content = fs::read_to_string(&config_path).expect("config should be readable");
        assert!(content.contains("schema_version = 1"));
        assert!(content.contains("editor_theme = \"berry-dark\""));
    }

    #[test]
    fn reads_existing_ui_language_from_config() {
        let workspace = TestWorkspace::new("read-ui-language");
        let config_path = workspace.path("j3Markdown.toml");
        fs::write(&config_path, "schema_version = 1\nui_language = \"ko\"\n")
            .expect("UI language config should be written");

        let language =
            read_ui_language_setting_at_path(&config_path).expect("UI language should be readable");

        assert_eq!(language, "ko");
    }

    #[test]
    fn missing_ui_language_reads_default_language() {
        let workspace = TestWorkspace::new("read-default-ui-language");
        let config_path = workspace.path("j3Markdown.toml");
        fs::write(&config_path, "schema_version = 1\n")
            .expect("config without UI language should be written");

        let language = read_ui_language_setting_at_path(&config_path)
            .expect("default UI language should be readable");

        assert_eq!(language, DEFAULT_UI_LANGUAGE);
    }

    #[test]
    fn saves_ui_language_without_dropping_existing_config() {
        let workspace = TestWorkspace::new("save-ui-language");
        let config_path = workspace.path("j3Markdown.toml");
        fs::write(
            &config_path,
            "# j3Markdown executable-local configuration\nschema_version = 1\neditor_theme = \"classic\"\n",
        )
        .expect("config should be written");

        save_ui_language_setting_at_path(&config_path, "ko").expect("UI language should be saved");

        let content = fs::read_to_string(&config_path).expect("config should be readable");
        assert!(content.contains("schema_version = 1"));
        assert!(content.contains("editor_theme = \"classic\""));
        assert!(content.contains("ui_language = \"ko\""));
    }

    #[test]
    fn updates_existing_ui_language() {
        let workspace = TestWorkspace::new("update-ui-language");
        let config_path = workspace.path("j3Markdown.toml");
        fs::write(&config_path, "schema_version = 1\nui_language = \"ko\"\n")
            .expect("config should be written");

        save_ui_language_setting_at_path(&config_path, "en")
            .expect("UI language should be updated");

        assert_eq!(
            fs::read_to_string(&config_path).expect("config should be readable"),
            "schema_version = 1\nui_language = \"en\"\n"
        );
    }

    #[test]
    fn updates_existing_editor_theme() {
        let workspace = TestWorkspace::new("update-editor-theme");
        let config_path = workspace.path("j3Markdown.toml");
        fs::write(
            &config_path,
            "schema_version = 1\neditor_theme = \"classic\"\n",
        )
        .expect("config should be written");

        save_editor_theme_setting_at_path(&config_path, "nord-dark")
            .expect("editor theme should be updated");

        assert_eq!(
            fs::read_to_string(&config_path).expect("config should be readable"),
            "schema_version = 1\neditor_theme = \"nord-dark\"\n"
        );
    }

    #[test]
    fn atomic_app_config_write_failure_preserves_existing_config_and_removes_temp_file() {
        let workspace = TestWorkspace::new("atomic-config-write-failure");
        let config_path = workspace.path("j3Markdown.toml");
        let existing_content = "schema_version = 1\neditor_theme = \"classic\"\n";
        fs::write(&config_path, existing_content).expect("existing config should be written");

        let error = write_app_config_atomically_with_replace(
            &config_path,
            "schema_version = 1\neditor_theme = \"lagoon-dark\"\n",
            |_, _| {
                Err(io::Error::new(
                    io::ErrorKind::Other,
                    "simulated app config replace failure",
                ))
            },
        )
        .expect_err("replace failure should be returned");

        assert_eq!(error.kind(), io::ErrorKind::Other);
        assert_eq!(
            fs::read_to_string(&config_path).expect("config should remain readable"),
            existing_content
        );
        let remaining_temp_files = fs::read_dir(&workspace.root)
            .expect("workspace should be readable")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".j3config.")
            })
            .count();
        assert_eq!(
            remaining_temp_files, 0,
            "temporary app config file should be removed after replace failure"
        );
    }

    struct TestWorkspace {
        root: PathBuf,
    }

    impl TestWorkspace {
        fn new(name: &str) -> Self {
            let id = NEXT_WORKSPACE_ID.fetch_add(1, Ordering::Relaxed);
            let root = test_workspace_root().join(format!("{name}-{}-{id}", process::id()));

            fs::create_dir_all(&root).expect("test workspace should be created");

            Self { root }
        }

        fn path(&self, relative_path: impl AsRef<Path>) -> PathBuf {
            self.root.join(relative_path)
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let workspace_root = test_workspace_root();

            if self.root.starts_with(&workspace_root) {
                let _ = fs::remove_dir_all(&self.root);
            }
        }
    }

    fn test_workspace_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test-workspace")
            .join("app-config")
    }
}
