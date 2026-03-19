import csv
import json
import os
import random
import time
import traceback
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

import logging

import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from config.fixed_prompts import get_prompt_entries, get_prompt_variants
from config.scan_presets import (
    CATEGORY_ORDER,
    build_scan_settings,
    summarize_conversation_mode,
)
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

logger = logging.getLogger(__name__)

INPUT_SELECTOR: str = "textarea[name='message']"
OUTPUT_SELECTOR: str = "div.prose"
DEFAULT_INTERVAL_SECONDS = 1

LOG_ROOT: Path = Path(os.path.dirname(__file__)) / "scan_logs"
LOG_ROOT.mkdir(parents=True, exist_ok=True)

STATUS_PRIORITY: Dict[str, int] = {
    STATUS_SAFE: 1,
    STATUS_ERROR: 2,
    STATUS_WARNING: 3,
    STATUS_DANGEROUS: 4,
}


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
                "source_id": meta.get("source_id"),
                "base_source_id": meta.get("base_source_id"),
                "source_mode": meta.get("source_mode"),
                "variant_type": meta.get("variant_type"),
                "language": meta.get("language"),
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


def allocate_counts(
    total: int,
    distribution: Dict[str, int],
    keys: tuple[str, ...] | List[str],
) -> Dict[str, int]:
    if total <= 0:
        return {key: 0 for key in keys}

    raw_counts = {
        key: (total * distribution.get(key, 0)) / 100 for key in keys
    }
    counts = {key: int(raw_counts[key]) for key in keys}
    remaining = total - sum(counts.values())
    remainders = sorted(
        keys,
        key=lambda key: (raw_counts[key] - counts[key], -list(keys).index(key)),
        reverse=True,
    )
    for key in remainders[:remaining]:
        counts[key] += 1
    return counts


def stable_entry_key(entry: Dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(entry.get("source_id") or ""),
        str(entry.get("base_source_id") or ""),
        str(entry.get("variant_type") or ""),
        str(entry.get("prompt") or ""),
    )


def stable_sort_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(entries, key=stable_entry_key)


def load_base_entries(category: str, set_types: tuple[str, ...]) -> List[Dict[str, Any]]:
    entries = get_prompt_entries(categories=[category], set_types=set_types)
    if entries:
        return stable_sort_entries(entries)
    return stable_sort_entries(
        load_prompt_entries_by_category(category, limit=200, set_types=set_types)
    )


def load_variant_map(category: str, set_types: tuple[str, ...]) -> Dict[str, List[Dict[str, Any]]]:
    variants = get_prompt_variants(categories=[category], set_types=set_types)
    variant_map: Dict[str, List[Dict[str, Any]]] = {}
    for entry in variants:
        base_source_id = entry.get("base_source_id")
        if not base_source_id:
            continue
        variant_map.setdefault(base_source_id, []).append(entry)
    for base_source_id, grouped_entries in variant_map.items():
        variant_map[base_source_id] = stable_sort_entries(grouped_entries)
    return variant_map


def select_category_prompts(
    category: str,
    target_count: int,
    settings: Dict[str, Any],
) -> List[Dict[str, Any]]:
    if target_count <= 0:
        return []

    set_types = tuple(settings["set_types"])
    variants_per_base = int(settings["variants_per_base"])
    base_entries = load_base_entries(category, set_types)
    if not base_entries:
        return []

    variant_map = load_variant_map(category, set_types)
    selected: List[Dict[str, Any]] = []

    for base_entry in base_entries:
        bundle = [base_entry]
        variants = variant_map.get(base_entry.get("source_id") or "", [])
        bundle.extend(variants[: max(0, variants_per_base - 1)])
        for entry in bundle:
            selected.append(entry)
            if len(selected) >= target_count:
                return selected

    if len(selected) >= target_count:
        return selected[:target_count]

    fallback_pool = list(base_entries)
    while len(selected) < target_count and fallback_pool:
        selected.append(fallback_pool[len(selected) % len(fallback_pool)])

    return selected[:target_count]


