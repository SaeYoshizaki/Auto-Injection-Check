from __future__ import annotations

import shutil
import sys
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = ("scan_logs", "comparison_sessions", "job_cache")


def copy_tree_if_exists(source: Path, target: Path) -> None:
    if not source.exists():
        return
    shutil.copytree(source, target, dirs_exist_ok=True)


def main() -> int:
    snapshot_name = (
        sys.argv[1].strip()
        if len(sys.argv) > 1 and sys.argv[1].strip()
        else f"final_release_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    )

    snapshot_root = REPO_ROOT / "snapshots" / snapshot_name
    data_root = snapshot_root / "data"
    data_root.mkdir(parents=True, exist_ok=True)

    for dir_name in SOURCE_DIRS:
        copy_tree_if_exists(REPO_ROOT / dir_name, data_root / dir_name)

    readme = snapshot_root / "README.txt"
    readme.write_text(
        "\n".join(
            [
                f"Snapshot: {snapshot_name}",
                "",
                "This snapshot contains a fixed copy of:",
                "- scan_logs",
                "- comparison_sessions",
                "- job_cache",
                "",
                "Run backend against this frozen data:",
                f"REPORT_DATA_ROOT={data_root} uvicorn server:app --reload",
                "",
                "Then open the frontend as usual.",
                "You can keep editing frontend CSS and UI without changing this snapshot data.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    print(snapshot_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
