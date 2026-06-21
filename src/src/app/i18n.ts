export const supportedUiLanguages = [
  { id: "en", label: "English" },
  { id: "ko", label: "한국어" },
] as const;

export type UiLanguage = (typeof supportedUiLanguages)[number]["id"];
export type UnsavedChangeContext = "tab" | "window";
export type SaveConflictReason = "modified" | "deleted";

export const defaultUiLanguage: UiLanguage = "en";

export interface AppCopy {
  readonly toolbar: {
    readonly actions: {
      readonly new: string;
      readonly open: string;
      readonly save: string;
      readonly saveAs: string;
      readonly about: string;
    };
    readonly themeLabel: string;
    readonly themeAriaLabel: string;
    readonly languageLabel: string;
    readonly languageAriaLabel: string;
  };
  readonly tabBar: {
    readonly ariaLabel: string;
    readonly closeTabAriaLabel: (title: string) => string;
    readonly contextMenuAriaLabel: string;
    readonly openInNewWindow: string;
    readonly closeOtherTabs: string;
  };
  readonly status: {
    readonly untitled: string;
    readonly dirty: string;
    readonly saved: string;
    readonly tabs: (count: number) => string;
    readonly lines: (count: number) => string;
    readonly words: (count: number) => string;
    readonly characters: (count: number) => string;
    readonly modified: (time: string) => string;
    readonly timeLocale: string;
  };
  readonly editor: {
    readonly ariaLabel: string;
    readonly errorLabel: string;
    readonly serializeError: string;
    readonly editCommandError: (command: string) => string;
    readonly boldPlaceholder: string;
    readonly italicPlaceholder: string;
  };
  readonly editorContextMenu: {
    readonly ariaLabel: string;
    readonly undo: string;
    readonly redo: string;
    readonly cut: string;
    readonly copy: string;
    readonly paste: string;
    readonly selectAll: string;
    readonly bold: string;
    readonly italic: string;
    readonly inlineCode: string;
  };
  readonly dialogs: {
    readonly buttons: {
      readonly save: string;
      readonly discard: string;
      readonly cancel: string;
      readonly reload: string;
      readonly saveAs: string;
      readonly overwrite: string;
      readonly close: string;
      readonly ok: string;
    };
    readonly unsavedTitle: string;
    readonly unsavedMessage: (tabTitle: string, context: UnsavedChangeContext) => string;
    readonly saveConflictTitle: string;
    readonly saveConflictMessage: (
      tabTitle: string,
      reason: SaveConflictReason,
    ) => string;
    readonly aboutTitle: string;
    readonly aboutVersion: (version: string) => string;
    readonly aboutTextLoadFailed: (version: string, sourceUrl: string) => string;
  };
  readonly errors: {
    readonly openFailed: string;
    readonly dropError: string;
    readonly closeFailed: string;
    readonly closeGuardTitle: string;
    readonly closeGuardMessage: (errorMessage: string) => string;
    readonly editFailed: string;
    readonly cannotOpen: string;
    readonly noOpenResult: string;
    readonly newWindowOpenFailed: string;
    readonly newWindowDocumentMissing: string;
    readonly startupFileError: string;
    readonly saveFailed: string;
    readonly selectedSaveConflictUnknown: string;
    readonly overwriteConflictUnresolved: string;
    readonly reloadFailed: string;
    readonly tabSwitchFailed: string;
    readonly aboutFailed: string;
    readonly linkOpenFailed: string;
    readonly taskFailed: string;
    readonly unknown: string;
    readonly moreErrorsSuffix: (hiddenCount: number) => string;
  };
}

export function isUiLanguage(value: string): value is UiLanguage {
  return supportedUiLanguages.some((language) => language.id === value);
}

export function getAppCopy(language: UiLanguage): AppCopy {
  return appCopy[language];
}

