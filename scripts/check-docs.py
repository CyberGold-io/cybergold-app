#!/usr/bin/env python3
"""Validate authored Markdown without network access or third-party packages."""

from __future__ import annotations

import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {
    ".cache-synpress",
    ".git",
    ".github",
    ".next",
    ".venv",
    "archive",
    "build",
    "cache",
    "dist",
    "fixtures",
    "lib",
    "node_modules",
    "out",
    "playwright-report",
    "test-results",
}
LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
PROGRAM_RECORD = "2026-07-11-documentation-refactoring-consolidation-and-organization-report.md"
REQUIRED_FRONTMATTER_FIELDS = {
    "title",
    "doc_type",
    "status",
    "owner",
    "created",
    "last_reviewed",
    "canonical_for",
}
VALID_STATUSES = {"active", "completed", "superseded", "archived"}
FIXTURE_ROOT = ROOT / "scripts" / "fixtures" / "docs"
TERMINOLOGY_GATE = ROOT / "ci" / "check-terminology.py"
TERMINOLOGY_POLICY = ROOT / "ci" / "terminology-policy.json"
SHARED_TERMINOLOGY_ROOT = ROOT.parent / "cybergold-protocol" / "ci"


def authored_markdown() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*.md")
        if not any(part in EXCLUDED_PARTS for part in path.relative_to(ROOT).parts)
    )


def local_target(source: Path, raw: str) -> Path | None:
    target = raw.strip().strip("<>")
    if not target or target.startswith(("#", "http://", "https://", "mailto:")):
        return None
    target = unquote(target.split("#", 1)[0])
    if not target:
        return None
    resolved = (source.parent / target).resolve()
    try:
        resolved.relative_to(ROOT)
    except ValueError:
        return None
    return resolved


def parse_frontmatter(text: str) -> tuple[dict[str, str], list[str]]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        return {}, ["missing YAML frontmatter"]

    try:
        closing_index = lines.index("---", 1)
    except ValueError:
        return {}, ["unterminated YAML frontmatter"]

    metadata: dict[str, str] = {}
    errors: list[str] = []
    for line in lines[1:closing_index]:
        if not line.strip():
            continue
        match = re.fullmatch(r"([a-z][a-z0-9_]*):\s*(.+)", line)
        if not match:
            errors.append(f"invalid frontmatter line {line!r}")
            continue
        key, value = match.groups()
        if key in metadata:
            errors.append(f"duplicate frontmatter field {key}")
        metadata[key] = value.strip()
    return metadata, errors


def metadata_errors(text: str) -> list[str]:
    metadata, errors = parse_frontmatter(text)
    missing = sorted(REQUIRED_FRONTMATTER_FIELDS - metadata.keys())
    errors.extend(f"missing frontmatter field {field}" for field in missing)

    status = metadata.get("status")
    if status is not None and status not in VALID_STATUSES:
        errors.append(f"invalid frontmatter status {status!r}")

    parsed_dates: dict[str, date] = {}
    for field in ("created", "last_reviewed"):
        value = metadata.get(field)
        if value is None:
            continue
        try:
            parsed_dates[field] = date.fromisoformat(value)
        except ValueError:
            errors.append(f"invalid ISO date in frontmatter field {field}")
    if (
        "created" in parsed_dates
        and "last_reviewed" in parsed_dates
        and parsed_dates["created"] > parsed_dates["last_reviewed"]
    ):
        errors.append("frontmatter created date is after last_reviewed")

    return errors


def validate_metadata_fixtures() -> list[str]:
    fixture_errors: list[str] = []
    valid_errors = metadata_errors(
        (FIXTURE_ROOT / "valid-metadata.md").read_text(encoding="utf-8")
    )
    if valid_errors:
        fixture_errors.append(
            "metadata positive fixture unexpectedly failed: "
            + ", ".join(valid_errors)
        )

    invalid_errors = metadata_errors(
        (FIXTURE_ROOT / "missing-owner.md").read_text(encoding="utf-8")
    )
    if "missing frontmatter field owner" not in invalid_errors:
        fixture_errors.append(
            "metadata negative fixture did not detect the missing owner"
        )
    return fixture_errors


def main() -> int:
    errors = validate_metadata_fixtures()
    if not TERMINOLOGY_GATE.is_file() or not TERMINOLOGY_POLICY.is_file():
        errors.append("missing repository-owned terminology gate or policy")
    else:
        shared_gate = SHARED_TERMINOLOGY_ROOT / TERMINOLOGY_GATE.name
        shared_policy = SHARED_TERMINOLOGY_ROOT / TERMINOLOGY_POLICY.name
        if shared_gate.is_file() and shared_gate.read_bytes() != TERMINOLOGY_GATE.read_bytes():
            errors.append("repository-owned terminology gate differs from the checked-out shared gate")
        if shared_policy.is_file() and shared_policy.read_bytes() != TERMINOLOGY_POLICY.read_bytes():
            errors.append("repository-owned terminology policy differs from the checked-out shared policy")
        terminology = subprocess.run(
            [
                sys.executable,
                str(TERMINOLOGY_GATE),
                "--project-root",
                str(ROOT),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if terminology.returncode != 0:
            details = terminology.stderr.strip() or terminology.stdout.strip()
            errors.append(f"shared terminology gate failed: {details}")
    files = authored_markdown()
    index_targets: set[Path] = set()

    for index in (path for path in files if path.name == "README.md" and "docs" in path.parts):
        for raw in LINK_RE.findall(index.read_text(encoding="utf-8")):
            target = local_target(index, raw)
            if target is not None:
                index_targets.add(target)

    for path in files:
        relative = path.relative_to(ROOT)
        text = path.read_text(encoding="utf-8")
        errors.extend(f"{relative}: {error}" for error in metadata_errors(text))
        if sum(1 for line in text.splitlines() if line.startswith("```")) % 2:
            errors.append(f"{relative}: unbalanced fenced code block")
        if path.name != PROGRAM_RECORD and "/Users/" in text:
            errors.append(f"{relative}: personal absolute path")
        for match in IP_RE.findall(text):
            if not match.startswith("127."):
                errors.append(f"{relative}: concrete IPv4 address {match}")
        for raw in LINK_RE.findall(text):
            target = local_target(path, raw)
            if target is not None and not target.exists():
                errors.append(f"{relative}: broken local link {raw}")

        if "docs" in relative.parts and path.name != "README.md" and path.resolve() not in index_targets:
            errors.append(f"{relative}: not linked from a documentation index")

    if errors:
        print("Authored documentation validation failed:", file=sys.stderr)
        for error in sorted(set(errors)):
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Authored documentation validation passed ({len(files)} files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
