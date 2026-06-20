use std::{env, ffi::OsString, sync::OnceLock};

#[tauri::command]
pub fn get_launch_paths() -> Result<Vec<String>, String> {
    static LAUNCH_PATHS: OnceLock<Result<Vec<String>, String>> = OnceLock::new();

    LAUNCH_PATHS
        .get_or_init(|| launch_paths_from_args(env::args_os()))
        .clone()
}

fn launch_paths_from_args<I>(args: I) -> Result<Vec<String>, String>
where
    I: IntoIterator<Item = OsString>,
{
    let mut paths = Vec::new();
    let mut treat_remaining_as_paths = false;
    let mut skip_next_switch_value = false;

    for argument in args.into_iter().skip(1) {
        if argument.as_os_str().is_empty() {
            continue;
        }

        if !treat_remaining_as_paths {
            if skip_next_switch_value {
                skip_next_switch_value = false;
                continue;
            }

            if argument.to_str() == Some("--") {
                treat_remaining_as_paths = true;
                continue;
            }

            if is_command_switch(&argument) {
                skip_next_switch_value = switch_takes_value(&argument);
                continue;
            }
        }

        paths.push(
            argument
                .into_string()
                .map_err(|_| "시작 파일 경로를 읽을 수 없습니다.".to_string())?,
        );
    }

    Ok(paths)
}

fn is_command_switch(argument: &OsString) -> bool {
    let Some(argument) = argument.to_str() else {
        return false;
    };

    argument.starts_with('-') || argument.starts_with('/')
}

fn switch_takes_value(argument: &OsString) -> bool {
    let Some(argument) = argument.to_str() else {
        return false;
    };
    if argument.contains('=') {
        return false;
    }

    matches!(
        argument,
        "--bin"
            | "--color"
            | "--config"
            | "--features"
            | "--manifest-path"
            | "--package"
            | "--target"
            | "-p"
    )
}

#[cfg(test)]
mod tests {
    use super::launch_paths_from_args;
    use std::ffi::OsString;

    #[test]
    fn skips_the_executable_argument() {
        let paths = launch_paths_from_args(vec![
            OsString::from("j3markdown.exe"),
            OsString::from("notes.md"),
        ])
        .expect("launch paths should parse");

        assert_eq!(paths, vec!["notes.md"]);
    }

    #[test]
    fn skips_command_switches_before_paths() {
        let paths = launch_paths_from_args(vec![
            OsString::from("j3markdown.exe"),
            OsString::from("--trace"),
            OsString::from("/p"),
            OsString::from("notes.md"),
        ])
        .expect("launch paths should parse");

        assert_eq!(paths, vec!["notes.md"]);
    }

    #[test]
    fn skips_known_switch_values_before_paths() {
        let paths = launch_paths_from_args(vec![
            OsString::from("j3markdown.exe"),
            OsString::from("--color"),
            OsString::from("always"),
            OsString::from("--config=dev.json"),
            OsString::from("--target"),
            OsString::from("x86_64-pc-windows-msvc"),
            OsString::from("notes.md"),
        ])
        .expect("launch paths should parse");

        assert_eq!(paths, vec!["notes.md"]);
    }

    #[test]
    fn treats_arguments_after_separator_as_paths() {
        let paths = launch_paths_from_args(vec![
            OsString::from("j3markdown.exe"),
            OsString::from("--"),
            OsString::from("-notes.md"),
        ])
        .expect("launch paths should parse");

        assert_eq!(paths, vec!["-notes.md"]);
    }
}
