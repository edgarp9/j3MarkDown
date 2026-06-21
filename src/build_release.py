#!/usr/bin/env python3
"""Build the Tauri release bundle and open the generated release artifacts."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
RELEASE_DIR = ROOT_DIR / "src-tauri" / "target" / "release"
ARTIFACTS_DIR = ROOT_DIR / "release"
REQUIRED_RELEASE_FILES = [
    ROOT_DIR / "LICENSE",
    ROOT_DIR / "THIRD_PARTY_NOTICES.txt",
    ROOT_DIR / "about.txt",
]
SOURCE_EXCLUDED_DIRS = {
    ".debug",
    ".git",
    ".idea",
    ".my",
    ".pnpm-store",
    ".test-output",
    ".tmp",
    ".vscode",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "playwright-report",
    "release",
    "target",
    "test-results",
}
SOURCE_EXCLUDED_SUFFIXES = {
    ".bak",
    ".ilk",
    ".log",
    ".pdb",
    ".profdata",
    ".profraw",
    ".rlib",
    ".rmeta",
    ".swo",
    ".swp",
    ".tmp",
}
SOURCE_EXCLUDED_NAMES = {
    ".DS_Store",
    "Desktop.ini",
    "Thumbs.db",
}


def find_pnpm_command() -> list[str]:
    pnpm = shutil.which("pnpm")
    if pnpm:
        return [pnpm]

    corepack = shutil.which("corepack")
    if corepack:
        return [corepack, "pnpm"]

    raise RuntimeError(
        "pnpm or corepack is required. Install Node.js with Corepack enabled, "
        "or install pnpm and run this script again."
    )


def run_checked(command: list[str], cwd: Path) -> None:
    print(f"> {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def open_directory(path: Path) -> None:
    path = path.resolve()
    system = platform.system()

    if system == "Windows":
        os.startfile(str(path))  # type: ignore[attr-defined]
        return

    if system == "Linux":
        opener = shutil.which("xdg-open") or shutil.which("gio")
        if opener is None:
            print(f"Build output: {path}")
            print("No Linux file manager opener found: xdg-open or gio is required.")
            return

        command = [opener, str(path)]
        if Path(opener).name == "gio":
            command = [opener, "open", str(path)]
        subprocess.Popen(command)
        return

    if system == "Darwin":
        subprocess.Popen(["open", str(path)])
        return

    print(f"Build output: {path}")
    print(f"Opening folders is not implemented for this OS: {system}")


def read_release_version() -> str:
    config_path = ROOT_DIR / "src-tauri" / "tauri.conf.json"
    config = json.loads(config_path.read_text(encoding="utf8"))
    return str(config["version"])


def validate_required_release_files() -> None:
    missing = [path.relative_to(ROOT_DIR) for path in REQUIRED_RELEASE_FILES if not path.exists()]
    if missing:
        names = ", ".join(str(path) for path in missing)
        raise RuntimeError(f"Missing required release files: {names}")


def create_release_artifacts() -> list[Path]:
    version = read_release_version()
    ARTIFACTS_DIR.mkdir(exist_ok=True)

    source_zip = ARTIFACTS_DIR / f"j3markdown-{version}-source.zip"
    binary_zip = ARTIFACTS_DIR / f"j3markdown-{version}-windows-x64.zip"

    create_source_zip(source_zip, version)
    create_windows_binary_zip(binary_zip, version)

    return [source_zip, binary_zip]


def sync_release_resource_files() -> None:
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)

    for file_path in REQUIRED_RELEASE_FILES:
        shutil.copy2(file_path, RELEASE_DIR / file_path.name)


def create_source_zip(archive_path: Path, version: str) -> None:
    prefix = f"j3markdown-{version}-source"

    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for directory, dir_names, file_names in os.walk(ROOT_DIR):
            current_dir = Path(directory)
            relative_dir = current_dir.relative_to(ROOT_DIR)

            dir_names[:] = [
                name for name in dir_names if not should_skip_source_dir(relative_dir / name)
            ]

            for file_name in file_names:
                file_path = current_dir / file_name
                relative_file = file_path.relative_to(ROOT_DIR)

                if should_skip_source_file(relative_file):
                    continue

                archive.write(file_path, Path(prefix) / relative_file)


def create_windows_binary_zip(archive_path: Path, version: str) -> None:
    executable = RELEASE_DIR / "j3markdown.exe"

    if not executable.exists():
        raise RuntimeError(f"Missing release executable: {executable}")

    prefix = f"j3markdown-{version}-windows-x64"

    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(executable, Path(prefix) / executable.name)

        for file_path in REQUIRED_RELEASE_FILES:
            archive.write(file_path, Path(prefix) / file_path.name)


def should_skip_source_dir(relative_dir: Path) -> bool:
    parts = set(relative_dir.parts)

    return bool(parts & SOURCE_EXCLUDED_DIRS) or relative_dir.name.startswith(".tmp")


def should_skip_source_file(relative_file: Path) -> bool:
    if set(relative_file.parts) & SOURCE_EXCLUDED_DIRS:
        return True

    if relative_file.name in SOURCE_EXCLUDED_NAMES:
        return True

    if relative_file.name.endswith("~"):
        return True

    return relative_file.suffix in SOURCE_EXCLUDED_SUFFIXES


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the Tauri release app and open the release binary folder."
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="Build only; do not open the release output folder.",
    )
    return parser.parse_args()


def validate_project_root() -> None:
    required_files = [
        ROOT_DIR / "package.json",
        ROOT_DIR / "pnpm-lock.yaml",
        ROOT_DIR / "src-tauri" / "tauri.conf.json",
        ROOT_DIR / "src-tauri" / "Cargo.toml",
    ]
    missing = [path.relative_to(ROOT_DIR) for path in required_files if not path.exists()]
    if missing:
        names = ", ".join(str(path) for path in missing)
        raise RuntimeError(f"Missing required project files: {names}")


def main() -> int:
    args = parse_args()

    try:
        validate_project_root()
        validate_required_release_files()
        pnpm_command = find_pnpm_command()
        run_checked([*pnpm_command, "run", "tauri:build"], ROOT_DIR)
        sync_release_resource_files()
        artifacts = create_release_artifacts()
    except subprocess.CalledProcessError as error:
        return error.returncode
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if not RELEASE_DIR.exists():
        print(f"error: release output folder was not created: {RELEASE_DIR}", file=sys.stderr)
        return 1

    print(f"Release output: {RELEASE_DIR}")
    for artifact in artifacts:
        print(f"Release artifact: {artifact}")
    if not args.no_open:
        open_directory(ARTIFACTS_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
