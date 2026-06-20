use std::{
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
};

use super::{
    atomic_write::write_file_atomically,
    paths::{canonicalize_existing_path, path_title, path_to_string},
    MarkdownFile, SavedMarkdownFile,
};

const BYTES_PER_MIB: u64 = 1024 * 1024;
pub(super) const MAX_MARKDOWN_FILE_BYTES: u64 = 10 * BYTES_PER_MIB;

pub(super) fn normalize_save_path(mut path: PathBuf) -> Result<PathBuf, String> {
    if path.extension().is_none() {
        path.set_extension("md");
    }

    ensure_markdown_path(&path)?;
    Ok(path)
}

pub(super) fn read_markdown_file(path: &Path) -> Result<MarkdownFile, String> {
    ensure_markdown_open_path(path)?;
    let canonical_path = canonicalize_existing_path(path)?;
    let (content, file_fingerprint) =
        read_markdown_file_content_and_fingerprint_from_markdown_path(&canonical_path)?;

    markdown_file_from_content(&canonical_path, content, file_fingerprint)
}

pub(super) fn read_markdown_file_with_canonical_path(
    path: &Path,
    canonical_path: &Path,
) -> Result<MarkdownFile, String> {
    ensure_markdown_open_path(path)?;
    let (content, file_fingerprint) =
        read_markdown_file_content_and_fingerprint_from_markdown_path(canonical_path)?;

    markdown_file_from_content(canonical_path, content, file_fingerprint)
}

fn ensure_markdown_open_path(path: &Path) -> Result<(), String> {
    if let Err(error) = ensure_markdown_path(path) {
        if path.is_dir() {
            return Err(markdown_directory_error_message());
        }

        return Err(error);
    }

    Ok(())
}

fn read_markdown_file_content_and_fingerprint_from_markdown_path(
    path: &Path,
) -> Result<(String, String), String> {
    ensure_markdown_open_path(path)?;
    let bytes = read_markdown_file_bytes(path)?;
    let file_fingerprint = markdown_file_fingerprint(&bytes);
    let content = markdown_content_from_bytes(path, bytes)?;

    Ok((content, file_fingerprint))
}

fn markdown_file_from_content(
    canonical_path: &Path,
    content: String,
    file_fingerprint: String,
) -> Result<MarkdownFile, String> {
    Ok(MarkdownFile {
        path: path_to_string(canonical_path)?,
        title: path_title(canonical_path)?,
        content,
        file_fingerprint,
    })
}

pub(super) fn ensure_markdown_path(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match extension.as_deref() {
        Some("md") | Some("markdown") => Ok(()),
        _ => Err(".md 또는 .markdown 파일만 열 수 있습니다.".to_string()),
    }
}

pub(super) fn read_existing_markdown_file_fingerprint(
    path: &Path,
) -> Result<Option<String>, String> {
    ensure_markdown_open_path(path)?;

    Ok(read_existing_markdown_file_bytes(path)?
        .as_deref()
        .map(markdown_file_fingerprint))
}

fn read_markdown_file_bytes(path: &Path) -> Result<Vec<u8>, String> {
    read_existing_markdown_file_bytes(path)?.ok_or_else(|| {
        read_markdown_error_message(
            path,
            io::Error::new(io::ErrorKind::NotFound, "file not found"),
        )
    })
}

fn read_existing_markdown_file_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let metadata = match path.metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(read_markdown_error_message(path, error)),
    };
    if metadata.is_dir() {
        return Err(markdown_directory_error_message());
    }
    if !metadata.is_file() {
        return Err(markdown_non_file_error_message(path));
    }

    ensure_markdown_file_size(path, metadata.len())?;

    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(if path.is_dir() {
                markdown_directory_error_message()
            } else {
                read_markdown_error_message(path, error)
            });
        }
    };
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_MARKDOWN_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| read_markdown_error_message(path, error))?;

    if bytes.len() as u64 > MAX_MARKDOWN_FILE_BYTES {
        return Err(markdown_file_too_large_error_message(
            path,
            bytes.len() as u64,
        ));
    }

    Ok(Some(bytes))
}

fn markdown_content_from_bytes(path: &Path, bytes: Vec<u8>) -> Result<String, String> {
    String::from_utf8(bytes).map_err(|error| {
        read_markdown_error_message(path, io::Error::new(io::ErrorKind::InvalidData, error))
    })
}

