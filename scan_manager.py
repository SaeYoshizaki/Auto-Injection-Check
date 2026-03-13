import csv
import json
import os
import time
import traceback
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from config.fixed_prompts import get_prompt_entries_for_mode
from garak_adapter.probe_loader import load_prompt_entries_by_category
from garak_adapter.custom_driver import WebChatDriver
from report_generator import (
    evaluate_response,
    generate_report,
    normalize_status,
    STATUS_DANGEROUS,
    STATUS_ERROR,
    STATUS_SAFE,
    STATUS_WARNING,
)

DEFAULT_CONVERSATION_MODE = "clean_chat"
CONVERSATION_MODES = {DEFAULT_CONVERSATION_MODE, "conversational"}

CATEGORY_DISTRIBUTION: Dict[str, float] = {
    "prompt_injection": 0.35,
    "jailbreak": 0.20,
    "output_handling": 0.15,
    "excessive_agency": 0.10,
    "miscellaneous": 0.20,
}

SCAN_CONFIG: Dict[str, Dict[str, int]] = {
    "smoke": {"limit": 2, "interval": 5, "rounds": 1},
    "risk_discovery": {"limit": 120, "interval": 240, "rounds": 3},
    "stability_audit": {"limit": 120, "interval": 240, "rounds": 3},
    "full_assessment": {"limit": 300, "interval": 240, "rounds": 5},
}

INPUT_SELECTOR: str = "form textarea"
OUTPUT_SELECTOR: str = ".mr-auto"

LOG_ROOT: Path = Path(os.path.dirname(__file__)) / "scan_logs"
LOG_ROOT.mkdir(parents=True, exist_ok=True)

STATUS_PRIORITY: Dict[str, int] = {
    STATUS_SAFE: 1,
    STATUS_ERROR: 2,
    STATUS_WARNING: 3,
    STATUS_DANGEROUS: 4,
}


def get_weighted_prompts(
    total_limit: int,
    is_random: bool = True,
    mode: str = "smoke",
) -> List[Dict[str, Any]]:
    if not is_random:
        return get_prompt_entries_for_mode(mode, limit=total_limit)

    all_prompts: List[Dict[str, Any]] = []
    mode_entries = get_prompt_entries_for_mode(mode)
    set_types = sorted(
        {
            entry["set_type"]
            for entry in mode_entries
            if entry.get("set_type")
        }
    )
    source_modes = None
    if mode in SCAN_CONFIG and not set_types:
        source_modes = [mode]

    for category, weight in CATEGORY_DISTRIBUTION.items():
        limit = max(1, int(total_limit * weight))
        entries = load_prompt_entries_by_category(
            category,
            limit=limit,
            set_types=set_types or None,
            source_modes=source_modes,
        )
        all_prompts.extend(entries)

    return all_prompts[:total_limit]


def normalize_conversation_mode(conversation_mode: str) -> str:
    normalized = (conversation_mode or DEFAULT_CONVERSATION_MODE).strip()
    if normalized not in CONVERSATION_MODES:
        raise ValueError(f"Unsupported conversation mode: {conversation_mode}")
    return normalized


def ensure_log_dir(mode: str, conversation_mode: str, timestamp: int) -> Path:
    target = LOG_ROOT / mode / conversation_mode / str(timestamp)
    target.mkdir(parents=True, exist_ok=True)
    return target


def determine_final_status(statuses: List[str]) -> str:
    normalized = [normalize_status(status) for status in statuses]

    if STATUS_DANGEROUS in normalized:
        return STATUS_DANGEROUS
    if STATUS_WARNING in normalized:
        return STATUS_WARNING
    if all(status == STATUS_ERROR for status in normalized):
        return STATUS_ERROR
    if STATUS_ERROR in normalized and STATUS_SAFE in normalized:
        return STATUS_WARNING

    return STATUS_SAFE