def build_scan_cases(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    counts = allocate_counts(
        int(settings["total_limit"]),
        settings["category_distribution"],
        CATEGORY_ORDER,
    )

    prompt_entries: List[Dict[str, Any]] = []
    for category in CATEGORY_ORDER:
        prompt_entries.extend(
            select_category_prompts(category, counts[category], settings)
        )

    prompt_entries = prompt_entries[: int(settings["total_limit"])]
    prompt_entries = stable_sort_entries(prompt_entries)

    conversation_counts = allocate_counts(
        len(prompt_entries),
        settings["conversation_mode_distribution"],
        [DEFAULT_CONVERSATION_MODE, "conversational"],
    )

    mode = settings["mode"]
    conversation_modes: List[str] = []
    for conversation_mode in [DEFAULT_CONVERSATION_MODE, "conversational"]:
        conversation_modes.extend(
            [conversation_mode] * conversation_counts.get(conversation_mode, 0)
        )
    while len(conversation_modes) < len(prompt_entries):
        conversation_modes.append(DEFAULT_CONVERSATION_MODE)

    return [
        {
            "id": f"{mode}-{idx + 1}",
            "prompt": entry["prompt"],
            "category": entry["category"],
            "set_type": entry.get("set_type"),
            "conversation_mode": conversation_modes[idx],
            "source_id": entry.get("source_id"),
            "base_source_id": entry.get("base_source_id"),
            "source_mode": entry.get("source_mode"),
            "variant_type": entry.get("variant_type"),
            "language": entry.get("language"),
        }
        for idx, entry in enumerate(prompt_entries)
    ]


def maybe_shuffle_cases(
    cases: List[Dict[str, Any]],
    seed: int | None,
    shuffle_enabled: bool,
) -> List[Dict[str, Any]]:
    copied_cases = list(cases)
    if not shuffle_enabled:
        return copied_cases

    rng = random.Random(seed) if seed is not None else random.Random()
    rng.shuffle(copied_cases)
    return copied_cases


def write_summary_files(
    log_dir: Path,
    scan_settings: Dict[str, Any],
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
        "mode": scan_settings["mode"],
        "requested_mode": scan_settings["requested_mode"],
        "conversation_mode": summarize_conversation_mode(
            scan_settings["conversation_mode_distribution"]
        ),
        "conversation_mode_distribution": scan_settings["conversation_mode_distribution"],
        "ai_profile": scan_settings.get("ai_profile"),
        "rounds": scan_settings["rounds"],
        "total_limit": scan_settings["total_limit"],
        "variants_per_base": scan_settings["variants_per_base"],
        "shuffle_enabled": scan_settings["shuffle_enabled"],
        "seed": scan_settings.get("seed"),
        "category_distribution": scan_settings["category_distribution"],
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
    mode: str = "standard",
    is_random: bool | None = None,
    conversation_mode: str | None = DEFAULT_CONVERSATION_MODE,
    scan_overrides: Dict[str, Any] | None = None,
    ai_profile: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    try:
        if conversation_mode:
            normalize_conversation_mode(conversation_mode)

        scan_settings = build_scan_settings(
            mode=mode,
            overrides=scan_overrides,
            conversation_mode=conversation_mode,
            shuffle_enabled=is_random,
        )
        scan_settings["ai_profile"] = ai_profile
        interval = DEFAULT_INTERVAL_SECONDS
        rounds = int(scan_settings["rounds"])
        conversation_mode_summary = summarize_conversation_mode(
            scan_settings["conversation_mode_distribution"]
        )

        prompt_metadata = maybe_shuffle_cases(
            build_scan_cases(scan_settings),
            scan_settings.get("seed"),
            bool(scan_settings["shuffle_enabled"]),
        )
        timestamp = int(time.time())
        log_dir = ensure_log_dir(scan_settings["mode"], conversation_mode_summary, timestamp)

        per_prompt_history: Dict[str, List[Dict[str, Any]]] = {
            meta["id"]: [] for meta in prompt_metadata
        }

        logger.info("ai_profile in run_scan_process: %s", ai_profile)

        resolved_space_name = (ai_profile or {}).get("space_name") or ""
        resolved_project_name = (ai_profile or {}).get("project_name") or ""
        resolved_ai_name = (ai_profile or {}).get("ai_name") or ""

        logger.info(
            "Resolved navigation targets: space_name=%s project_name=%s ai_name=%s",
            resolved_space_name,
            resolved_project_name,
            resolved_ai_name,
        )

        driver = WebChatDriver(
            url,
            INPUT_SELECTOR,
            OUTPUT_SELECTOR,
            headless=False,
            space_name=resolved_space_name,
            project_name=resolved_project_name,
            ai_name=resolved_ai_name,
        )
        logger.info("run_scan_process started")
        logger.info("INPUT_SELECTOR=%s", INPUT_SELECTOR)
        logger.info("OUTPUT_SELECTOR=%s", OUTPUT_SELECTOR)
        logger.info("rounds=%s prompt_count=%s interval=%s", rounds, len(prompt_metadata), interval)
        if ai_profile:
            logger.info("AI profile selected: %s", ai_profile.get("name"))

        try:
            driver.start()
            if not resolved_space_name or not resolved_project_name or not resolved_ai_name:
                raise RuntimeError(
                    f"navigation targets are missing: "
                    f"space_name={resolved_space_name!r}, "
                    f"project_name={resolved_project_name!r}, "
                    f"ai_name={resolved_ai_name!r}, "
                    f"ai_profile={ai_profile!r}"
                )
            driver.login(org, username, password)
            logger.info("driver.login completed")
            error_streak = 0

            for round_number in range(1, rounds + 1):
                round_entries: List[Dict[str, Any]] = []
                for meta in prompt_metadata:
                    prompt_text = meta["prompt"]
                    logger.info(
                        "round=%s prompt_id=%s category=%s conversation_mode=%s start",
                        round_number,
                        meta["id"],
                        meta["category"],
                        meta["conversation_mode"],
                    )
                    t0 = time.time()
                    try:
                        response = driver.send_prompt(
                            prompt_text,
                            conversation_mode=meta["conversation_mode"],
                        )
                        logger.info(
                            "round=%s prompt_id=%s response_received length=%s preview=%s",
                            round_number,
                            meta["id"],
                            len(response or ""),
                            (response or "")[:120].replace("\n", " "),
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
                        logger.exception(
                            "round=%s prompt_id=%s driver exception: %s",
                            round_number,
                            meta["id"],
                            exc,
                        )
                        error_streak += 1
                        entry_status = STATUS_ERROR
                        entry_reason = "driver exception"
                        entry_response = str(exc)

                    history_item: Dict[str, Any] = {
                        "prompt_id": meta["id"],
                        "prompt": prompt_text,
                        "category": meta["category"],
                        "set_type": meta.get("set_type"),
                        "conversation_mode": meta["conversation_mode"],
                        "round": round_number,
                        "status": entry_status,
                        "response": entry_response,
                        "reason": entry_reason,
                    }

                    per_prompt_history[meta["id"]].append(history_item)
                    round_entries.append(history_item)
                    logger.info(
                        "round=%s prompt_id=%s status=%s error_streak=%s",
                        round_number,
                        meta["id"],
                        entry_status,
                        error_streak,
                    )

                    if error_streak >= 5:
                        raise Exception("Too many consecutive errors.")

                    dt = time.time() - t0
                    logger.info(
                        "round=%s prompt_id=%s elapsed=%.2f sleep=%.2f",
                        round_number,
                        meta["id"],
                        dt,
                        max(interval - dt, 0),
                    )
                    if interval - dt > 0:
                        time.sleep(interval - dt)

                write_round_log(log_dir, round_number, round_entries)

        finally:
            driver.close()

        aggregated_results = build_aggregated_results(per_prompt_history, prompt_metadata)
        summary_json, summary_csv = write_summary_files(
            log_dir,
            scan_settings,
            aggregated_results,
        )

        if aggregated_results:
            report_path = log_dir / f"scan_report_{scan_settings['mode']}_{timestamp}.pdf"
            generate_report(aggregated_results, str(report_path), ai_profile=ai_profile)
            return {
                "status": "completed",
                "mode": scan_settings["mode"],
                "requested_mode": scan_settings["requested_mode"],
                "conversation_mode": conversation_mode_summary,
                "conversation_mode_distribution": scan_settings["conversation_mode_distribution"],
                "ai_profile": ai_profile,
                "scan_settings": {
                    "total_limit": scan_settings["total_limit"],
                    "rounds": scan_settings["rounds"],
                    "variants_per_base": scan_settings["variants_per_base"],
                    "category_distribution": scan_settings["category_distribution"],
                    "shuffle_enabled": scan_settings["shuffle_enabled"],
                    "seed": scan_settings.get("seed"),
                    "ai_profile": ai_profile,
                },
                "report_file": str(report_path),
                "summary_json": str(summary_json),
                "summary_csv": str(summary_csv),
                "log_dir": str(log_dir),
                "results": aggregated_results,
            }

        return {"status": "failed", "error": "no results", "ai_profile": ai_profile}

    except Exception:
        traceback.print_exc()
        return {"status": "failed", "error": "init crash", "ai_profile": ai_profile}