fn markdown_file_fingerprint(bytes: &[u8]) -> String {
    format!("v1:{}:{:016x}", bytes.len(), fnv1a64(bytes))
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x00000100000001b3;

    bytes.iter().fold(FNV_OFFSET_BASIS, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    })
}

fn markdown_directory_error_message() -> String {
    "폴더는 열 수 없습니다. .md 또는 .markdown 파일을 고르세요.".to_string()
}

fn markdown_non_file_error_message(path: &Path) -> String {
    format!("파일만 열 수 있습니다: {}", path.display())
}

fn ensure_markdown_file_size(path: &Path, size_bytes: u64) -> Result<(), String> {
    if size_bytes > MAX_MARKDOWN_FILE_BYTES {
        return Err(markdown_file_too_large_error_message(path, size_bytes));
    }

    Ok(())
}

fn markdown_file_too_large_error_message(path: &Path, size_bytes: u64) -> String {
    format!(
        "파일이 너무 큽니다: {} (최대 {} MiB, 현재 {} 바이트)",
        path.display(),
        MAX_MARKDOWN_FILE_BYTES / BYTES_PER_MIB,
        size_bytes
    )
}

#[cfg(test)]
pub(super) fn save_markdown_file_as_path(
    path: PathBuf,
    content: &str,
) -> Result<SavedMarkdownFile, String> {
    let path = normalize_save_path(path)?;
    save_markdown_file_to_path(&path, content)
}

#[cfg(test)]
pub(super) fn save_markdown_file_to_path(
    path: &Path,
    content: &str,
) -> Result<SavedMarkdownFile, String> {
    save_markdown_file_to_path_with_optional_canonical_path(path, content, None)
}

pub(super) fn save_markdown_file_to_path_with_optional_canonical_path(
    path: &Path,
    content: &str,
    canonical_path: Option<&Path>,
) -> Result<SavedMarkdownFile, String> {
    ensure_markdown_path(path)?;
    let write_path = canonical_path.unwrap_or(path);
    ensure_markdown_path(write_path)?;
    write_markdown_file(write_path, content)?;
    saved_markdown_file_with_optional_canonical_path(write_path, canonical_path)
}

fn write_markdown_file(path: &Path, content: &str) -> Result<(), String> {
    let bytes = content.as_bytes();
    ensure_markdown_file_size(path, bytes.len() as u64)?;
    write_file_atomically(path, bytes).map_err(|error| write_markdown_error_message(path, error))
}

fn saved_markdown_file_with_optional_canonical_path(
    path: &Path,
    canonical_path: Option<&Path>,
) -> Result<SavedMarkdownFile, String> {
    if let Some(canonical_path) = canonical_path {
        return saved_markdown_file_from_canonical_path(canonical_path);
    }

    let canonical_path = canonicalize_existing_path(path)?;
    saved_markdown_file_from_canonical_path(&canonical_path)
}

fn saved_markdown_file_from_canonical_path(
    canonical_path: &Path,
) -> Result<SavedMarkdownFile, String> {
    let file_fingerprint =
        read_existing_markdown_file_fingerprint(canonical_path)?.ok_or_else(|| {
            format!(
                "저장한 파일을 확인할 수 없습니다: {}",
                canonical_path.display()
            )
        })?;

    Ok(SavedMarkdownFile {
        path: path_to_string(canonical_path)?,
        title: path_title(canonical_path)?,
        file_fingerprint,
    })
}

fn read_markdown_error_message(path: &Path, error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => {
            format!("파일이 없습니다: {} ({error})", path.display())
        }
        io::ErrorKind::PermissionDenied => {
            format!("열 권한이 없습니다: {} ({error})", path.display())
        }
        io::ErrorKind::InvalidData => {
            format!("UTF-8 파일만 열 수 있습니다: {} ({error})", path.display())
        }
        _ => format!("파일을 열 수 없습니다: {} ({error})", path.display()),
    }
}

fn write_markdown_error_message(path: &Path, error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => format!("저장 위치가 없습니다: {} ({error})", path.display()),
        io::ErrorKind::PermissionDenied => {
            format!("저장 권한이 없습니다: {} ({error})", path.display())
        }
        _ => format!("저장할 수 없습니다: {} ({error})", path.display()),
    }
}