def pick_worst_round(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    return sorted(
        history,
        key=lambda entry: STATUS_PRIORITY.get(entry.get("status", STATUS_WARNING), 0),
        reverse=True,
    )[0]


def build_aggregated_results(
    history_map: Dict[str, List[Dict[str, Any]]],
    metadata: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    aggregated: List[Dict[str, Any]] = []

    for meta in metadata:
        history = history_map.get(meta["id"], [])
        if not history:
            continue

        statuses = [entry["status"] for entry in history]
        final_status = determine_final_status(statuses)
        worst_round = pick_worst_round(history)
        counter = Counter(statuses)
        error_rounds = counter.get(STATUS_ERROR, 0)

        aggregated.append(
            {
                "prompt_id": meta["id"],
                "prompt": meta["prompt"],
                "category": meta["category"],
                "set_type": meta.get("set_type"),
                "conversation_mode": meta["conversation_mode"],
                "status": final_status,
                "response": worst_round.get("response", ""),
                "reason": worst_round.get("reason", ""),
                "rounds": len(history),
                "round_statuses": dict(counter),
                "worst_round": worst_round.get("round"),
                "had_error": error_rounds > 0,
                "error_rounds": error_rounds,
            }
        )

    return aggregated


def write_round_log(log_dir: Path, round_number: int, entries: List[Dict[str, Any]]) -> Path:
    path = log_dir / f"round-{round_number}.json"
    with path.open("w", encoding="utf-8") as fh:
        json.dump(entries, fh, ensure_ascii=False, indent=2)
    return path


def format_status_counts(status_counts: Dict[str, int]) -> str:
    ordered = [STATUS_DANGEROUS, STATUS_WARNING, STATUS_ERROR, STATUS_SAFE]
    return ";".join(f"{status}:{status_counts.get(status, 0)}" for status in ordered)


def write_summary_files(
    log_dir: Path,
    mode: str,
    conversation_mode: str,
    rounds: int,
    aggregated: List[Dict[str, Any]],
) -> tuple[Path, Path]:
    if aggregated:
        overall_status = determine_final_status([entry["status"] for entry in aggregated])
    else:
        overall_status = STATUS_ERROR

    prompt_summaries = [
        {
            "prompt_id": entry["prompt_id"],
            "category": entry["category"],
            "set_type": entry.get("set_type"),
            "conversation_mode": entry["conversation_mode"],
            "final_status": entry["status"],
            "rounds": entry["rounds"],
            "round_statuses": entry["round_statuses"],
            "worst_round": entry["worst_round"],
            "had_error": entry["had_error"],
            "error_rounds": entry["error_rounds"],
        }
        for entry in aggregated
    ]

    summary = {
        "mode": mode,
        "conversation_mode": conversation_mode,
        "rounds": rounds,
        "overall_status": overall_status,
        "prompt_count": len(prompt_summaries),
        "prompt_summaries": prompt_summaries,
    }

    json_path = log_dir / "summary.json"
    with json_path.open("w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2)

    csv_path = log_dir / "summary.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "prompt_id",
                "category",
                "set_type",
                "conversation_mode",
                "final_status",
                "rounds",
                "round_statuses",
                "had_error",
                "error_rounds",
            ]
        )
        for entry in aggregated:
            writer.writerow(
                [
                    entry["prompt_id"],
                    entry["category"],
                    entry.get("set_type"),
                    entry["conversation_mode"],
                    entry["status"],
                    entry["rounds"],
                    format_status_counts(entry["round_statuses"]),
                    entry["had_error"],
                    entry["error_rounds"],
                ]
            )

    return json_path, csv_path


def run_scan_process(
    url: str,
    org: str,
    username: str,
    password: str,
    mode: str = "smoke",
    is_random: bool = False,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> Dict[str, Any]:
    try:
        normalized_conversation_mode = normalize_conversation_mode(conversation_mode)
        if mode not in SCAN_CONFIG:
            raise ValueError(f"Unsupported scan mode: {mode}")
        conf = SCAN_CONFIG[mode]
        interval = conf["interval"]
        total_limit = conf["limit"]
        rounds = conf.get("rounds", 1)

        prompts = get_weighted_prompts(total_limit, is_random, mode)
        timestamp = int(time.time())
        log_dir = ensure_log_dir(mode, normalized_conversation_mode, timestamp)

        prompt_metadata = [
            {
                "id": f"{mode}-{idx + 1}",
                "prompt": entry["prompt"],
                "category": entry["category"],
                "set_type": entry.get("set_type"),
                "conversation_mode": normalized_conversation_mode,
            }
            for idx, entry in enumerate(prompts)
        ]

        per_prompt_history: Dict[str, List[Dict[str, Any]]] = {
            meta["id"]: [] for meta in prompt_metadata
        }

        driver = WebChatDriver(url, INPUT_SELECTOR, OUTPUT_SELECTOR, headless=False)

        try:
            driver.start()
            driver.login(org, username, password)
            error_streak = 0

            for round_number in range(1, rounds + 1):
                round_entries: List[Dict[str, Any]] = []
                for meta in prompt_metadata:
                    prompt_text = meta["prompt"]
                    t0 = time.time()
                    try:
                        response = driver.send_prompt(
                            prompt_text,
                            conversation_mode=normalized_conversation_mode,
                        )
                        if not response:
                            error_streak += 1
                            entry_status = STATUS_ERROR
                            entry_reason = "no response"
                            entry_response = response or ""
                        elif "[Error]" in response:
                            error_streak += 1
                            entry_status = STATUS_ERROR
                            entry_reason = (
                                "timeout"
                                if "Timeout" in response
                                else "target returned error"
                            )
                            entry_response = response
                        else:
                            error_streak = 0
                            eval_result = evaluate_response(prompt_text, response)
                            entry_status = normalize_status(eval_result.get("status"))
                            entry_reason = eval_result.get("reason", "")
                            entry_response = response
                    except Exception as exc:
                        error_streak += 1
                        entry_status = STATUS_ERROR
                        entry_reason = "driver exception"
                        entry_response = str(exc)

                    history_item: Dict[str, Any] = {
                        "prompt_id": meta["id"],
                        "prompt": prompt_text,
                        "category": meta["category"],
                        "set_type": meta.get("set_type"),
                        "conversation_mode": normalized_conversation_mode,
                        "round": round_number,
                        "status": entry_status,
                        "response": entry_response,
                        "reason": entry_reason,
                    }

                    per_prompt_history[meta["id"]].append(history_item)
                    round_entries.append(history_item)

                    if error_streak >= 5:
                        raise Exception("Too many consecutive errors.")

                    dt = time.time() - t0
                    if interval - dt > 0:
                        time.sleep(interval - dt)

                write_round_log(log_dir, round_number, round_entries)

        finally:
            driver.close()

        aggregated_results = build_aggregated_results(per_prompt_history, prompt_metadata)
        summary_json, summary_csv = write_summary_files(
            log_dir,
            mode,
            normalized_conversation_mode,
            rounds,
            aggregated_results,
        )

        if aggregated_results:
            report_path = log_dir / f"scan_report_{mode}_{timestamp}.pdf"
            generate_report(aggregated_results, str(report_path))
            return {
                "status": "completed",
                "conversation_mode": normalized_conversation_mode,
                "report_file": str(report_path),
                "summary_json": str(summary_json),
                "summary_csv": str(summary_csv),
                "log_dir": str(log_dir),
                "results": aggregated_results,
            }

        return {"status": "failed", "error": "no results"}

    except Exception:
        traceback.print_exc()
        return {"status": "failed", "error": "init crash"}
