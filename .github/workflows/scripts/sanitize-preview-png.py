#!/usr/bin/env python3
"""Trusted PNG sanitizer for the UI preview pipeline.

This script runs inside an independent, network-disabled container after every
untrusted container has stopped and replaces whatever the untrusted capture
container wrote with a set it fully controls: only the registered view filenames,
each a regular single-link file within the per-file budget, fully decoded and
re-encoded from a fresh RGB/RGBA buffer so no ancillary chunk, palette,
interlaced scan, or trailing payload survives, and within the total size budget.

Usage:
    sanitize-preview-png.py --dir <dir> --expected <expected.json>

`expected.json` is generated from the trusted view registry:
    {"views": [{"filename": "taco-desktop.png", "width": 1280, "height": 800}, ...]}
"""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import tempfile

from PIL import Image, ImageFile, UnidentifiedImageError

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 24 * 1024 * 1024
# Pillow refuses to allocate a decoded image larger than this many pixels. Views
# are at most 1280x800, so anything above 2x the registered area is a bomb.
PIXEL_BUDGET_NUMERATOR = 2


class SanitizerError(Exception):
    """Raised for every rejection; the caller exits non-zero and publishes nothing."""


def load_expectations(path: str) -> dict[str, tuple[int, int]]:
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    views = payload.get("views")
    if not isinstance(views, list) or not views:
        raise SanitizerError(f"{path}: expected a non-empty 'views' array")

    expectations: dict[str, tuple[int, int]] = {}
    for view in views:
        filename = view["filename"]
        width = int(view["width"])
        height = int(view["height"])
        if width <= 0 or height <= 0:
            raise SanitizerError(f"{path}: view {filename} has a non-positive size")
        if filename in expectations:
            raise SanitizerError(f"{path}: duplicate view filename {filename}")
        expectations[filename] = (width, height)
    return expectations


def assert_only_expected_entries(directory: str, expected: set[str]) -> None:
    with os.scandir(directory) as entries:
        present = sorted(entry.name for entry in entries)

    unexpected = [name for name in present if name not in expected]
    if unexpected:
        # Entry names are attacker-controlled; escape anything that could start a
        # new log line before reporting them.
        shown = ", ".join(
            "".join(char if " " <= char <= "~" else f"\\x{ord(char):02x}" for char in name)
            for name in unexpected
        )
        raise SanitizerError(f"unexpected entries in the capture output: {shown}")

    missing = [name for name in sorted(expected) if name not in present]
    if missing:
        raise SanitizerError(f"missing registered views in the capture output: {', '.join(missing)}")


def sanitize_one(path: str, filename: str, width: int, height: int) -> tuple[int, int]:
    info = os.lstat(path)
    if stat.S_ISLNK(info.st_mode):
        raise SanitizerError(f"{filename}: refusing a symbolic link")
    if not stat.S_ISREG(info.st_mode):
        raise SanitizerError(f"{filename}: not a regular file")
    if info.st_nlink != 1:
        raise SanitizerError(f"{filename}: refusing a hard-linked file (nlink={info.st_nlink})")
    if info.st_size <= 0 or info.st_size > MAX_FILE_BYTES:
        raise SanitizerError(f"{filename}: size {info.st_size} outside 0 < size <= {MAX_FILE_BYTES}")

    Image.MAX_IMAGE_PIXELS = max(width * height * PIXEL_BUDGET_NUMERATOR, 1024)

    try:
        with Image.open(path) as probe:
            if probe.format != "PNG":
                raise SanitizerError(f"{filename}: not a PNG (decoder reported {probe.format})")
            if probe.size != (width, height):
                raise SanitizerError(
                    f"{filename}: expected {width}x{height}, decoded {probe.size[0]}x{probe.size[1]}"
                )
            if getattr(probe, "n_frames", 1) != 1:
                raise SanitizerError(f"{filename}: multi-frame image rejected")
            has_alpha = "A" in probe.getbands() or "transparency" in probe.info
            probe.load()
            mode = "RGBA" if has_alpha else "RGB"
            clean = Image.new(mode, (width, height))
            clean.paste(probe.convert(mode))
    except SanitizerError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as err:
        raise SanitizerError(f"{filename}: decode failed: {err}") from err

    handle = tempfile.NamedTemporaryFile(
        dir=os.path.dirname(path), prefix=".sanitize-", suffix=".tmp", delete=False
    )
    temporary_path = handle.name
    handle.close()
    try:
        clean.save(temporary_path, format="PNG", compress_level=9)
        os.chmod(temporary_path, 0o644)
        os.replace(temporary_path, path)
    except BaseException:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)
        raise

    final_size = os.lstat(path).st_size
    if final_size <= 0 or final_size > MAX_FILE_BYTES:
        raise SanitizerError(f"{filename}: sanitized size {final_size} outside the byte budget")

    return info.st_size, final_size


def sanitize_directory(directory: str, expectation_path: str) -> list[tuple[str, int, int]]:
    if not os.path.isdir(directory):
        raise SanitizerError(f"output directory not found: {directory}")

    expectations = load_expectations(expectation_path)
    assert_only_expected_entries(directory, set(expectations))

    results: list[tuple[str, int, int]] = []
    for filename, (width, height) in expectations.items():
        before, after = sanitize_one(os.path.join(directory, filename), filename, width, height)
        results.append((filename, before, after))

    total = 0
    for filename in expectations:
        info = os.lstat(os.path.join(directory, filename))
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise SanitizerError(f"{filename}: sanitized output is not a single-link regular file")
        total += info.st_size
    if total > MAX_TOTAL_BYTES:
        raise SanitizerError(f"sanitized total {total} exceeds the budget {MAX_TOTAL_BYTES}")

    return results


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Sanitize captured UI preview PNGs.")
    parser.add_argument("--dir", required=True, help="directory holding the captured PNGs")
    parser.add_argument("--expected", required=True, help="JSON view expectation file")
    args = parser.parse_args(argv)

    try:
        results = sanitize_directory(os.path.abspath(args.dir), os.path.abspath(args.expected))
    except SanitizerError as err:
        print(f"Sanitization failed: {err}", file=sys.stderr)
        return 1

    print(f"Sanitized {len(results)} PNGs:")
    for filename, before, after in results:
        print(f"  - {filename}: {before} -> {after} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
