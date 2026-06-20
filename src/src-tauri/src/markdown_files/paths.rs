use std::{
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
};

pub(super) fn canonicalize_existing_path(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| {
        format!(
            "파일 경로를 확인할 수 없습니다: {} ({error})",
            path.display()
        )
    })
}

pub(super) fn canonicalize_save_queue_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| canonicalize_possible_nonexistent_path(path))
}

fn canonicalize_possible_nonexistent_path(path: &Path) -> PathBuf {
    let path = normalize_path_segments(path);
    let mut ancestor = path.as_path();
    let mut missing_components = Vec::new();

    loop {
        if ancestor.as_os_str().is_empty() {
            return canonicalize_missing_path_from_base(Path::new("."), &missing_components)
                .unwrap_or(path);
        }

        if let Some(path) = canonicalize_missing_path_from_base(ancestor, &missing_components) {
            return path;
        }

        let Some(file_name) = ancestor.file_name() else {
            return path;
        };
        missing_components.push(file_name.to_os_string());

        let Some(parent) = ancestor.parent() else {
            return path;
        };
        ancestor = parent;
    }
}

fn canonicalize_missing_path_from_base(
    base: &Path,
    missing_components: &[OsString],
) -> Option<PathBuf> {
    let mut path = fs::canonicalize(base).ok()?;

    for component in missing_components.iter().rev() {
        path.push(component);
    }

    Some(path)
}

fn normalize_path_segments(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match normalized.components().next_back() {
                Some(Component::Normal(_)) => {
                    normalized.pop();
                }
                Some(Component::Prefix(_)) | Some(Component::RootDir) => {}
                Some(Component::ParentDir) | Some(Component::CurDir) | None => {
                    normalized.push(component.as_os_str());
                }
            },
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

pub(super) fn path_to_string(path: &Path) -> Result<String, String> {
    let path = path
        .as_os_str()
        .to_str()
        .ok_or_else(|| "파일 경로를 읽을 수 없습니다.".to_string())?;

    Ok(simplify_windows_verbatim_path(path))
}

pub(super) fn simplify_windows_verbatim_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }

    path.strip_prefix(r"\\?\").unwrap_or(path).to_owned()
}

pub(super) fn path_title(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "파일 이름을 읽을 수 없습니다.".to_string())
}
