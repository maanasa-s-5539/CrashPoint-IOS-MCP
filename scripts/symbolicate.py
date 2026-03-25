#!/usr/bin/env python3
"""
scripts/symbolicate.py

Wraps Xcode's symbolicatecrash tool to symbolicate iOS .crash/.ips files.

Usage:
    python3 scripts/symbolicate.py
        --dsym  /path/to/MyApp.app.dSYM
        --crash /path/to/crashes/        # directory OR single file
        --output /path/to/output/

Outputs a JSON summary to stdout.
"""

import argparse
import json
import os
import subprocess
import sys

SYMBOLICATE_CRASH = (
    "/Applications/Xcode.app/Contents/SharedFrameworks/"
    "DVTFoundation.framework/Versions/A/Resources/symbolicatecrash"
)
DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Symbolicate iOS crash reports using symbolicatecrash."
    )
    parser.add_argument("--dsym", required=True, help="Path to the .dSYM bundle.")
    parser.add_argument(
        "--crash",
        required=True,
        help="Path to a single .crash/.ips file or a directory containing them.",
    )
    parser.add_argument(
        "--output", required=True, help="Directory where symbolicated files are written."
    )
    return parser.parse_args()


def validate_inputs(dsym_path: str, crash_path: str) -> None:
    """Raise SystemExit with a JSON error if any input is invalid."""

    def abort(msg: str) -> None:
        print(json.dumps({"error": msg}), file=sys.stdout)
        sys.exit(1)

    if not os.path.exists(SYMBOLICATE_CRASH):
        abort(f"symbolicatecrash not found at: {SYMBOLICATE_CRASH}")

    if not os.path.exists(dsym_path):
        abort(f"dSYM path does not exist: {dsym_path}")

    dwarf_dir = os.path.join(dsym_path, "Contents", "Resources", "DWARF")
    if not os.path.isdir(dwarf_dir):
        abort(
            f"dSYM bundle is not valid — missing Contents/Resources/DWARF directory: {dsym_path}"
        )

    if not os.path.exists(crash_path):
        abort(f"Crash path does not exist: {crash_path}")


def collect_crash_files(crash_path: str) -> list:
    """Return a list of absolute paths to .crash and .ips files."""
    if os.path.isfile(crash_path):
        ext = os.path.splitext(crash_path)[1].lower()
        if ext in (".crash", ".ips"):
            return [os.path.abspath(crash_path)]
        return []
    # Directory
    results = []
    for entry in sorted(os.listdir(crash_path)):
        ext = os.path.splitext(entry)[1].lower()
        if ext in (".crash", ".ips"):
            results.append(os.path.abspath(os.path.join(crash_path, entry)))
    return results


def symbolicate_file(crash_file: str, dsym_path: str, output_dir: str) -> dict:
    """Run symbolicatecrash on a single file and return a result dict."""
    filename = os.path.basename(crash_file)
    env = os.environ.copy()
    env["DEVELOPER_DIR"] = DEVELOPER_DIR

    try:
        result = subprocess.run(
            [SYMBOLICATE_CRASH, "-d", dsym_path, crash_file],
            capture_output=True,
            text=True,
            env=env,
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            detail = stderr if stderr else f"symbolicatecrash exited with code {result.returncode}"
            return {"file": filename, "success": False, "detail": detail}

        output_path = os.path.join(output_dir, filename)
        with open(output_path, "w", encoding="utf-8") as fh:
            fh.write(result.stdout)

        return {"file": filename, "success": True, "detail": f"Written to {output_path}"}

    except (OSError, subprocess.SubprocessError) as exc:
        return {"file": filename, "success": False, "detail": str(exc)}


def main() -> None:
    args = parse_args()

    dsym_path = os.path.abspath(args.dsym)
    crash_path = os.path.abspath(args.crash)
    output_dir = os.path.abspath(args.output)

    validate_inputs(dsym_path, crash_path)

    crash_files = collect_crash_files(crash_path)
    if not crash_files:
        output = {
            "succeeded": 0,
            "failed": 0,
            "total": 0,
            "results": [],
        }
        print(json.dumps(output, indent=2))
        return

    os.makedirs(output_dir, exist_ok=True)

    results = []
    succeeded = 0
    failed = 0

    for crash_file in crash_files:
        res = symbolicate_file(crash_file, dsym_path, output_dir)
        results.append(res)
        if res["success"]:
            succeeded += 1
        else:
            failed += 1

    output = {
        "succeeded": succeeded,
        "failed": failed,
        "total": len(crash_files),
        "results": results,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
