#!/usr/bin/env python3
"""Regenerate SelfControlBlocklist-DeepWork.selfcontrol from sites.txt.

Usage:
    python3 update_blocklist.py [sites_file] [blocklist_file]

Edit sites.txt (one domain per line, '#' starts a comment, blank lines
ignored) and re-run this script. It rewrites the .selfcontrol plist that
selfcontrol-focus.sh (and the SelfControl GUI) reads.

Important SelfControl limitation: a block that is already running has its
blocklist locked in at start time. Running this script does NOT change an
active block -- it only affects the next block that is started after this
file is saved.
"""
import plistlib
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_SITES_FILE = SCRIPT_DIR / "sites.txt"
DEFAULT_BLOCKLIST_FILE = SCRIPT_DIR / "SelfControlBlocklist-DeepWork.selfcontrol"


def parse_sites(sites_file: Path) -> list[str]:
    domains: list[str] = []
    seen: set[str] = set()
    with sites_file.open("r", encoding="utf-8") as f:
        for lineno, raw_line in enumerate(f, start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if " " in line or "/" in line or "://" in line:
                print(f"  skipping invalid entry on line {lineno}: {line!r}", file=sys.stderr)
                continue
            if line not in seen:
                seen.add(line)
                domains.append(line)
    return domains


def load_existing_flags(blocklist_file: Path) -> tuple[bool, list[str]]:
    if not blocklist_file.exists():
        return False, []
    with blocklist_file.open("rb") as f:
        data = plistlib.load(f)
    return bool(data.get("BlockAsWhitelist", False)), list(data.get("HostBlacklist", []))


def warn_if_block_active() -> None:
    try:
        result = subprocess.run(
            ["selfcontrol-cli", "is-running"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return
    # selfcontrol-cli writes YES/NO via NSLog to stderr, not stdout.
    if "YES" in (result.stdout + result.stderr):
        print(
            "NOTE: a SelfControl block is currently active. This update will "
            "NOT affect it -- SelfControl locks in the blocklist at start time. "
            "It will take effect on the next block that starts.",
            file=sys.stderr,
        )


def main() -> int:
    sites_file = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SITES_FILE
    blocklist_file = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_BLOCKLIST_FILE

    if not sites_file.exists():
        print(f"sites file not found: {sites_file}", file=sys.stderr)
        return 1

    warn_if_block_active()

    new_domains = parse_sites(sites_file)
    if not new_domains:
        print("No valid domains found in sites file -- aborting, not overwriting blocklist.", file=sys.stderr)
        return 1

    block_as_whitelist, old_domains = load_existing_flags(blocklist_file)

    if blocklist_file.exists():
        backup_path = blocklist_file.with_name(
            f"{blocklist_file.stem}.{datetime.now():%Y%m%d-%H%M%S}.bak"
        )
        shutil.copy2(blocklist_file, backup_path)
        print(f"Backed up existing blocklist to {backup_path.name}")

    with blocklist_file.open("wb") as f:
        plistlib.dump(
            {"BlockAsWhitelist": block_as_whitelist, "HostBlacklist": new_domains},
            f,
            fmt=plistlib.FMT_XML,
        )

    added = sorted(set(new_domains) - set(old_domains))
    removed = sorted(set(old_domains) - set(new_domains))

    print(f"Wrote {blocklist_file} with {len(new_domains)} domains.")
    if added:
        print(f"  added ({len(added)}): {', '.join(added[:20])}" + (" ..." if len(added) > 20 else ""))
    if removed:
        print(f"  removed ({len(removed)}): {', '.join(removed[:20])}" + (" ..." if len(removed) > 20 else ""))
    if not added and not removed and old_domains:
        print("  no changes vs previous list")

    return 0


if __name__ == "__main__":
    sys.exit(main())