const appCopy = {
  en: {
    toolbar: {
      actions: {
        new: "New",
        open: "Open",
        save: "Save",
        saveAs: "Save As",
        about: "About",
      },
      themeLabel: "Theme",
      themeAriaLabel: "Editor theme",
      languageLabel: "Lang",
      languageAriaLabel: "UI language",
    },
    tabBar: {
      ariaLabel: "Document tabs",
      closeTabAriaLabel: (title) => `Close ${title}`,
      contextMenuAriaLabel: "Tab menu",
      openInNewWindow: "Open in New Window",
      closeOtherTabs: "Close Other Tabs",
    },
    status: {
      untitled: "Untitled",
      dirty: "Modified",
      saved: "Saved",
      tabs: (count) => `Tabs ${count}`,
      lines: (count) => `Lines ${count}`,
      words: (count) => `Words ${count}`,
      characters: (count) => `Chars ${count}`,
      modified: (time) => `Updated ${time}`,
      timeLocale: "en-US",
    },
    editor: {
      ariaLabel: "Editor",
      errorLabel: "Editor error",
      serializeError: "Could not convert editor content to Markdown.",
      editCommandError: (command) => `Could not edit. (${command})`,
      boldPlaceholder: "bold",
      italicPlaceholder: "italic",
    },
    editorContextMenu: {
      ariaLabel: "Edit menu",
      undo: "Undo",
      redo: "Redo",
      cut: "Cut",
      copy: "Copy",
      paste: "Paste",
      selectAll: "Select All",
      bold: "Bold",
      italic: "Italic",
      inlineCode: "Code",
    },
    dialogs: {
      buttons: {
        save: "Save",
        discard: "Don't Save",
        cancel: "Cancel",
        reload: "Reload",
        saveAs: "Save As",
        overwrite: "Overwrite",
        close: "Close",
        ok: "OK",
      },
      unsavedTitle: "Unsaved Changes",
      unsavedMessage: (tabTitle, context) =>
        context === "window"
          ? `Save "${tabTitle}" before closing the app?`
          : `Save "${tabTitle}"?`,
      saveConflictTitle: "File Conflict",
      saveConflictMessage: (tabTitle, reason) => {
        const reasonText =
          reason === "deleted"
            ? "The save target file was deleted outside the app."
            : "The save target file was changed outside the app.";

        return `${reasonText} Current edits in "${tabTitle}" will be kept.`;
      },
      aboutTitle: "About j3Markdown",
      aboutVersion: (version) => `Version ${version}`,
      aboutTextLoadFailed: (version, sourceUrl) =>
        `j3Markdown\n\nVersion: ${version}\nSource code for this release:\n${sourceUrl}\n\nCould not load about.txt from the bundled application resources.`,
    },
    errors: {
      openFailed: "Open Failed",
      dropError: "Drop Error",
      closeFailed: "Close Failed",
      closeGuardTitle: "Close Confirmation Error",
      closeGuardMessage: (errorMessage) =>
        `Close confirmation could not be registered, so temporary close protection is active. Save your files before closing. Error: ${errorMessage}`,
      editFailed: "Edit Failed",
      cannotOpen: "Cannot Open",
      noOpenResult: "No open result was returned.",
      newWindowOpenFailed: "Open New Window Failed",
      newWindowDocumentMissing: "Could not find the document to open in a new window.",
      startupFileError: "Startup File Error",
      saveFailed: "Save Failed",
      selectedSaveConflictUnknown: "Could not check the selected save location conflict.",
      overwriteConflictUnresolved: "Could not resolve the file conflict while overwriting.",
      reloadFailed: "Reload Failed",
      tabSwitchFailed: "Tab Switch Failed",
      aboutFailed: "About Failed",
      linkOpenFailed: "Open Link Failed",
      taskFailed: "Action Failed",
      unknown: "Unknown error.",
      moreErrorsSuffix: (hiddenCount) => ` and ${hiddenCount} more`,
    },
  },
  ko: {
    toolbar: {
      actions: {
        new: "새 글",
        open: "열기",
        save: "저장",
        saveAs: "새 이름 저장",
        about: "정보",
      },
      themeLabel: "테마",
      themeAriaLabel: "편집기 테마",
      languageLabel: "언어",
      languageAriaLabel: "UI 언어",
    },
    tabBar: {
      ariaLabel: "문서 탭",
      closeTabAriaLabel: (title) => `${title} 닫기`,
      contextMenuAriaLabel: "탭 메뉴",
      openInNewWindow: "새 창에서 열기",
      closeOtherTabs: "다른 탭 닫기",
    },
    status: {
      untitled: "새 글",
      dirty: "수정됨",
      saved: "저장됨",
      tabs: (count) => `탭 ${count}`,
      lines: (count) => `줄 ${count}`,
      words: (count) => `단어 ${count}`,
      characters: (count) => `글자 ${count}`,
      modified: (time) => `수정 ${time}`,
      timeLocale: "ko-KR",
    },
    editor: {
      ariaLabel: "편집기",
      errorLabel: "편집기 오류",
      serializeError: "편집기 내용을 Markdown으로 변환할 수 없습니다.",
      editCommandError: (command) => `편집할 수 없습니다. (${command})`,
      boldPlaceholder: "굵게",
      italicPlaceholder: "기울임",
    },
    editorContextMenu: {
      ariaLabel: "편집 메뉴",
      undo: "되돌리기",
      redo: "다시 실행",
      cut: "잘라내기",
      copy: "복사",
      paste: "붙여넣기",
      selectAll: "전체 선택",
      bold: "굵게",
      italic: "기울임",
      inlineCode: "코드",
    },
    dialogs: {
      buttons: {
        save: "저장",
        discard: "저장안함",
        cancel: "취소",
        reload: "다시 불러오기",
        saveAs: "다른 이름 저장",
        overwrite: "덮어쓰기",
        close: "닫기",
        ok: "확인",
      },
      unsavedTitle: "저장 안 됨",
      unsavedMessage: (tabTitle, context) =>
        context === "window"
          ? `앱 닫기 전 "${tabTitle}"을 저장할까요?`
          : `"${tabTitle}"을 저장할까요?`,
      saveConflictTitle: "파일 충돌",
      saveConflictMessage: (tabTitle, reason) => {
        const reasonText =
          reason === "deleted"
            ? "저장 대상 파일이 외부에서 삭제되었습니다."
            : "저장 대상 파일이 외부에서 변경되었습니다.";

        return `${reasonText} "${tabTitle}"의 현재 편집 내용은 유지됩니다.`;
      },
      aboutTitle: "j3Markdown 정보",
      aboutVersion: (version) => `버전 ${version}`,
      aboutTextLoadFailed: (version, sourceUrl) =>
        `j3Markdown\n\n버전 ${version}\n이 릴리스의 소스 코드:\n${sourceUrl}\n\n앱에 포함된 about.txt를 불러올 수 없습니다.`,
    },
    errors: {
      openFailed: "열기 실패",
      dropError: "드롭 오류",
      closeFailed: "닫기 실패",
      closeGuardTitle: "닫기 확인 오류",
      closeGuardMessage: (errorMessage) =>
        `닫기 확인을 정상 등록할 수 없어 임시 닫기 보호를 사용합니다. 닫기 전 파일을 저장하세요. 오류: ${errorMessage}`,
      editFailed: "편집 실패",
      cannotOpen: "열 수 없음",
      noOpenResult: "열기 결과가 없습니다.",
      newWindowOpenFailed: "새 창 열기 실패",
      newWindowDocumentMissing: "새 창으로 열 문서를 찾을 수 없습니다.",
      startupFileError: "시작 파일 오류",
      saveFailed: "저장 실패",
      selectedSaveConflictUnknown: "선택한 저장 위치의 충돌을 확인할 수 없습니다.",
      overwriteConflictUnresolved: "덮어쓰기 중 파일 충돌을 해결하지 못했습니다.",
      reloadFailed: "다시 불러오기 실패",
      tabSwitchFailed: "탭 전환 실패",
      aboutFailed: "정보 표시 실패",
      linkOpenFailed: "링크 열기 실패",
      taskFailed: "작업 실패",
      unknown: "알 수 없는 오류입니다.",
      moreErrorsSuffix: (hiddenCount) => ` 외 ${hiddenCount}개`,
    },
  },
} satisfies Record<UiLanguage, AppCopy>;
