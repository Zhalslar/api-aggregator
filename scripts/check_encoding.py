from __future__ import annotations

import argparse
import sys
from pathlib import Path

TEXT_EXTENSIONS = {
    ".py",
    ".md",
    ".toml",
    ".json",
    ".yaml",
    ".yml",
    ".ini",
    ".cfg",
    ".txt",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".sh",
    ".ps1",
    ".bat",
    ".cmd",
    ".xml",
}

DEFAULT_TARGETS = (
    "src",
    "tests",
    "scripts",
    "README.md",
    "README.en.md",
    "pyproject.toml",
)

# Common mojibake fragments seen when UTF-8 Chinese text is mis-decoded/written.
MOJIBAKE_MARKERS = (
    "锛",
    "銆",
    "鏈€",
    "鏄",
    "鎴",
    "鐨",
    "闈",
    "鍚",
    "鎻",
    "璇",
)


def iter_text_files(targets: list[Path]) -> list[Path]:
    files: list[Path] = []
    for target in targets:
        if not target.exists():
            continue
        if target.is_file():
            if target.suffix.lower() in TEXT_EXTENSIONS:
                files.append(target)
            continue
        for path in target.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in TEXT_EXTENSIONS:
                continue
            files.append(path)
    return sorted(set(files))


def looks_like_mojibake(text: str) -> bool:
    marker_hits = sum(text.count(marker) for marker in MOJIBAKE_MARKERS)
    if marker_hits < 6:
        return False
    cjk_count = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    if cjk_count < 30:
        return False
    return marker_hits / max(1, cjk_count) >= 0.08


def check_file(
    path: Path,
    *,
    check_mojibake: bool,
    fail_on_bom: bool,
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    raw = path.read_bytes()

    if raw.startswith(b"\xef\xbb\xbf"):
        if fail_on_bom:
            errors.append("contains UTF-8 BOM")
        else:
            warnings.append("contains UTF-8 BOM")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        errors.append(f"not valid UTF-8 ({exc})")
        return errors, warnings

    if "\ufffd" in text:
        errors.append("contains replacement char U+FFFD")

    if check_mojibake and looks_like_mojibake(text):
        errors.append("looks like mojibake (suspicious CJK fragments)")

    return errors, warnings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check repository text files for UTF-8 encoding issues.",
    )
    parser.add_argument(
        "targets",
        nargs="*",
        help="Files/directories to scan (default: common project paths).",
    )
    parser.add_argument(
        "--no-mojibake-check",
        action="store_true",
        help="Disable heuristic mojibake detection.",
    )
    parser.add_argument(
        "--fail-on-bom",
        action="store_true",
        help="Treat UTF-8 BOM as failure (default: warning only).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target_paths = [Path(item) for item in args.targets] if args.targets else [
        Path(item) for item in DEFAULT_TARGETS
    ]

    files = iter_text_files(target_paths)
    if not files:
        print("No text files matched.")
        return 0

    failures: list[tuple[Path, list[str]]] = []
    warns: list[tuple[Path, list[str]]] = []
    for file in files:
        errors, warnings = check_file(
            file,
            check_mojibake=not args.no_mojibake_check,
            fail_on_bom=args.fail_on_bom,
        )
        if errors:
            failures.append((file, errors))
        if warnings:
            warns.append((file, warnings))

    if not failures:
        print(f"Encoding check passed ({len(files)} files).")
        for file, warnings in warns:
            for warn in warnings:
                print(f"[WARN] {file}: {warn}")
        return 0

    for file, warnings in warns:
        for warn in warnings:
            print(f"[WARN] {file}: {warn}")

    for file, errors in failures:
        for err in errors:
            print(f"[FAIL] {file}: {err}")

    print(f"\nEncoding check failed: {len(failures)} file(s) with issues.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
