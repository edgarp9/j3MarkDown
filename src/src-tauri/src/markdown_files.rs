use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, OnceLock},
};

const MAX_CONCURRENT_MARKDOWN_FILE_READS: usize = 4;

mod atomic_write;
mod paths;
mod service;

pub mod ipc_contract {
    use serde::Serialize;

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MarkdownFile {
        pub(crate) path: String,
        pub(crate) title: String,
        pub(crate) content: String,
        pub(crate) file_fingerprint: String,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SavedMarkdownFile {
        pub(crate) path: String,
        pub(crate) title: String,
        pub(crate) file_fingerprint: String,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MarkdownFileSaveConflict {
        pub(crate) path: String,
        pub(crate) reason: String,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MarkdownFileSaveResult {
        pub(crate) status: String,
        pub(crate) file: Option<SavedMarkdownFile>,
        pub(crate) conflict: Option<MarkdownFileSaveConflict>,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MarkdownFileOpenResult {
        pub(crate) path: String,
        pub(crate) file: Option<MarkdownFile>,
        pub(crate) error: Option<String>,
    }

    impl MarkdownFileOpenResult {
        pub(crate) fn opened(path: String, file: MarkdownFile) -> Self {
            Self {
                path,
                file: Some(file),
                error: None,
            }
        }

        pub(crate) fn failed(path: String, error: String) -> Self {
            Self {
                path,
                file: None,
                error: Some(error),
            }
        }
    }

    impl MarkdownFileSaveResult {
        pub(crate) fn saved(file: SavedMarkdownFile) -> Self {
            Self {
                status: "saved".into(),
                file: Some(file),
                conflict: None,
            }
        }

        pub(crate) fn conflict(conflict: MarkdownFileSaveConflict) -> Self {
            Self {
                status: "conflict".into(),
                file: None,
                conflict: Some(conflict),
            }
        }
    }
}

pub use ipc_contract::{
    MarkdownFile, MarkdownFileOpenResult, MarkdownFileSaveConflict, MarkdownFileSaveResult,
    SavedMarkdownFile,
};

#[tauri::command]
pub async fn open_markdown_file(window: tauri::Window) -> Result<Option<MarkdownFile>, String> {
    let Some(file_handle) = markdown_dialog(&window).pick_file().await else {
        return Ok(None);
    };
    let path = file_handle.path().to_path_buf();

    let file =
        run_blocking_markdown_file_task(move || service::read_markdown_file(&path).map(Some))
            .await?;

    if let Some(file) = file.as_ref() {
        approve_canonical_markdown_file_path_string(&file.path)?;
    }

    Ok(file)
}

#[tauri::command]
pub async fn open_markdown_file_at_path(path: String) -> Result<MarkdownFile, String> {
    let path = PathBuf::from(path);

    let file = run_blocking_markdown_file_task(move || read_approved_markdown_file(&path)).await?;
    approve_canonical_markdown_file_path_string(&file.path)?;

    Ok(file)
}

#[tauri::command]
pub async fn open_markdown_files_at_paths(
    paths: Vec<String>,
    dropped_paths: Option<bool>,
) -> Result<Vec<MarkdownFileOpenResult>, String> {
    let mut results = Vec::with_capacity(paths.len());
    let open_dropped_paths = dropped_paths.unwrap_or(false);

    for path_batch in paths.chunks(MAX_CONCURRENT_MARKDOWN_FILE_READS) {
        let mut batch_results: Vec<Option<MarkdownFileOpenResult>> =
            (0..path_batch.len()).map(|_| None).collect();
        let mut tasks = Vec::with_capacity(path_batch.len());

        for (path_index, path) in path_batch.iter().enumerate() {
            let requested_path = path.clone();
            let path = PathBuf::from(path.as_str());

            let task = tauri::async_runtime::spawn_blocking(move || {
                read_markdown_file_for_batch_open(&path, open_dropped_paths)
            });
            tasks.push((path_index, requested_path, task));
        }

        for (path_index, requested_path, task) in tasks {
            let result = match task.await {
                Ok(Ok(file)) => match approve_canonical_markdown_file_path_string(&file.path) {
                    Ok(()) => MarkdownFileOpenResult::opened(requested_path, file),
                    Err(error) => MarkdownFileOpenResult::failed(requested_path, error),
                },
                Ok(Err(error)) => MarkdownFileOpenResult::failed(requested_path, error),
                Err(error) => MarkdownFileOpenResult::failed(
                    requested_path,
                    markdown_file_task_error_message(error),
                ),
            };
            batch_results[path_index] = Some(result);
        }

        results.extend(
            batch_results
                .into_iter()
                .map(|result| result.expect("all markdown open results should be populated")),
        );
    }

    Ok(results)
}

pub(crate) fn approve_dropped_markdown_file_paths(paths: &[PathBuf]) -> Vec<String> {
    let mut approved_path_strings = Vec::with_capacity(paths.len());

    for path in paths {
        let _ = approve_dropped_markdown_file_path(path);

        if let Ok(path_string) = self::paths::path_to_string(path) {
            approved_path_strings.push(path_string);
        }
    }

    approved_path_strings
}

#[tauri::command]
pub async fn save_markdown_file(
    path: String,
    content: String,
    expected_file_fingerprint: Option<String>,
    allow_external_overwrite: Option<bool>,
) -> Result<MarkdownFileSaveResult, String> {
    let path = PathBuf::from(path);
    let expected_file_fingerprint = expected_file_fingerprint.filter(|value| !value.is_empty());
    let allow_external_overwrite = allow_external_overwrite.unwrap_or(false);
    // Reserve before approval work can await so request order cannot be inverted.
    let preapproved_canonical_path = approved_canonical_markdown_file_path(&path)?;
    let save_ticket = reserve_markdown_save_ticket_with_optional_canonical_path(
        &path,
        preapproved_canonical_path.as_deref(),
    )?;
    let canonical_path = {
        let path = path.clone();
        run_blocking_markdown_file_task(move || ensure_markdown_file_path_approved(&path)).await?
    };
    let save_path = canonical_path.clone().unwrap_or_else(|| path.clone());

    let save_result = run_blocking_markdown_file_task(move || {
        save_ticket.run(move || {
            save_markdown_file_to_path_with_conflict_check(
                &save_path,
                &content,
                canonical_path.as_deref(),
                expected_file_fingerprint.as_deref(),
                allow_external_overwrite,
            )
        })
    })
    .await?;
    if let Some(saved_file) = save_result.file.as_ref() {
        approve_canonical_markdown_file_path_string(&saved_file.path)?;
    }

    Ok(save_result)
}

async fn run_blocking_markdown_file_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(markdown_file_task_error_message)?
}

fn markdown_file_task_error_message(error: impl std::fmt::Display) -> String {
    format!("파일 작업 실패: {error}")
}

struct MarkdownSaveQueue {
    state: Mutex<MarkdownSaveQueueState>,
    turn_available: Condvar,
}

struct MarkdownSaveQueueState {
    next_ticket: u64,
    serving_ticket: u64,
    cancelled_tickets: HashSet<u64>,
}

struct MarkdownSaveTicket {
    queue_key: String,
    queue: Arc<MarkdownSaveQueue>,
    ticket: u64,
    active: bool,
}

struct MarkdownSaveTurn {
    queue_key: String,
    queue: Arc<MarkdownSaveQueue>,
    ticket: u64,
}

impl MarkdownSaveQueue {
    fn new() -> Self {
        Self {
            state: Mutex::new(MarkdownSaveQueueState {
                next_ticket: 0,
                serving_ticket: 0,
                cancelled_tickets: HashSet::new(),
            }),
            turn_available: Condvar::new(),
        }
    }
}

impl MarkdownSaveTicket {
    fn run<T, F>(mut self, task: F) -> Result<T, String>
    where
        F: FnOnce() -> Result<T, String>,
    {
        let _turn = self.wait_for_turn()?;
        task()
    }

    fn wait_for_turn(&mut self) -> Result<MarkdownSaveTurn, String> {
        let mut state = self
            .queue
            .state
            .lock()
            .map_err(markdown_save_queue_error_message)?;

        while state.serving_ticket != self.ticket {
            state = self
                .queue
                .turn_available
                .wait(state)
                .map_err(markdown_save_queue_error_message)?;
        }

        self.active = false;

        Ok(MarkdownSaveTurn {
            queue_key: self.queue_key.clone(),
            queue: Arc::clone(&self.queue),
            ticket: self.ticket,
        })
    }
}

impl Drop for MarkdownSaveTicket {
    fn drop(&mut self) {
        if self.active {
            cancel_markdown_save_ticket(&self.queue_key, &self.queue, self.ticket);
        }
    }
}

impl Drop for MarkdownSaveTurn {
    fn drop(&mut self) {
        complete_markdown_save_ticket(&self.queue_key, &self.queue, self.ticket);
    }
}

#[cfg(test)]
fn reserve_markdown_save_ticket(path: &Path) -> Result<MarkdownSaveTicket, String> {
    reserve_markdown_save_ticket_with_optional_canonical_path(path, None)
}

fn reserve_markdown_save_ticket_with_optional_canonical_path(
    path: &Path,
    canonical_path: Option<&Path>,
) -> Result<MarkdownSaveTicket, String> {
    let queue_path = canonical_path
        .map(Path::to_path_buf)
        .unwrap_or_else(|| paths::canonicalize_save_queue_path(path));
    let key = markdown_file_path_approval_key(&paths::path_to_string(&queue_path)?);
    let (queue, ticket) = {
        let mut queues = markdown_save_queues()
            .lock()
            .map_err(markdown_save_queue_error_message)?;
        let queue = Arc::clone(
            queues
                .entry(key.clone())
                .or_insert_with(|| Arc::new(MarkdownSaveQueue::new())),
        );
        let ticket = {
            let mut state = queue
                .state
                .lock()
                .map_err(markdown_save_queue_error_message)?;
            let ticket = state.next_ticket;
            state.next_ticket = state
                .next_ticket
                .checked_add(1)
                .ok_or_else(|| "저장 순번 오류입니다.".to_string())?;
            ticket
        };
        (queue, ticket)
    };

    Ok(MarkdownSaveTicket {
        queue_key: key,
        queue,
        ticket,
        active: true,
    })
}

fn markdown_save_queues() -> &'static Mutex<HashMap<String, Arc<MarkdownSaveQueue>>> {
    static MARKDOWN_SAVE_QUEUES: OnceLock<Mutex<HashMap<String, Arc<MarkdownSaveQueue>>>> =
        OnceLock::new();
    MARKDOWN_SAVE_QUEUES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancel_markdown_save_ticket(queue_key: &str, queue: &Arc<MarkdownSaveQueue>, ticket: u64) {
    let Ok(mut queues) = markdown_save_queues().lock() else {
        return;
    };
    let Ok(mut state) = queue.state.lock() else {
        return;
    };

    match ticket.cmp(&state.serving_ticket) {
        std::cmp::Ordering::Less => {}
        std::cmp::Ordering::Equal => advance_markdown_save_queue(&mut state),
        std::cmp::Ordering::Greater => {
            state.cancelled_tickets.insert(ticket);
        }
    }

    remove_idle_markdown_save_queue(&mut queues, queue_key, queue, &state);
    drop(state);
    drop(queues);

    queue.turn_available.notify_all();
}

fn complete_markdown_save_ticket(queue_key: &str, queue: &Arc<MarkdownSaveQueue>, ticket: u64) {
    let Ok(mut queues) = markdown_save_queues().lock() else {
        return;
    };
    let Ok(mut state) = queue.state.lock() else {
        return;
    };

    if ticket == state.serving_ticket {
        advance_markdown_save_queue(&mut state);
    }

    remove_idle_markdown_save_queue(&mut queues, queue_key, queue, &state);
    drop(state);
    drop(queues);

    queue.turn_available.notify_all();
}

fn advance_markdown_save_queue(state: &mut MarkdownSaveQueueState) {
    state.serving_ticket += 1;

    while state.cancelled_tickets.remove(&state.serving_ticket) {
        state.serving_ticket += 1;
    }
}

fn remove_idle_markdown_save_queue(
    queues: &mut HashMap<String, Arc<MarkdownSaveQueue>>,
    queue_key: &str,
    queue: &Arc<MarkdownSaveQueue>,
    state: &MarkdownSaveQueueState,
) {
    let queue_is_idle =
        state.serving_ticket == state.next_ticket && state.cancelled_tickets.is_empty();
    let key_still_points_to_queue = matches!(
        queues.get(queue_key),
        Some(current_queue) if Arc::ptr_eq(current_queue, queue)
    );

    if queue_is_idle && key_still_points_to_queue {
        queues.remove(queue_key);
    }
}

fn markdown_save_queue_error_message(error: impl std::fmt::Display) -> String {
    format!("저장 순서 오류: {error}")
}

fn read_markdown_file_with_optional_canonical_path(
    path: &Path,
    canonical_path: Option<&Path>,
) -> Result<MarkdownFile, String> {
    match canonical_path {
        Some(canonical_path) => {
            service::read_markdown_file_with_canonical_path(path, canonical_path)
        }
        None => service::read_markdown_file(path),
    }
}

fn read_markdown_file_for_batch_open(
    path: &Path,
    dropped_path: bool,
) -> Result<MarkdownFile, String> {
    if dropped_path {
        return read_dropped_markdown_file(path);
    }

    read_approved_markdown_file(path)
}

fn read_approved_markdown_file(path: &Path) -> Result<MarkdownFile, String> {
    let canonical_path = ensure_markdown_file_path_approved(path)?;
    read_markdown_file_with_optional_canonical_path(path, canonical_path.as_deref())
}

fn read_dropped_markdown_file(path: &Path) -> Result<MarkdownFile, String> {
    let canonical_path = ensure_dropped_markdown_file_path_approved(path)?;
    read_markdown_file_with_optional_canonical_path(path, canonical_path.as_deref())
}

fn save_markdown_file_to_path_with_conflict_check(
    path: &Path,
    content: &str,
    canonical_path: Option<&Path>,
    expected_file_fingerprint: Option<&str>,
    allow_external_overwrite: bool,
) -> Result<MarkdownFileSaveResult, String> {
    let write_path = canonical_path.unwrap_or(path);

    if !allow_external_overwrite {
        if let Some(expected_file_fingerprint) = expected_file_fingerprint {
            match service::read_existing_markdown_file_fingerprint(write_path)? {
                Some(current_file_fingerprint)
                    if current_file_fingerprint != expected_file_fingerprint =>
                {
                    return markdown_file_save_conflict(write_path, "modified");
                }
                Some(_) => {}
                None => return markdown_file_save_conflict(write_path, "deleted"),
            }
        }
    }

    service::save_markdown_file_to_path_with_optional_canonical_path(path, content, canonical_path)
        .map(MarkdownFileSaveResult::saved)
}

fn markdown_file_save_conflict(
    path: &Path,
    reason: &str,
) -> Result<MarkdownFileSaveResult, String> {
    Ok(MarkdownFileSaveResult::conflict(MarkdownFileSaveConflict {
        path: paths::path_to_string(path)?,
        reason: reason.into(),
    }))
}

fn ensure_markdown_file_path_approved(path: &Path) -> Result<Option<PathBuf>, String> {
    approve_launch_markdown_paths_once();
    #[cfg(test)]
    delay_markdown_file_path_approval_for_test(path)?;
    service::ensure_markdown_path(path)?;

    if let Some(canonical_path) = approved_canonical_markdown_file_path(path)? {
        return Ok(Some(canonical_path));
    }

    let canonical_path = paths::canonicalize_existing_path(path).ok();
    let requested_keys =
        markdown_file_path_approval_keys_with_canonical_path(path, canonical_path.as_deref())?;

    if markdown_file_path_keys_are_approved(approved_markdown_paths(), &requested_keys)? {
        return Ok(canonical_path);
    }

    Err(unapproved_markdown_path_error_message(path))
}

fn ensure_dropped_markdown_file_path_approved(path: &Path) -> Result<Option<PathBuf>, String> {
    approve_launch_markdown_paths_once();
    let requested_path_keys = markdown_file_path_approval_keys_with_canonical_path(path, None)?;
    let mut dropped_path_approved = consume_markdown_file_path_approval(
        approved_dropped_markdown_paths(),
        &requested_path_keys,
    )?;

    service::ensure_markdown_path(path)?;

    let canonical_path = paths::canonicalize_existing_path(path).ok();
    let requested_keys =
        markdown_file_path_approval_keys_with_canonical_path(path, canonical_path.as_deref())?;

    if !dropped_path_approved {
        dropped_path_approved = consume_markdown_file_path_approval(
            approved_dropped_markdown_paths(),
            &requested_keys,
        )?;
    }

    if markdown_file_path_keys_are_approved(approved_markdown_paths(), &requested_keys)?
        || dropped_path_approved
    {
        return Ok(canonical_path);
    }

    Err(unapproved_markdown_path_error_message(path))
}

fn approve_launch_markdown_paths_once() {
    static LAUNCH_PATHS_APPROVED: OnceLock<()> = OnceLock::new();

    LAUNCH_PATHS_APPROVED.get_or_init(|| {
        let Ok(paths) = crate::launch_args::get_launch_paths() else {
            return;
        };

        for path in paths {
            let path = PathBuf::from(path);
            let _ = approve_existing_markdown_file_path(&path);
        }
    });
}

fn approve_existing_markdown_file_path(path: &Path) -> Result<PathBuf, String> {
    service::ensure_markdown_path(path)?;
    let canonical_path = paths::canonicalize_existing_path(path)?;
    approve_markdown_file_path_with_canonical_path(path, Some(&canonical_path))?;
    Ok(canonical_path)
}

fn approve_dropped_markdown_file_path(path: &Path) -> Result<(), String> {
    let approval_keys = markdown_file_path_approval_keys_with_canonical_path(path, None)?;
    let mut approved_paths = approved_dropped_markdown_paths()
        .lock()
        .map_err(|error| format!("파일 승인 오류: {error}"))?;

    for key in approval_keys {
        *approved_paths.entry(key).or_insert(0) += 1;
    }

    Ok(())
}

fn approve_canonical_markdown_file_path_string(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    approve_markdown_file_path_with_canonical_path(path, Some(path))
}

#[cfg(test)]
fn approve_markdown_file_path(path: &Path) -> Result<(), String> {
    let canonical_path = paths::canonicalize_existing_path(path).ok();
    approve_markdown_file_path_with_canonical_path(path, canonical_path.as_deref())
}

fn approve_markdown_file_path_with_canonical_path(
    path: &Path,
    canonical_path: Option<&Path>,
) -> Result<(), String> {
    service::ensure_markdown_path(path)?;
    let approval_keys = markdown_file_path_approval_keys_with_canonical_path(path, canonical_path)?;
    let mut approved_paths = approved_markdown_paths()
        .lock()
        .map_err(|error| format!("파일 승인 오류: {error}"))?;

    for key in &approval_keys {
        approved_paths.insert(key.clone());
    }
    drop(approved_paths);

    if let Some(canonical_path) = canonical_path {
        let mut approved_canonical_paths = approved_canonical_markdown_paths()
            .lock()
            .map_err(|error| format!("파일 승인 오류: {error}"))?;

        for key in approval_keys {
            approved_canonical_paths.insert(key, canonical_path.to_path_buf());
        }
    }

    Ok(())
}

fn markdown_file_path_approval_keys_with_canonical_path(
    path: &Path,
    canonical_path: Option<&Path>,
) -> Result<Vec<String>, String> {
    let mut keys = Vec::with_capacity(2);
    keys.push(markdown_file_path_approval_key_for_path(path)?);

    if let Some(canonical_path) = canonical_path {
        let canonical_key = markdown_file_path_approval_key_for_path(canonical_path)?;

        if !keys.contains(&canonical_key) {
            keys.push(canonical_key);
        }
    }

    Ok(keys)
}

fn approved_markdown_paths() -> &'static Mutex<HashSet<String>> {
    static APPROVED_MARKDOWN_PATHS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    APPROVED_MARKDOWN_PATHS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn approved_canonical_markdown_paths() -> &'static Mutex<HashMap<String, PathBuf>> {
    static APPROVED_CANONICAL_MARKDOWN_PATHS: OnceLock<Mutex<HashMap<String, PathBuf>>> =
        OnceLock::new();
    APPROVED_CANONICAL_MARKDOWN_PATHS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn approved_dropped_markdown_paths() -> &'static Mutex<HashMap<String, usize>> {
    static APPROVED_DROPPED_MARKDOWN_PATHS: OnceLock<Mutex<HashMap<String, usize>>> =
        OnceLock::new();
    APPROVED_DROPPED_MARKDOWN_PATHS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn approved_canonical_markdown_file_path(path: &Path) -> Result<Option<PathBuf>, String> {
    let requested_key = markdown_file_path_approval_key_for_path(path)?;
    let approved_paths = approved_canonical_markdown_paths()
        .lock()
        .map_err(|error| format!("파일 승인 오류: {error}"))?;

    Ok(approved_paths.get(&requested_key).cloned())
}

fn markdown_file_path_approval_key_for_path(path: &Path) -> Result<String, String> {
    Ok(markdown_file_path_approval_key(&paths::path_to_string(
        path,
    )?))
}

fn markdown_file_path_keys_are_approved(
    approved_paths: &Mutex<HashSet<String>>,
    requested_keys: &[String],
) -> Result<bool, String> {
    let approved_paths = approved_paths
        .lock()
        .map_err(|error| format!("파일 승인 오류: {error}"))?;

    Ok(requested_keys
        .iter()
        .any(|key| approved_paths.contains(key)))
}

fn consume_markdown_file_path_approval(
    approved_paths: &Mutex<HashMap<String, usize>>,
    requested_keys: &[String],
) -> Result<bool, String> {
    let mut approved_paths = approved_paths
        .lock()
        .map_err(|error| format!("파일 승인 오류: {error}"))?;

    let Some(approved_key) = requested_keys
        .iter()
        .find(|key| approved_paths.get(*key).is_some_and(|count| *count > 0))
        .cloned()
    else {
        return Ok(false);
    };

    if let Some(count) = approved_paths.get_mut(&approved_key) {
        *count -= 1;
        if *count == 0 {
            approved_paths.remove(&approved_key);
        }
    }

    Ok(true)
}

fn markdown_file_path_approval_key(path: &str) -> String {
    #[cfg(windows)]
    {
        path.to_ascii_lowercase()
    }

    #[cfg(not(windows))]
    {
        path.to_owned()
    }
}

fn unapproved_markdown_path_error_message(path: &Path) -> String {
    format!(
        "먼저 열기 또는 새 이름 저장으로 파일을 고르세요: {}",
        path.display()
    )
}

#[cfg(test)]
struct TestMarkdownApprovalDelay {
    duration: std::time::Duration,
    started: Arc<(Mutex<bool>, Condvar)>,
}

#[cfg(test)]
fn delay_markdown_file_path_approval_for_test(path: &Path) -> Result<(), String> {
    let key = markdown_file_path_approval_key_for_path(path)?;
    let delay = {
        let mut delays = test_markdown_approval_delays()
            .lock()
            .map_err(|error| format!("파일 승인 테스트 지연 오류: {error}"))?;
        delays.remove(&key)
    };

    if let Some(delay) = delay {
        let (started, started_available) = &*delay.started;
        let mut started = started
            .lock()
            .map_err(|error| format!("파일 승인 테스트 지연 오류: {error}"))?;
        *started = true;
        started_available.notify_all();
        drop(started);

        std::thread::sleep(delay.duration);
    }

    Ok(())
}

#[cfg(test)]
fn test_markdown_approval_delays() -> &'static Mutex<HashMap<String, TestMarkdownApprovalDelay>> {
    static TEST_MARKDOWN_APPROVAL_DELAYS: OnceLock<
        Mutex<HashMap<String, TestMarkdownApprovalDelay>>,
    > = OnceLock::new();
    TEST_MARKDOWN_APPROVAL_DELAYS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub async fn save_markdown_file_as(
    window: tauri::Window,
    suggested_path: Option<String>,
    content: String,
) -> Result<Option<MarkdownFileSaveResult>, String> {
    let path = pick_markdown_save_path(&window, suggested_path).await;

    let Some(path) = path else {
        return Ok(None);
    };
    let saved_file =
        run_blocking_markdown_file_task(move || save_markdown_file_as_selected_path(path, content))
            .await?;

    if let Some(saved_file) = saved_file
        .as_ref()
        .and_then(|save_result| save_result.file.as_ref())
    {
        approve_canonical_markdown_file_path_string(&saved_file.path)?;
    }

    Ok(saved_file)
}

#[tauri::command]
pub async fn select_markdown_save_path(
    window: tauri::Window,
    suggested_path: Option<String>,
) -> Result<Option<String>, String> {
    let Some(path) = pick_markdown_save_path(&window, suggested_path).await else {
        return Ok(None);
    };

    normalize_and_approve_markdown_save_path(path).map(Some)
}

async fn pick_markdown_save_path(
    window: &tauri::Window,
    suggested_path: Option<String>,
) -> Option<PathBuf> {
    let mut dialog = markdown_dialog(window);

    if let Some(suggested_path) = suggested_path {
        let suggested_path = PathBuf::from(suggested_path);

        if let Some(parent) = suggested_path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            dialog = dialog.set_directory(parent);
        }

        if let Some(file_name) = suggested_path.file_name().and_then(|value| value.to_str()) {
            dialog = dialog.set_file_name(file_name);
        }
    } else {
        dialog = dialog.set_file_name("Untitled.md");
    }

    dialog
        .save_file()
        .await
        .map(|file_handle| file_handle.path().to_path_buf())
}

fn normalize_and_approve_markdown_save_path(path: PathBuf) -> Result<String, String> {
    let path = service::normalize_save_path(path)?;
    let canonical_path = paths::canonicalize_existing_path(&path).ok();
    approve_markdown_file_path_with_canonical_path(&path, canonical_path.as_deref())?;
    paths::path_to_string(&path)
}

fn save_markdown_file_as_selected_path(
    path: PathBuf,
    content: String,
) -> Result<Option<MarkdownFileSaveResult>, String> {
    let path = service::normalize_save_path(path)?;
    let canonical_path = paths::canonicalize_existing_path(&path).ok();
    let save_ticket = reserve_markdown_save_ticket_with_optional_canonical_path(
        &path,
        canonical_path.as_deref(),
    )?;
    let save_path = canonical_path.clone().unwrap_or_else(|| path.clone());

    save_ticket.run(move || {
        save_markdown_file_to_path_with_conflict_check(
            &save_path,
            &content,
            canonical_path.as_deref(),
            None,
            true,
        )
        .map(Some)
    })
}

fn markdown_dialog(window: &tauri::Window) -> rfd::AsyncFileDialog {
    rfd::AsyncFileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .set_parent(window)
}

#[cfg(test)]
mod tests {
    use super::{
        open_markdown_file_at_path, open_markdown_files_at_paths,
        paths::{path_to_string, simplify_windows_verbatim_path},
        save_markdown_file,
        service::{
            ensure_markdown_path, normalize_save_path, read_markdown_file,
            save_markdown_file_as_path, MAX_MARKDOWN_FILE_BYTES,
        },
        MarkdownFile, MarkdownFileOpenResult, MarkdownFileSaveConflict, MarkdownFileSaveResult,
        SavedMarkdownFile,
    };
    use serde_json::json;
    use std::{
        fs,
        path::{Path, PathBuf},
        process,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Condvar, Mutex,
        },
        thread,
        time::Duration,
    };

    static NEXT_WORKSPACE_ID: AtomicUsize = AtomicUsize::new(1);

    #[cfg(test)]
    fn approve_markdown_path_for_test(path: &Path) -> Result<(), String> {
        super::approve_markdown_file_path(path)
    }

    #[cfg(test)]
    fn approve_dropped_markdown_path_for_test(path: &Path) {
        let _ = super::approve_dropped_markdown_file_paths(&[path.to_path_buf()]);
    }

    #[test]
    fn accepts_supported_markdown_extensions_case_insensitively() {
        assert!(ensure_markdown_path(PathBuf::from("note.md").as_path()).is_ok());
        assert!(ensure_markdown_path(PathBuf::from("note.MARKDOWN").as_path()).is_ok());
    }

    #[test]
    fn rejects_unsupported_extensions() {
        assert!(ensure_markdown_path(PathBuf::from("note.txt").as_path()).is_err());
        assert!(ensure_markdown_path(PathBuf::from("note").as_path()).is_err());
    }

    #[test]
    fn rejects_directories_with_folder_drop_message() {
        let workspace = TestWorkspace::new("reject-directory-open");
        let directory_without_extension = workspace.path("folder-drop");
        let markdown_directory = workspace.path("folder-drop.md");
        fs::create_dir(&directory_without_extension).expect("directory fixture should be created");
        fs::create_dir(&markdown_directory).expect("markdown directory fixture should be created");

        let unsupported_directory_error = read_markdown_file(&directory_without_extension)
            .expect_err("directory without an extension should be rejected as a folder");
        assert!(unsupported_directory_error.contains("폴더는 열 수 없습니다"));

        let markdown_directory_error = read_markdown_file(&markdown_directory)
            .expect_err("markdown-looking directory should be rejected as a folder");
        assert!(markdown_directory_error.contains("폴더는 열 수 없습니다"));
    }

    #[test]
    fn save_path_without_extension_defaults_to_md() {
        let normalized = normalize_save_path(PathBuf::from("note")).expect("path should normalize");
        assert_eq!(normalized, PathBuf::from("note.md"));
    }

    #[test]
    fn opens_md_markdown_and_utf8_korean_files() {
        let workspace = TestWorkspace::new("open-supported-files");
        let md_path = workspace.path("plain.md");
        let markdown_path = workspace.path("long-form.markdown");
        let korean_dir = workspace.path("Windows path with spaces");
        fs::create_dir_all(&korean_dir).expect("korean test directory should be created");
        let korean_path = korean_dir.join("한글 문서.md");

        fs::write(&md_path, "# Plain\n\ncontent").expect("md fixture should be written");
        fs::write(&markdown_path, "# Long\n\ncontent").expect("markdown fixture should be written");
        fs::write(&korean_path, "# 제목\n\n한글 본문")
            .expect("korean markdown fixture should be written");

        let md_file = read_markdown_file(&md_path).expect("md file should open");
        assert_eq!(md_file.title, "plain.md");
        assert_eq!(md_file.content, "# Plain\n\ncontent");

        let markdown_file = read_markdown_file(&markdown_path).expect("markdown file should open");
        assert_eq!(markdown_file.title, "long-form.markdown");
        assert_eq!(markdown_file.content, "# Long\n\ncontent");

        approve_markdown_path_for_test(&korean_path)
            .expect("korean markdown path should be approved for command open");
        let korean_file = block_on_command(open_markdown_file_at_path(path_string(&korean_path)))
            .expect("utf-8 korean markdown file should open through the command path");
        assert_eq!(korean_file.path, path_string(&korean_path));
        assert_eq!(korean_file.title, "한글 문서.md");
        assert_eq!(korean_file.content, "# 제목\n\n한글 본문");
    }

    #[test]
    fn open_returns_canonical_path_for_equivalent_input_paths() {
        let workspace = TestWorkspace::new("canonical-open-path");
        let directory = workspace.path("Windows path with spaces");
        fs::create_dir_all(&directory).expect("canonical test directory should be created");
        let path = directory.join("Long File Name.md");
        fs::write(&path, "# Canonical").expect("canonical fixture should be written");
        approve_markdown_path_for_test(&path)
            .expect("canonical fixture should be approved for command open");

        let equivalent_path = directory
            .join(".")
            .join("..")
            .join("Windows path with spaces")
            .join("Long File Name.md");
        let file = block_on_command(open_markdown_file_at_path(path_string(&equivalent_path)))
            .expect("equivalent markdown path should open");
        let canonical_path = fs::canonicalize(&path).expect("fixture path should canonicalize");

        assert_eq!(
            file.path,
            path_to_string(&canonical_path).expect("path should be utf-8")
        );
        assert_eq!(file.title, "Long File Name.md");
    }

    #[test]
    fn batch_open_rejects_unapproved_markdown_paths_without_approving_for_save() {
        let workspace = TestWorkspace::new("batch-open-rejects-unapproved-path");
        let path = workspace.path("unapproved-batch.md");
        fs::write(&path, "# Secret\n\ncontent")
            .expect("unapproved batch fixture should be written");

        let results =
            block_on_command(open_markdown_files_at_paths(vec![path_string(&path)], None))
                .expect("batch open should return per-path results");

        assert_eq!(results.len(), 1);
        let result = &results[0];
        assert_eq!(result.path, path_string(&path));
        assert!(result.file.is_none());
        assert!(result
            .error
            .as_ref()
            .expect("unapproved batch path should return an error")
            .contains("먼저 열기 또는 새 이름 저장"));

        let save_error = block_on_command(save_markdown_file(
            path_string(&path),
            "must not overwrite unapproved path".into(),
            None,
            None,
        ))
        .expect_err("unapproved batch path must not be approved for saving");
        assert!(save_error.contains("먼저 열기 또는 새 이름 저장"));
        assert_eq!(
            fs::read_to_string(&path).expect("saved batch fixture should be readable"),
            "# Secret\n\ncontent"
        );
    }

    #[test]
    fn batch_open_rejects_spoofed_dropped_paths_without_approving_for_save() {
        let workspace = TestWorkspace::new("batch-open-spoofed-dropped-path");
        let path = workspace.path("spoofed-dropped-batch.md");
        fs::write(&path, "# Dropped\n\ncontent").expect("dropped batch fixture should be written");

        let results = block_on_command(open_markdown_files_at_paths(
            vec![path_string(&path)],
            Some(true),
        ))
        .expect("dropped batch open should return per-path results");

        assert_eq!(results.len(), 1);
        let result = &results[0];
        assert_eq!(result.path, path_string(&path));
        assert!(result.file.is_none());
        assert!(result
            .error
            .as_ref()
            .expect("spoofed dropped path should return an error")
            .contains("먼저 열기 또는 새 이름 저장"));

        let save_error = block_on_command(save_markdown_file(
            path_string(&path),
            "must not overwrite spoofed dropped path without save approval".into(),
            None,
            None,
        ))
        .expect_err("spoofed dropped batch path must not be approved for saving");
        assert!(save_error.contains("먼저 열기 또는 새 이름 저장"));
        assert_eq!(
            fs::read_to_string(&path).expect("dropped batch fixture should be readable"),
            "# Dropped\n\ncontent"
        );
    }

    #[test]
    fn batch_open_reads_recorded_dropped_paths_without_relaxing_normal_batch_open() {
        let workspace = TestWorkspace::new("batch-open-recorded-dropped-path");
        let path = workspace.path("recorded-dropped-batch.md");
        fs::write(&path, "# Dropped\n\ncontent").expect("dropped batch fixture should be written");
        approve_dropped_markdown_path_for_test(&path);

        let normal_results =
            block_on_command(open_markdown_files_at_paths(vec![path_string(&path)], None))
                .expect("normal batch open should return per-path results");

        assert_eq!(normal_results.len(), 1);
        assert!(normal_results[0].file.is_none());
        assert!(normal_results[0]
            .error
            .as_ref()
            .expect("normal batch path should return an error")
            .contains("먼저 열기 또는 새 이름 저장"));

        let save_error = block_on_command(save_markdown_file(
            path_string(&path),
            "must not overwrite recorded dropped path before open".into(),
            None,
            None,
        ))
        .expect_err("recorded dropped path must not be approved for saving before it is opened");
        assert!(save_error.contains("먼저 열기 또는 새 이름 저장"));
        assert_eq!(
            fs::read_to_string(&path).expect("dropped batch fixture should be readable"),
            "# Dropped\n\ncontent"
        );

        let dropped_results = block_on_command(open_markdown_files_at_paths(
            vec![path_string(&path)],
            Some(true),
        ))
        .expect("dropped batch open should return per-path results");

        assert_eq!(dropped_results.len(), 1);
        let result = &dropped_results[0];
        assert_eq!(result.path, path_string(&path));
        assert!(result.error.is_none());

        let file = result
            .file
            .as_ref()
            .expect("recorded dropped markdown path should open");
        assert_eq!(file.path, path_string(&path));
        assert_eq!(file.title, "recorded-dropped-batch.md");
        assert_eq!(file.content, "# Dropped\n\ncontent");

        let saved_file = block_on_command(save_markdown_file(
            path_string(&path),
            "# Saved\n\nthrough dropped open".into(),
            None,
            None,
        ))
        .expect("opened dropped path should be approved for saving")
        .file
        .expect("opened dropped path save should write a file");
        assert_eq!(saved_file.path, path_string(&path));
        assert_eq!(
            fs::read_to_string(&path).expect("saved dropped fixture should be readable"),
            "# Saved\n\nthrough dropped open"
        );
    }

    #[test]
    fn duplicate_dropped_path_approvals_are_consumed_per_open_request() {
        let workspace = TestWorkspace::new("duplicate-dropped-path-approvals");
        let path = workspace.path("duplicate-dropped-batch.md");
        fs::write(&path, "# Dropped\n\ncontent").expect("dropped batch fixture should be written");

        let emitted_paths =
            super::approve_dropped_markdown_file_paths(&[path.clone(), path.clone()]);

        assert_eq!(emitted_paths, vec![path_string(&path), path_string(&path)]);

        let first_file = super::read_markdown_file_for_batch_open(&path, true)
            .expect("first dropped path approval should open the file");
        let second_file = super::read_markdown_file_for_batch_open(&path, true)
            .expect("second dropped path approval should open the same file");

        assert_eq!(first_file.content, "# Dropped\n\ncontent");
        assert_eq!(second_file.content, "# Dropped\n\ncontent");

        let third_error = super::read_markdown_file_for_batch_open(&path, true)
            .expect_err("duplicate approvals should be consumed exactly once per open");
        assert!(third_error.contains("먼저 열기 또는 새 이름 저장"));
    }

    #[test]
    fn batch_open_consumes_recorded_dropped_path_after_failed_read() {
        let workspace = TestWorkspace::new("batch-open-consumes-failed-dropped-path");
        let path = workspace.path("consumed-failed-dropped-batch.md");
        let file = fs::File::create(&path).expect("oversized dropped fixture should be created");
        file.set_len(MAX_MARKDOWN_FILE_BYTES + 1)
            .expect("oversized dropped fixture length should be set");
        approve_dropped_markdown_path_for_test(&path);

        let first_results = block_on_command(open_markdown_files_at_paths(
            vec![path_string(&path)],
            Some(true),
        ))
        .expect("dropped batch open should return per-path results");

        assert_eq!(first_results.len(), 1);
        let first_result = &first_results[0];
        assert_eq!(first_result.path, path_string(&path));
        assert!(first_result.file.is_none());
        assert!(first_result
            .error
            .as_ref()
            .expect("oversized dropped path should return an error")
            .contains("파일이 너무 큽니다"));

        fs::write(&path, "# Replaced\n\ncontent")
            .expect("dropped fixture replacement should be written");

        let second_results = block_on_command(open_markdown_files_at_paths(
            vec![path_string(&path)],
            Some(true),
        ))
        .expect("second dropped batch open should return per-path results");

        assert_eq!(second_results.len(), 1);
        let second_result = &second_results[0];
        assert_eq!(second_result.path, path_string(&path));
        assert!(second_result.file.is_none());
        assert!(second_result
            .error
            .as_ref()
            .expect("consumed dropped path should return an approval error")
            .contains("먼저 열기 또는 새 이름 저장"));
    }

    #[test]
    fn batch_open_reads_recorded_dropped_equivalent_path_after_canonicalizing_in_open_task() {
        let workspace = TestWorkspace::new("batch-open-recorded-dropped-equivalent-path");
        let directory = workspace.path("Windows path with spaces");
        fs::create_dir_all(&directory).expect("dropped equivalent directory should be created");
        let path = directory.join("recorded-dropped-equivalent.md");
        fs::write(&path, "# Dropped\n\ncontent")
            .expect("dropped equivalent fixture should be written");
        let dropped_path = directory.join(".").join("recorded-dropped-equivalent.md");

        let emitted_paths = super::approve_dropped_markdown_file_paths(&[dropped_path.clone()]);

        assert_eq!(emitted_paths, vec![path_string(&dropped_path)]);

        let dropped_results =
            block_on_command(open_markdown_files_at_paths(emitted_paths, Some(true)))
                .expect("dropped equivalent batch open should return per-path results");

        assert_eq!(dropped_results.len(), 1);
        let result = &dropped_results[0];
        assert_eq!(result.path, path_string(&dropped_path));
        assert!(result.error.is_none());

        let file = result
            .file
            .as_ref()
            .expect("recorded dropped equivalent markdown path should open");
        let canonical_path = fs::canonicalize(&path).expect("fixture path should canonicalize");
        assert_eq!(
            file.path,
            path_to_string(&canonical_path).expect("path should be utf-8")
        );
        assert_eq!(file.title, "recorded-dropped-equivalent.md");
        assert_eq!(file.content, "# Dropped\n\ncontent");
    }

    #[test]
    fn batch_open_rejects_unsupported_extensions_without_approving_for_save() {
        let workspace = TestWorkspace::new("batch-open-rejects-unsupported-extension");
        let path = workspace.path("unsupported.txt");
        fs::write(&path, "before").expect("unsupported batch fixture should be written");

        let results =
            block_on_command(open_markdown_files_at_paths(vec![path_string(&path)], None))
                .expect("batch open should return per-path results");

        assert_eq!(results.len(), 1);
        let result = &results[0];
        assert_eq!(result.path, path_string(&path));
        assert!(result.file.is_none());
        assert!(result
            .error
            .as_ref()
            .expect("unsupported batch path should return an error")
            .contains(".md 또는 .markdown 파일만 열 수 있습니다"));

        let save_error = block_on_command(save_markdown_file(
            path_string(&path),
            "must not overwrite unsupported path".into(),
            None,
            None,
        ))
        .expect_err("unsupported batch path must not be approved for saving");
        assert!(save_error.contains(".md 또는 .markdown 파일만 열 수 있습니다"));
        assert_eq!(
            fs::read_to_string(&path).expect("unsupported batch fixture should be readable"),
            "before"
        );
    }

    #[test]
    fn batch_open_reports_read_failures_for_approved_paths() {
        let workspace = TestWorkspace::new("batch-open-approved-read-failure");
        let path = workspace.path("oversized-batch.md");
        let file = fs::File::create(&path).expect("oversized batch fixture should be created");
        file.set_len(MAX_MARKDOWN_FILE_BYTES + 1)
            .expect("oversized batch fixture length should be set");
        approve_markdown_path_for_test(&path)
            .expect("oversized batch fixture should be approved before command open");

        let results =
            block_on_command(open_markdown_files_at_paths(vec![path_string(&path)], None))
                .expect("batch open should return per-path results");

        assert_eq!(results.len(), 1);
        let result = &results[0];
        assert_eq!(result.path, path_string(&path));
        assert!(result.file.is_none());
        assert!(result
            .error
            .as_ref()
            .expect("oversized batch path should return an error")
            .contains("파일이 너무 큽니다"));
        assert_eq!(
            fs::metadata(&path)
                .expect("oversized batch fixture metadata should be readable")
                .len(),
            MAX_MARKDOWN_FILE_BYTES + 1
        );
    }

    #[test]
    fn batch_open_reads_approved_markdown_paths() {
        let workspace = TestWorkspace::new("batch-open-approved-path");
        let path = workspace.path("approved-batch.md");
        fs::write(&path, "# Approved\n\ncontent")
            .expect("approved batch fixture should be written");
        approve_markdown_path_for_test(&path)
            .expect("batch open fixture should be approved before command open");

        let results =
            block_on_command(open_markdown_files_at_paths(vec![path_string(&path)], None))
                .expect("batch open should return per-path results");

        assert_eq!(results.len(), 1);
        let result = &results[0];
        assert_eq!(result.path, path_string(&path));
        assert!(result.error.is_none());

        let file = result
            .file
            .as_ref()
            .expect("approved markdown path should open");
        assert_eq!(file.path, path_string(&path));
        assert_eq!(file.title, "approved-batch.md");
        assert_eq!(file.content, "# Approved\n\ncontent");
    }

    #[test]
    fn approve_existing_markdown_path_returns_canonical_path_for_reuse() {
        let workspace = TestWorkspace::new("approve-existing-returns-canonical-path");
        let directory = workspace.path("Windows path with spaces");
        fs::create_dir_all(&directory).expect("canonical test directory should be created");
        let path = directory.join("Dropped File.md");
        fs::write(&path, "# Dropped\n\ncontent").expect("dropped fixture should be written");

        let equivalent_path = directory
            .join(".")
            .join("..")
            .join("Windows path with spaces")
            .join("Dropped File.md");
        let canonical_path = super::approve_existing_markdown_file_path(&equivalent_path)
            .expect("existing markdown path should be approved");
        let expected_canonical_path =
            fs::canonicalize(&path).expect("fixture path should canonicalize");

        assert_eq!(canonical_path, expected_canonical_path);

        let file = super::read_markdown_file_with_optional_canonical_path(
            &equivalent_path,
            Some(&canonical_path),
        )
        .expect("markdown file should open with the reused canonical path");
        assert_eq!(
            file.path,
            path_to_string(&expected_canonical_path).expect("path should be utf-8")
        );
        assert_eq!(file.title, "Dropped File.md");
    }

    #[test]
    fn reused_canonical_path_reads_from_canonical_path() {
        let workspace = TestWorkspace::new("reuse-canonical-read-target");
        let requested_path = workspace.path("requested.md");
        let canonical_source_path = workspace.path("canonical-source.md");
        fs::write(&requested_path, "# Requested").expect("requested fixture should be written");
        fs::write(&canonical_source_path, "# Canonical")
            .expect("canonical fixture should be written");
        let canonical_path = fs::canonicalize(&canonical_source_path)
            .expect("canonical fixture should canonicalize");

        let file = super::read_markdown_file_with_optional_canonical_path(
            &requested_path,
            Some(&canonical_path),
        )
        .expect("markdown file should open from the reused canonical path");

        assert_eq!(file.content, "# Canonical");
        assert_eq!(
            file.path,
            path_to_string(&canonical_path).expect("path should be utf-8")
        );
        assert_eq!(file.title, "canonical-source.md");
    }

    #[test]
    fn strips_windows_verbatim_prefixes_from_returned_paths() {
        assert_eq!(
            simplify_windows_verbatim_path(r"\\?\C:\Users\Demo\File.md"),
            r"C:\Users\Demo\File.md"
        );
        assert_eq!(
            simplify_windows_verbatim_path(r"\\?\UNC\Server\Share\File.md"),
            r"\\Server\Share\File.md"
        );
    }

    #[test]
    fn markdown_file_ipc_response_contract_has_stable_fields() {
        let file = MarkdownFile {
            path: r"C:\Users\Demo\note.md".into(),
            title: "note.md".into(),
            content: "# Note".into(),
            file_fingerprint: "v1:6:demo".into(),
        };
        assert_eq!(
            serde_json::to_value(&file).expect("markdown file should serialize"),
            json!({
                "path": r"C:\Users\Demo\note.md",
                "title": "note.md",
                "content": "# Note",
                "fileFingerprint": "v1:6:demo",
            })
        );

        let saved_file = SavedMarkdownFile {
            path: r"C:\Users\Demo\note.md".into(),
            title: "note.md".into(),
            file_fingerprint: "v1:6:saved".into(),
        };
        assert_eq!(
            serde_json::to_value(&saved_file).expect("saved markdown file should serialize"),
            json!({
                "path": r"C:\Users\Demo\note.md",
                "title": "note.md",
                "fileFingerprint": "v1:6:saved",
            })
        );

        let save_result = MarkdownFileSaveResult::saved(SavedMarkdownFile {
            path: r"C:\Users\Demo\note.md".into(),
            title: "note.md".into(),
            file_fingerprint: "v1:6:saved".into(),
        });
        assert_eq!(
            serde_json::to_value(&save_result).expect("save result should serialize"),
            json!({
                "status": "saved",
                "file": {
                    "path": r"C:\Users\Demo\note.md",
                    "title": "note.md",
                    "fileFingerprint": "v1:6:saved",
                },
                "conflict": null,
            })
        );

        let conflict_result = MarkdownFileSaveResult::conflict(MarkdownFileSaveConflict {
            path: r"C:\Users\Demo\note.md".into(),
            reason: "modified".into(),
        });
        assert_eq!(
            serde_json::to_value(&conflict_result).expect("conflict result should serialize"),
            json!({
                "status": "conflict",
                "file": null,
                "conflict": {
                    "path": r"C:\Users\Demo\note.md",
                    "reason": "modified",
                },
            })
        );

        let opened_result = MarkdownFileOpenResult::opened(r"C:\Users\Demo\note.md".into(), file);
        assert_eq!(
            serde_json::to_value(&opened_result).expect("opened result should serialize"),
            json!({
                "path": r"C:\Users\Demo\note.md",
                "file": {
                    "path": r"C:\Users\Demo\note.md",
                    "title": "note.md",
                    "content": "# Note",
                    "fileFingerprint": "v1:6:demo",
                },
                "error": null,
            })
        );
        assert!(opened_result.file.is_some());
        assert!(opened_result.error.is_none());

        let failed_result =
            MarkdownFileOpenResult::failed(r"C:\Users\Demo\missing.md".into(), "missing".into());
        assert_eq!(
            serde_json::to_value(&failed_result).expect("failed result should serialize"),
            json!({
                "path": r"C:\Users\Demo\missing.md",
                "file": null,
                "error": "missing",
            })
        );
        assert!(failed_result.file.is_none());
        assert_eq!(failed_result.error.as_deref(), Some("missing"));
    }

    #[test]
    fn save_updates_existing_markdown_file_without_hiding_failures() {
        let workspace = TestWorkspace::new("save-existing-file");
        let path = workspace
            .path("Windows path with spaces")
            .join("save target.md");
        fs::create_dir_all(path.parent().expect("save target should have a parent"))
            .expect("save target directory should be created");
        fs::write(&path, "before").expect("save target fixture should be written");
        approve_markdown_path_for_test(&path)
            .expect("save target should be approved for command save");

        let saved_file = block_on_command(save_markdown_file(
            path_string(&path),
            "# After\n\n한글 저장".into(),
            None,
            None,
        ))
        .expect("existing markdown file should save")
        .file
        .expect("existing markdown save should write a file");

        assert_eq!(saved_file.path, path_string(&path));
        assert_eq!(saved_file.title, "save target.md");
        assert_eq!(
            fs::read_to_string(&path).expect("saved markdown should be readable"),
            "# After\n\n한글 저장"
        );

        let entries: Vec<_> =
            fs::read_dir(path.parent().expect("save target should have a parent"))
                .expect("save target directory should be readable")
                .map(|entry| {
                    entry
                        .expect("save target entry should be readable")
                        .file_name()
                })
                .collect();
        assert_eq!(
            entries,
            vec![path
                .file_name()
                .expect("target should have a file name")
                .to_os_string()]
        );
    }

    #[test]
    fn command_save_reports_conflict_when_target_content_changed_after_open() {
        let workspace = TestWorkspace::new("save-conflict-modified");
        let path = workspace.path("conflict.md");
        fs::write(&path, "# Opened\n\ncontent").expect("conflict fixture should be written");
        approve_markdown_path_for_test(&path).expect("conflict fixture should be approved");

        let opened_file = block_on_command(open_markdown_file_at_path(path_string(&path)))
            .expect("approved conflict fixture should open");
        fs::write(&path, "# External\n\nchange").expect("external change should be written");

        let save_result = block_on_command(save_markdown_file(
            path_string(&path),
            "# Local\n\nedit".into(),
            Some(opened_file.file_fingerprint.clone()),
            None,
        ))
        .expect("conflict save should return a typed result");

        assert_eq!(save_result.status, "conflict");
        assert!(save_result.file.is_none());
        let conflict = save_result
            .conflict
            .expect("modified save should report a conflict");
        assert_eq!(conflict.path, path_string(&path));
        assert_eq!(conflict.reason, "modified");
        assert_eq!(
            fs::read_to_string(&path).expect("conflicted target should remain readable"),
            "# External\n\nchange"
        );

        let overwrite_result = block_on_command(save_markdown_file(
            path_string(&path),
            "# Local\n\nedit".into(),
            Some(opened_file.file_fingerprint),
            Some(true),
        ))
        .expect("explicit overwrite should save")
        .file
        .expect("explicit overwrite should write a file");
        assert_eq!(overwrite_result.path, path_string(&path));
        assert_eq!(
            fs::read_to_string(&path).expect("overwritten target should be readable"),
            "# Local\n\nedit"
        );
    }

    #[test]
    fn command_save_reports_conflict_when_target_was_deleted_after_open() {
        let workspace = TestWorkspace::new("save-conflict-deleted");
        let path = workspace.path("deleted.md");
        fs::write(&path, "# Opened\n\ncontent").expect("deleted fixture should be written");
        approve_markdown_path_for_test(&path).expect("deleted fixture should be approved");

        let opened_file = block_on_command(open_markdown_file_at_path(path_string(&path)))
            .expect("approved deleted fixture should open");
        fs::remove_file(&path).expect("external deletion should remove fixture");

        let save_result = block_on_command(save_markdown_file(
            path_string(&path),
            "# Local\n\nedit".into(),
            Some(opened_file.file_fingerprint.clone()),
            None,
        ))
        .expect("deleted save should return a typed result");

        assert_eq!(save_result.status, "conflict");
        assert!(save_result.file.is_none());
        let conflict = save_result
            .conflict
            .expect("deleted save should report a conflict");
        assert_eq!(conflict.path, path_string(&path));
        assert_eq!(conflict.reason, "deleted");
        assert!(
            !path.exists(),
            "deleted target should not be recreated before overwrite is chosen"
        );

        let overwrite_result = block_on_command(save_markdown_file(
            path_string(&path),
            "# Local\n\nedit".into(),
            Some(opened_file.file_fingerprint),
            Some(true),
        ))
        .expect("explicit deleted-target overwrite should save")
        .file
        .expect("explicit deleted-target overwrite should write a file");
        assert_eq!(overwrite_result.path, path_string(&path));
        assert_eq!(
            fs::read_to_string(&path).expect("recreated target should be readable"),
            "# Local\n\nedit"
        );
    }

    #[test]
    fn approved_canonical_markdown_path_is_reused_without_existing_path_canonicalize() {
        let workspace = TestWorkspace::new("reuse-approved-canonical-path");
        let path = workspace.path("approved-save-target.md");
        fs::write(&path, "before").expect("approval fixture should be written");
        let canonical_path = fs::canonicalize(&path).expect("approval fixture should canonicalize");
        let canonical_path_string =
            path_to_string(&canonical_path).expect("canonical path should be utf-8");
        let requested_path = PathBuf::from(&canonical_path_string);

        super::approve_canonical_markdown_file_path_string(&canonical_path_string)
            .expect("canonical markdown path should be approved");
        fs::remove_file(&path).expect("approval fixture should be removed");

        let approved_path = super::ensure_markdown_file_path_approved(&requested_path)
            .expect("approved canonical path should be accepted");

        assert_eq!(approved_path.as_deref(), Some(requested_path.as_path()));
    }

    #[test]
    fn approved_original_markdown_path_reuses_canonical_path_without_recanonicalize() {
        let workspace = TestWorkspace::new("reuse-approved-original-path");
        let directory = workspace.path("Windows path with spaces");
        fs::create_dir_all(&directory).expect("approval directory should be created");
        let path = directory.join("approved-launch-target.md");
        fs::write(&path, "before").expect("approval fixture should be written");
        let requested_path = directory.join(".").join("approved-launch-target.md");
        let canonical_path = fs::canonicalize(&path).expect("approval fixture should canonicalize");

        super::approve_existing_markdown_file_path(&requested_path)
            .expect("launch markdown path should be approved");
        fs::remove_file(&path).expect("approval fixture should be removed");

        let approved_path = super::ensure_markdown_file_path_approved(&requested_path)
            .expect("approved original path should be accepted");

        assert_eq!(approved_path.as_deref(), Some(canonical_path.as_path()));
    }

    #[test]
    fn blocking_save_tasks_for_same_path_write_in_request_order() {
        let workspace = TestWorkspace::new("save-same-path-request-order");
        let path = workspace.path("ordered-save.md");
        fs::write(&path, "before").expect("ordered save fixture should be written");

        let first_ticket = super::reserve_markdown_save_ticket(&path)
            .expect("first save ticket should be reserved");
        let second_ticket = super::reserve_markdown_save_ticket(&path)
            .expect("second save ticket should be reserved");
        let first_path = path.clone();
        let second_path = path.clone();

        let first_task =
            tauri::async_runtime::spawn(super::run_blocking_markdown_file_task(move || {
                first_ticket.run(move || {
                    thread::sleep(Duration::from_millis(100));
                    super::service::save_markdown_file_to_path(&first_path, "older request")
                        .map(|_| ())
                })
            }));
        let second_task =
            tauri::async_runtime::spawn(super::run_blocking_markdown_file_task(move || {
                second_ticket.run(move || {
                    super::service::save_markdown_file_to_path(&second_path, "newer request")
                        .map(|_| ())
                })
            }));

        let (first_result, second_result) = block_on_command(async {
            let first_result = first_task
                .await
                .expect("first save runtime task should complete");
            let second_result = second_task
                .await
                .expect("second save runtime task should complete");
            (first_result, second_result)
        });

        first_result.expect("first save should succeed");
        second_result.expect("second save should succeed");
        assert_eq!(
            fs::read_to_string(&path).expect("ordered save target should be readable"),
            "newer request"
        );
    }

    #[test]
    fn blocking_save_tasks_for_equivalent_existing_paths_write_in_request_order() {
        let workspace = TestWorkspace::new("save-equivalent-path-request-order");
        let directory = workspace.path("Windows path with spaces");
        fs::create_dir_all(&directory).expect("ordered save directory should be created");
        let path = directory.join("ordered-save.md");
        let equivalent_path = directory.join(".").join("ordered-save.md");
        fs::write(&path, "before").expect("ordered save fixture should be written");
        let canonical_path =
            fs::canonicalize(&path).expect("ordered save path should canonicalize");

        let first_ticket = super::reserve_markdown_save_ticket(&equivalent_path)
            .expect("first equivalent save ticket should be reserved");
        let second_ticket = super::reserve_markdown_save_ticket(&path)
            .expect("second equivalent save ticket should be reserved");
        let first_canonical_path = canonical_path.clone();
        let second_canonical_path = canonical_path.clone();

        let first_task =
            tauri::async_runtime::spawn(super::run_blocking_markdown_file_task(move || {
                first_ticket.run(move || {
                    thread::sleep(Duration::from_millis(100));
                    super::service::save_markdown_file_to_path_with_optional_canonical_path(
                        &first_canonical_path,
                        "older request",
                        Some(&first_canonical_path),
                    )
                    .map(|_| ())
                })
            }));
        let second_task =
            tauri::async_runtime::spawn(super::run_blocking_markdown_file_task(move || {
                second_ticket.run(move || {
                    super::service::save_markdown_file_to_path_with_optional_canonical_path(
                        &second_canonical_path,
                        "newer request",
                        Some(&second_canonical_path),
                    )
                    .map(|_| ())
                })
            }));

        let (first_result, second_result) = block_on_command(async {
            let first_result = first_task
                .await
                .expect("first equivalent save runtime task should complete");
            let second_result = second_task
                .await
                .expect("second equivalent save runtime task should complete");
            (first_result, second_result)
        });

        first_result.expect("first equivalent save should succeed");
        second_result.expect("second equivalent save should succeed");
        assert_eq!(
            fs::read_to_string(&path).expect("ordered save target should be readable"),
            "newer request"
        );
    }

    #[test]
    fn blocking_save_tasks_for_equivalent_nonexistent_paths_write_in_request_order() {
        let workspace = TestWorkspace::new("save-equivalent-new-path-request-order");
        let directory = workspace.path("Windows path with spaces");
        fs::create_dir_all(&directory).expect("ordered save directory should be created");
        let path = directory.join("ordered-save-as.md");
        let equivalent_path = directory.join(".").join("ordered-save-as.md");

        let first_ticket = super::reserve_markdown_save_ticket(&equivalent_path)
            .expect("first equivalent save ticket should be reserved");
        let second_ticket = super::reserve_markdown_save_ticket(&path)
            .expect("second equivalent save ticket should be reserved");
        let first_path = equivalent_path.clone();
        let second_path = path.clone();

        let first_task =
            tauri::async_runtime::spawn(super::run_blocking_markdown_file_task(move || {
                first_ticket.run(move || {
                    thread::sleep(Duration::from_millis(100));
                    super::service::save_markdown_file_to_path(&first_path, "older request")
                        .map(|_| ())
                })
            }));
        let second_task =
            tauri::async_runtime::spawn(super::run_blocking_markdown_file_task(move || {
                second_ticket.run(move || {
                    super::service::save_markdown_file_to_path(&second_path, "newer request")
                        .map(|_| ())
                })
            }));

        let (first_result, second_result) = block_on_command(async {
            let first_result = first_task
                .await
                .expect("first equivalent save runtime task should complete");
            let second_result = second_task
                .await
                .expect("second equivalent save runtime task should complete");
            (first_result, second_result)
        });

        first_result.expect("first equivalent save should succeed");
        second_result.expect("second equivalent save should succeed");
        assert_eq!(
            fs::read_to_string(&path).expect("ordered save target should be readable"),
            "newer request"
        );
    }

    #[test]
    fn command_save_reserves_request_order_before_approval_delay() {
        let workspace = TestWorkspace::new("save-command-approval-delay-order");
        let directory = workspace.path("Windows path with spaces");
        fs::create_dir_all(&directory).expect("ordered save directory should be created");
        let path = directory.join("approval-delayed-save.md");
        let equivalent_path = directory.join(".").join("approval-delayed-save.md");
        fs::write(&path, "before").expect("ordered save fixture should be written");
        approve_markdown_path_for_test(&equivalent_path)
            .expect("equivalent save target should be approved for command save");
        let first_approval_delay = delay_next_markdown_path_approval_for_test(
            &equivalent_path,
            Duration::from_millis(100),
        );

        let first_task = tauri::async_runtime::spawn(save_markdown_file(
            path_string(&equivalent_path),
            "older request".into(),
            None,
            None,
        ));
        wait_for_approval_delay_to_start(&first_approval_delay);
        let second_task = tauri::async_runtime::spawn(save_markdown_file(
            path_string(&path),
            "newer request".into(),
            None,
            None,
        ));

        let (first_result, second_result) = block_on_command(async {
            let first_result = first_task
                .await
                .expect("first save runtime task should complete");
            let second_result = second_task
                .await
                .expect("second save runtime task should complete");
            (first_result, second_result)
        });

        first_result.expect("first command save should succeed");
        second_result.expect("second command save should succeed");
        assert_eq!(
            fs::read_to_string(&path).expect("ordered save target should be readable"),
            "newer request"
        );
    }

    #[test]
    fn dropped_save_ticket_does_not_block_later_save_ticket() {
        let workspace = TestWorkspace::new("dropped-save-ticket");
        let path = workspace.path("dropped-ticket.md");
        let queue_key = markdown_save_queue_key_for_test(&path);
        let first_ticket = super::reserve_markdown_save_ticket(&path)
            .expect("first save ticket should be reserved");
        let second_ticket = super::reserve_markdown_save_ticket(&path)
            .expect("second save ticket should be reserved");

        drop(first_ticket);
        assert_markdown_save_queue_present(&queue_key);

        second_ticket
            .run(|| Ok(()))
            .expect("later ticket should run after earlier ticket is dropped");
        assert_markdown_save_queue_absent(&queue_key);
    }

    #[test]
    fn completed_idle_save_ticket_removes_save_queue_entry() {
        let workspace = TestWorkspace::new("completed-save-queue-cleanup");
        let path = workspace.path("completed-ticket.md");
        let queue_key = markdown_save_queue_key_for_test(&path);

        super::reserve_markdown_save_ticket(&path)
            .expect("save ticket should be reserved")
            .run(|| Ok(()))
            .expect("save ticket should complete");

        assert_markdown_save_queue_absent(&queue_key);
    }

    #[test]
    fn dropped_idle_save_ticket_removes_save_queue_entry() {
        let workspace = TestWorkspace::new("dropped-save-queue-cleanup");
        let path = workspace.path("dropped-idle-ticket.md");
        let queue_key = markdown_save_queue_key_for_test(&path);
        let ticket =
            super::reserve_markdown_save_ticket(&path).expect("save ticket should be reserved");

        drop(ticket);

        assert_markdown_save_queue_absent(&queue_key);
    }

    #[test]
    fn save_as_adds_default_md_extension_and_writes_content() {
        let workspace = TestWorkspace::new("save-as-default-extension");
        let requested_path = workspace.path("새 문서");
        let expected_path = workspace.path("새 문서.md");

        let saved_file = save_markdown_file_as_path(requested_path, "# Save As\n\ncontent")
            .expect("save as path should be normalized and written");

        assert_eq!(saved_file.path, path_string(&expected_path));
        assert_eq!(saved_file.title, "새 문서.md");
        assert_eq!(
            fs::read_to_string(expected_path).expect("save as markdown should be readable"),
            "# Save As\n\ncontent"
        );
    }

    #[test]
    fn selected_save_path_is_normalized_and_approved_for_command_save() {
        let workspace = TestWorkspace::new("selected-save-path-approval");
        let requested_path = workspace.path("선택한 새 문서");
        let expected_path = workspace.path("선택한 새 문서.md");

        let selected_path = super::normalize_and_approve_markdown_save_path(requested_path)
            .expect("selected save path should be normalized and approved");
        let saved_file = block_on_command(save_markdown_file(
            selected_path,
            "# Selected Save\n\ncontent".into(),
            None,
            None,
        ))
        .expect("approved selected path should be writable through command save")
        .file
        .expect("approved selected save should write a file");

        assert_eq!(saved_file.path, path_string(&expected_path));
        assert_eq!(saved_file.title, "선택한 새 문서.md");
        assert_eq!(
            fs::read_to_string(expected_path).expect("selected save should write markdown"),
            "# Selected Save\n\ncontent"
        );
    }

    #[test]
    fn command_save_as_selected_path_writes_existing_equivalent_path() {
        let workspace = TestWorkspace::new("save-as-equivalent-existing-path");
        let directory = workspace.path("Windows path with spaces");
        fs::create_dir_all(&directory).expect("save as directory should be created");
        let path = directory.join("selected-save-as.md");
        let requested_path = directory.join(".").join("selected-save-as.md");
        fs::write(&path, "before").expect("save as fixture should be written");
        let canonical_path = fs::canonicalize(&path).expect("save as path should canonicalize");

        let saved_file = block_on_command(super::run_blocking_markdown_file_task(move || {
            super::save_markdown_file_as_selected_path(
                requested_path,
                "# Save As\n\ncontent".into(),
            )
        }))
        .expect("save as blocking task should succeed")
        .expect("selected save as path should save a result")
        .file
        .expect("selected save as path should save a file");

        assert_eq!(
            saved_file.path,
            path_to_string(&canonical_path)
                .expect("canonical save as path should be valid unicode")
        );
        assert_eq!(saved_file.title, "selected-save-as.md");
        assert_eq!(
            fs::read_to_string(path).expect("save as markdown should be readable"),
            "# Save As\n\ncontent"
        );
    }

    #[test]
    fn failed_save_preserves_existing_target_and_removes_temporary_file() {
        let workspace = TestWorkspace::new("failed-save-preserves-target");
        let parent = workspace.path("Windows path with spaces");
        fs::create_dir_all(&parent).expect("save target directory should be created");
        let target = parent.join("directory target.md");
        fs::create_dir(&target).expect("directory target fixture should be created");
        approve_markdown_path_for_test(&target)
            .expect("directory target should be approved for command save");

        let error = block_on_command(save_markdown_file(
            path_string(&target),
            "must not replace target".into(),
            None,
            None,
        ))
        .expect_err("saving over a directory target should fail");

        assert!(error.contains("저장"));
        assert!(target.is_dir(), "existing target directory should remain");

        let entries: Vec<_> = fs::read_dir(&parent)
            .expect("parent directory should be readable")
            .map(|entry| entry.expect("parent entry should be readable").file_name())
            .collect();
        assert_eq!(
            entries,
            vec![target
                .file_name()
                .expect("target should have a file name")
                .to_os_string()]
        );
    }

    #[test]
    fn rejects_unsupported_extension_before_creating_or_overwriting_file() {
        let workspace = TestWorkspace::new("reject-unsupported-extension");
        let unsupported_path = workspace.path("unsupported.txt");

        let open_error =
            block_on_command(open_markdown_file_at_path(path_string(&unsupported_path)))
                .expect_err("unsupported open path should be rejected");
        assert!(open_error.contains(".md 또는 .markdown 파일만 열 수 있습니다"));

        let save_error = block_on_command(save_markdown_file(
            path_string(&unsupported_path),
            "must not write".into(),
            None,
            None,
        ))
        .expect_err("unsupported save path should be rejected");
        assert!(save_error.contains(".md 또는 .markdown 파일만 열 수 있습니다"));
        assert!(
            !unsupported_path.exists(),
            "unsupported save path must not be created"
        );
    }

    #[test]
    fn rejects_unapproved_supported_markdown_paths_before_reading_or_writing() {
        let workspace = TestWorkspace::new("unapproved-supported-path");
        let path = workspace.path("unapproved.md");
        fs::write(&path, "before").expect("unapproved fixture should be written");

        let open_error = block_on_command(open_markdown_file_at_path(path_string(&path)))
            .expect_err("unapproved open path should be rejected");
        assert!(open_error.contains("먼저 열기 또는 새 이름 저장"));

        let save_error = block_on_command(save_markdown_file(
            path_string(&path),
            "must not overwrite unapproved path".into(),
            None,
            None,
        ))
        .expect_err("unapproved save path should be rejected");
        assert!(save_error.contains("먼저 열기 또는 새 이름 저장"));
        assert_eq!(
            fs::read_to_string(&path).expect("unapproved fixture should be readable"),
            "before"
        );
    }

    #[test]
    fn rejects_supported_markdown_file_over_size_limit() {
        let workspace = TestWorkspace::new("oversized-supported-file");
        let oversized_path = workspace.path("oversized.md");
        let file = fs::File::create(&oversized_path).expect("oversized fixture should be created");
        file.set_len(MAX_MARKDOWN_FILE_BYTES + 1)
            .expect("oversized fixture length should be set");
        approve_markdown_path_for_test(&oversized_path)
            .expect("oversized fixture should be approved for command open");

        let error = block_on_command(open_markdown_file_at_path(path_string(&oversized_path)))
            .expect_err("oversized markdown file should be rejected");

        assert!(error.contains("파일이 너무 큽니다"));
        assert!(error.contains("oversized.md"));
        assert!(error.contains("최대 10 MiB"));
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
            .join("markdown-file-io")
    }

    fn path_string(path: &Path) -> String {
        path.to_str()
            .expect("test paths should be valid unicode")
            .to_owned()
    }

    fn markdown_save_queue_key_for_test(path: &Path) -> String {
        let queue_path = super::paths::canonicalize_save_queue_path(path);
        super::markdown_file_path_approval_key(
            &path_to_string(&queue_path).expect("test paths should be valid unicode"),
        )
    }

    fn delay_next_markdown_path_approval_for_test(
        path: &Path,
        duration: Duration,
    ) -> Arc<(Mutex<bool>, Condvar)> {
        let key = super::markdown_file_path_approval_key_for_path(path)
            .expect("test path should have an approval key");
        let started = Arc::new((Mutex::new(false), Condvar::new()));
        let delay = super::TestMarkdownApprovalDelay {
            duration,
            started: Arc::clone(&started),
        };
        let mut delays = super::test_markdown_approval_delays()
            .lock()
            .expect("test approval delays should be writable");
        delays.insert(key, delay);
        started
    }

    fn wait_for_approval_delay_to_start(started: &Arc<(Mutex<bool>, Condvar)>) {
        let (started, started_available) = &**started;
        let started = started
            .lock()
            .expect("test approval delay should be readable");
        let wait_result = started_available
            .wait_timeout_while(started, Duration::from_secs(2), |started| !*started)
            .expect("test approval delay wait should complete");
        assert!(
            *wait_result.0,
            "delayed approval should start before the second save request"
        );
    }

    fn assert_markdown_save_queue_present(queue_key: &str) {
        let queues = super::markdown_save_queues()
            .lock()
            .expect("markdown save queues should be readable");
        assert!(
            queues.contains_key(queue_key),
            "save queue should remain while later tickets are pending"
        );
    }

    fn assert_markdown_save_queue_absent(queue_key: &str) {
        let queues = super::markdown_save_queues()
            .lock()
            .expect("markdown save queues should be readable");
        assert!(
            !queues.contains_key(queue_key),
            "idle save queue should be removed"
        );
    }

    fn block_on_command<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }
}
