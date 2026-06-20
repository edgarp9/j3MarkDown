use std::{
    collections::HashMap,
    sync::mpsc::{self, Receiver, Sender},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const DETACHED_DOCUMENT_QUERY_KEY: &str = "detachedDocumentToken";
const DEFAULT_WINDOW_WIDTH: f64 = 600.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 500.0;
const MIN_WINDOW_WIDTH: f64 = 600.0;
const MIN_WINDOW_HEIGHT: f64 = 500.0;
const HANDOFF_CONSUMPTION_TIMEOUT: Duration = Duration::from_secs(30);

static NEXT_DOCUMENT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedWindowDocument {
    title: String,
    file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_fingerprint: Option<String>,
    markdown: String,
    dirty: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_saved_markdown: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    last_saved_markdown_matches_markdown: bool,
    save_target_detached: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    handoff_token: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    broadcast_handoff_only: bool,
}

#[derive(Default)]
pub struct DetachedWindowDocuments {
    documents: Mutex<HashMap<String, DetachedWindowHandoff>>,
}

struct DetachedWindowHandoff {
    document: Option<DetachedWindowDocument>,
    result_sender: Sender<DetachedWindowHandoffResult>,
}

#[derive(Debug, Eq, PartialEq)]
enum DetachedWindowHandoffResult {
    Consumed,
    ClosedBeforeConsumed,
}

#[tauri::command]
pub async fn open_markdown_document_in_new_window(
    app: tauri::AppHandle,
    documents: tauri::State<'_, DetachedWindowDocuments>,
    document: DetachedWindowDocument,
) -> Result<(), String> {
    let window_id = NEXT_DOCUMENT_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
    let label = format!("document-window-{window_id}");
    let window_title = format!("{} - j3Markdown", document.title);

    let token = document
        .handoff_token
        .clone()
        .unwrap_or_else(|| format!("{label}-handoff"));
    let (result_sender, result_receiver) = mpsc::channel();

    insert_detached_window_document(
        &documents,
        token.clone(),
        DetachedWindowHandoff {
            document: if document.broadcast_handoff_only {
                None
            } else {
                Some(document)
            },
            result_sender,
        },
    )?;

    let window_result = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(format!("index.html?{DETACHED_DOCUMENT_QUERY_KEY}={token}").into()),
    )
    .title(window_title)
    .inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
    .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    .resizable(true)
    .center()
    .build();

    let window = match window_result {
        Ok(window) => window,
        Err(error) => {
            let _ = remove_detached_window_document(
                &documents,
                &token,
                DetachedWindowHandoffResult::ClosedBeforeConsumed,
            );
            return Err(format!("새 창을 열 수 없습니다: {error}"));
        }
    };

    let app_for_window_event = app.clone();
    let token_for_window_event = token.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let documents = app_for_window_event.state::<DetachedWindowDocuments>();
            let _ = remove_detached_window_document(
                &documents,
                &token_for_window_event,
                DetachedWindowHandoffResult::ClosedBeforeConsumed,
            );
        }
    });

    let handoff_result = match wait_for_detached_window_handoff(result_receiver).await {
        Ok(result) => result,
        Err(error) => {
            cleanup_failed_detached_window_handoff(&documents, &token, || window.destroy());
            return Err(error);
        }
    };

    match handoff_result {
        DetachedWindowHandoffResult::Consumed => Ok(()),
        DetachedWindowHandoffResult::ClosedBeforeConsumed => {
            Err("새 창이 문서를 가져오기 전에 닫혔습니다.".into())
        }
    }
}

async fn wait_for_detached_window_handoff(
    result_receiver: Receiver<DetachedWindowHandoffResult>,
) -> Result<DetachedWindowHandoffResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        result_receiver
            .recv_timeout(HANDOFF_CONSUMPTION_TIMEOUT)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => {
                    "새 창이 문서를 가져오지 못했습니다.".to_string()
                }
                mpsc::RecvTimeoutError::Disconnected => {
                    "새 창 문서 전달 상태를 확인할 수 없습니다.".to_string()
                }
            })
    })
    .await
    .map_err(|error| format!("새 창 문서 전달 확인 실패: {error}"))?
}

#[tauri::command]
pub fn complete_detached_window_broadcast_handoff(
    documents: tauri::State<'_, DetachedWindowDocuments>,
    token: String,
) -> Result<(), String> {
    remove_detached_window_document(&documents, &token, DetachedWindowHandoffResult::Consumed)?;

    Ok(())
}

#[tauri::command]
pub fn take_detached_window_document(
    documents: tauri::State<'_, DetachedWindowDocuments>,
    token: String,
) -> Result<Option<DetachedWindowDocument>, String> {
    take_detached_window_handoff(&documents, &token)
}

