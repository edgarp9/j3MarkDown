use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_TEMP_FILE_ID: AtomicU64 = AtomicU64::new(1);

pub(super) fn write_file_atomically(path: &Path, content: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "markdown save path must include a file name",
        )
    })?;
    let (temp_path, mut temp_file) = create_temp_file(parent)?;

    let write_result = (|| {
        temp_file.write_all(content)?;
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

fn create_temp_file(parent: &Path) -> io::Result<(PathBuf, File)> {
    for _ in 0..32 {
        let temp_path = parent.join(temp_file_name());
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
        "could not create a unique temporary markdown save file",
    ))
}

fn temp_file_name() -> OsString {
    let id = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    OsString::from(format!(".j3save.{}.{}.tmp", process::id(), id))
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

    windows_extended_length_path(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn windows_extended_length_path(path: &Path) -> OsString {
    use std::path::{Component, PathBuf, Prefix};

    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return path.as_os_str().to_os_string();
    };

    match prefix.kind() {
        Prefix::Verbatim(_)
        | Prefix::VerbatimUNC(_, _)
        | Prefix::VerbatimDisk(_)
        | Prefix::DeviceNS(_) => path.as_os_str().to_os_string(),
        Prefix::UNC(server, share) => {
            let mut argument = PathBuf::from(r"\\?\UNC");
            argument.push(server);
            argument.push(share);
            for component in components {
                if matches!(component, Component::RootDir) {
                    continue;
                }
                argument.push(component.as_os_str());
            }
            argument.into_os_string()
        }
        Prefix::Disk(_) if path.is_absolute() => {
            let mut argument = OsString::from(r"\\?\");
            argument.push(path.as_os_str());
            argument
        }
        Prefix::Disk(_) => path.as_os_str().to_os_string(),
    }
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

#[cfg(test)]
mod tests {
    use super::temp_file_name;

    #[test]
    fn temp_file_name_length_does_not_follow_target_file_name_length() {
        let first_temp_file_name = temp_file_name();
        let second_temp_file_name = temp_file_name();

        let first_length = first_temp_file_name.to_string_lossy().len();
        let second_length = second_temp_file_name.to_string_lossy().len();

        assert!(
            first_length < 64,
            "temporary file names should stay short enough for boundary-length save paths"
        );
        assert!(
            second_length <= first_length + 1,
            "temporary file name length should not grow with the markdown target file name"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_argument_restores_verbatim_prefix_for_absolute_paths() {
        assert_eq!(
            windows_path_argument_string(r"C:\long-directory\file.md"),
            r"\\?\C:\long-directory\file.md"
        );
        assert_eq!(
            windows_path_argument_string(r"\\server\share\long-directory\file.md"),
            r"\\?\UNC\server\share\long-directory\file.md"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_argument_preserves_existing_verbatim_paths() {
        assert_eq!(
            windows_path_argument_string(r"\\?\C:\long-directory\file.md"),
            r"\\?\C:\long-directory\file.md"
        );
        assert_eq!(
            windows_path_argument_string(r"\\?\UNC\server\share\long-directory\file.md"),
            r"\\?\UNC\server\share\long-directory\file.md"
        );
    }

    #[cfg(windows)]
    fn windows_path_argument_string(path: &str) -> String {
        let argument = super::windows_path_argument(std::path::Path::new(path));
        let terminator = argument
            .iter()
            .position(|value| *value == 0)
            .expect("Windows path argument should be null-terminated");

        String::from_utf16(&argument[..terminator])
            .expect("Windows path argument should be valid UTF-16")
    }
}
