#!/usr/bin/env python3
"""Build the Tauri release bundle and open the binary output folder."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
RELEASE_DIR = ROOT_DIR / "src-tauri" / "target" / "release"


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
        pnpm_command = find_pnpm_command()
        run_checked([*pnpm_command, "run", "tauri:build"], ROOT_DIR)
    except subprocess.CalledProcessError as error:
        return error.returncode
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if not RELEASE_DIR.exists():
        print(f"error: release output folder was not created: {RELEASE_DIR}", file=sys.stderr)
        return 1

    print(f"Release output: {RELEASE_DIR}")
    if not args.no_open:
        open_directory(RELEASE_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