fn take_detached_window_handoff(
    documents: &DetachedWindowDocuments,
    token: &str,
) -> Result<Option<DetachedWindowDocument>, String> {
    let handoff = remove_detached_window_handoff(documents, token)?;
    if let Some(handoff) = handoff {
        let result = if handoff.document.is_some() {
            DetachedWindowHandoffResult::Consumed
        } else {
            DetachedWindowHandoffResult::ClosedBeforeConsumed
        };
        let document = finish_detached_window_handoff(handoff, result);

        return Ok(document);
    }

    Ok(None)
}

fn insert_detached_window_document(
    documents: &DetachedWindowDocuments,
    token: String,
    handoff: DetachedWindowHandoff,
) -> Result<(), String> {
    documents
        .documents
        .lock()
        .map_err(detached_document_lock_error_message)?
        .insert(token, handoff);

    Ok(())
}

fn remove_detached_window_document(
    documents: &DetachedWindowDocuments,
    token: &str,
    result: DetachedWindowHandoffResult,
) -> Result<Option<DetachedWindowDocument>, String> {
    let handoff = remove_detached_window_handoff(documents, token)?;

    if let Some(handoff) = handoff {
        Ok(finish_detached_window_handoff(handoff, result))
    } else {
        Ok(None)
    }
}

fn remove_detached_window_handoff(
    documents: &DetachedWindowDocuments,
    token: &str,
) -> Result<Option<DetachedWindowHandoff>, String> {
    documents
        .documents
        .lock()
        .map_err(detached_document_lock_error_message)
        .map(|mut documents| documents.remove(token))
}

fn finish_detached_window_handoff(
    handoff: DetachedWindowHandoff,
    result: DetachedWindowHandoffResult,
) -> Option<DetachedWindowDocument> {
    let _ = handoff.result_sender.send(result);

    handoff.document
}

fn cleanup_failed_detached_window_handoff(
    documents: &DetachedWindowDocuments,
    token: &str,
    destroy_window: impl FnOnce() -> tauri::Result<()>,
) {
    if let Err(error) = remove_detached_window_document(
        documents,
        token,
        DetachedWindowHandoffResult::ClosedBeforeConsumed,
    ) {
        eprintln!("새 창 문서 전달 상태 정리 실패: {error}");
    }

    if let Err(error) = destroy_window() {
        eprintln!("새 창 정리 실패: {error}");
    }
}

fn detached_document_lock_error_message(error: impl std::fmt::Display) -> String {
    format!("새 창 문서 전달 오류: {error}")
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_failed_detached_window_handoff, insert_detached_window_document,
        remove_detached_window_document, take_detached_window_handoff, DetachedWindowDocument,
        DetachedWindowDocuments, DetachedWindowHandoff, DetachedWindowHandoffResult,
    };
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn detached_window_document_contract_has_stable_fields() {
        let document = DetachedWindowDocument {
            title: "note.md".into(),
            file_path: Some(r"C:\Users\Demo\note.md".into()),
            file_fingerprint: Some("v1:6:demo".into()),
            markdown: "# Note".into(),
            dirty: true,
            last_saved_markdown: Some("# Saved".into()),
            last_saved_markdown_matches_markdown: false,
            save_target_detached: false,
            handoff_token: None,
            broadcast_handoff_only: false,
        };

        assert_eq!(
            serde_json::to_value(&document).expect("document should serialize"),
            json!({
                "title": "note.md",
                "filePath": r"C:\Users\Demo\note.md",
                "fileFingerprint": "v1:6:demo",
                "markdown": "# Note",
                "dirty": true,
                "lastSavedMarkdown": "# Saved",
                "saveTargetDetached": false,
            })
        );
    }

    #[test]
    fn detached_window_document_omits_duplicate_saved_markdown_when_marked_equal() {
        let document = DetachedWindowDocument {
            title: "note.md".into(),
            file_path: Some(r"C:\Users\Demo\note.md".into()),
            file_fingerprint: None,
            markdown: "# Note".into(),
            dirty: false,
            last_saved_markdown: None,
            last_saved_markdown_matches_markdown: true,
            save_target_detached: false,
            handoff_token: None,
            broadcast_handoff_only: false,
        };

        assert_eq!(
            serde_json::to_value(&document).expect("document should serialize"),
            json!({
                "title": "note.md",
                "filePath": r"C:\Users\Demo\note.md",
                "markdown": "# Note",
                "dirty": false,
                "lastSavedMarkdownMatchesMarkdown": true,
                "saveTargetDetached": false,
            })
        );
    }

    #[test]
    fn detached_window_broadcast_handoff_request_omits_markdown_body() {
        let document = DetachedWindowDocument {
            title: "note.md".into(),
            file_path: Some(r"C:\Users\Demo\note.md".into()),
            file_fingerprint: Some("v1:0:empty".into()),
            markdown: "".into(),
            dirty: true,
            last_saved_markdown: None,
            last_saved_markdown_matches_markdown: false,
            save_target_detached: false,
            handoff_token: Some("handoff-token".into()),
            broadcast_handoff_only: true,
        };

        assert_eq!(
            serde_json::to_value(&document).expect("document should serialize"),
            json!({
                "title": "note.md",
                "filePath": r"C:\Users\Demo\note.md",
                "fileFingerprint": "v1:0:empty",
                "markdown": "",
                "dirty": true,
                "saveTargetDetached": false,
                "handoffToken": "handoff-token",
                "broadcastHandoffOnly": true,
            })
        );
    }

    #[test]
    fn removing_consumed_handoff_returns_document_and_reports_consumption() {
        let documents = DetachedWindowDocuments::default();
        let (result_sender, result_receiver) = mpsc::channel();
        let document = sample_detached_window_document();

        insert_detached_window_document(
            &documents,
            "handoff-token".into(),
            DetachedWindowHandoff {
                document: Some(document),
                result_sender,
            },
        )
        .expect("handoff should be inserted");

        let removed = remove_detached_window_document(
            &documents,
            "handoff-token",
            DetachedWindowHandoffResult::Consumed,
        )
        .expect("handoff removal should succeed")
        .expect("handoff should exist");

        assert_eq!(removed.markdown, "# Note");
        assert_eq!(
            result_receiver
                .recv_timeout(Duration::from_secs(1))
                .expect("handoff result should be sent"),
            DetachedWindowHandoffResult::Consumed
        );
    }

    #[test]
    fn removing_unconsumed_handoff_reports_window_closed() {
        let documents = DetachedWindowDocuments::default();
        let (result_sender, result_receiver) = mpsc::channel();

        insert_detached_window_document(
            &documents,
            "handoff-token".into(),
            DetachedWindowHandoff {
                document: Some(sample_detached_window_document()),
                result_sender,
            },
        )
        .expect("handoff should be inserted");

        let removed = remove_detached_window_document(
            &documents,
            "handoff-token",
            DetachedWindowHandoffResult::ClosedBeforeConsumed,
        )
        .expect("handoff removal should succeed");

        assert!(removed.is_some());
        assert_eq!(
            result_receiver
                .recv_timeout(Duration::from_secs(1))
                .expect("handoff result should be sent"),
            DetachedWindowHandoffResult::ClosedBeforeConsumed
        );
    }

    #[test]
    fn taking_broadcast_only_handoff_returns_no_document_and_reports_not_consumed() {
        let documents = DetachedWindowDocuments::default();
        let (result_sender, result_receiver) = mpsc::channel();

        insert_detached_window_document(
            &documents,
            "handoff-token".into(),
            DetachedWindowHandoff {
                document: None,
                result_sender,
            },
        )
        .expect("handoff should be inserted");

        let removed = take_detached_window_handoff(&documents, "handoff-token")
            .expect("handoff removal should succeed");

        assert!(removed.is_none());
        assert_eq!(
            result_receiver
                .recv_timeout(Duration::from_secs(1))
                .expect("handoff result should be sent"),
            DetachedWindowHandoffResult::ClosedBeforeConsumed
        );
    }

    #[test]
    fn failed_handoff_cleanup_removes_handoff_and_destroys_window() {
        let documents = DetachedWindowDocuments::default();
        let (result_sender, result_receiver) = mpsc::channel();
        let window_destroyed = AtomicBool::new(false);

        insert_detached_window_document(
            &documents,
            "handoff-token".into(),
            DetachedWindowHandoff {
                document: Some(sample_detached_window_document()),
                result_sender,
            },
        )
        .expect("handoff should be inserted");

        cleanup_failed_detached_window_handoff(&documents, "handoff-token", || {
            assert!(
                remove_detached_window_document(
                    &documents,
                    "handoff-token",
                    DetachedWindowHandoffResult::Consumed,
                )
                .expect("handoff lookup should succeed")
                .is_none(),
                "handoff state should be removed before destroying the window"
            );

            window_destroyed.store(true, Ordering::SeqCst);
            Ok(())
        });

        assert!(window_destroyed.load(Ordering::SeqCst));
        assert_eq!(
            result_receiver
                .recv_timeout(Duration::from_secs(1))
                .expect("handoff result should be sent"),
            DetachedWindowHandoffResult::ClosedBeforeConsumed
        );
    }

    fn sample_detached_window_document() -> DetachedWindowDocument {
        DetachedWindowDocument {
            title: "note.md".into(),
            file_path: Some(r"C:\Users\Demo\note.md".into()),
            file_fingerprint: Some("v1:6:sample".into()),
            markdown: "# Note".into(),
            dirty: true,
            last_saved_markdown: Some("# Saved".into()),
            last_saved_markdown_matches_markdown: false,
            save_target_detached: false,
            handoff_token: None,
            broadcast_handoff_only: false,
        }
    }
}
