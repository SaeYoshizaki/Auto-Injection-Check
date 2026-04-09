import csv
import json
import logging
import os
import random
import sys
import time
import traceback
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List
from datetime import datetime, timezone

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from config.baseline_prompts import get_baseline_prompt_entries
from config.fixed_prompts import get_prompt_entries, get_prompt_variants
from config.scan_presets import CATEGORY_ORDER, build_scan_settings, summarize_conversation_mode
from garak_adapter.custom_driver import WebChatDriver
from garak_adapter.probe_loader import load_prompt_entries_by_category
from report_generator import (
    BASELINE_STATUS_ERROR,
    BASELINE_STATUS_FAIL,
    BASELINE_STATUS_PASS,
    BASELINE_STATUS_SOFT_FAIL,
    SCAN_TYPE_ATTACK_CORE,
    SCAN_TYPE_ATTACK_INJECTION,
    SCAN_TYPE_ATTACK_SURFACE,
    SCAN_TYPE_ATTACK_ONLY,
    SCAN_TYPE_BASELINE_ONLY,
    SCAN_TYPE_FULL,
    SECTION_ATTACK,
    SECTION_BASELINE,
    STATUS_DANGEROUS,
    STATUS_ERROR,
    STATUS_SAFE,
    STATUS_WARNING,
    evaluate_attack_response,
    evaluate_baseline_response,
    generate_report,
    generate_comparison_report,
    normalize_status,
)

DEFAULT_CONVERSATION_MODE = "clean_chat"
CONVERSATION_MODES = {DEFAULT_CONVERSATION_MODE, "conversational"}
INPUT_SELECTOR = "textarea[name='message']"
OUTPUT_SELECTOR = "div.prose"
DEFAULT_INTERVAL_SECONDS = 5

DATA_ROOT = Path(os.getenv("REPORT_DATA_ROOT", os.path.dirname(__file__))).resolve()
LOG_ROOT = DATA_ROOT / "scan_logs"
LOG_ROOT.mkdir(parents=True, exist_ok=True)
COMPARISON_ROOT = DATA_ROOT / "comparison_sessions"
COMPARISON_ROOT.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)


def comparison_session_path() -> Path:
    return COMPARISON_ROOT / "active_session.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _flatten_results_for_comparison(profile_name: str, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    flattened: List[Dict[str, Any]] = []
    for section in [SECTION_BASELINE, SECTION_ATTACK]:
        for entry in payload.get(section, {}).get("results", []):
            flattened.append(
                {
                    "section": section,
                    "prompt_id": entry.get("prompt_id"),
                    "source_id": entry.get("source_id"),
                    "source_mode": entry.get("source_mode"),
                    "base_source_id": entry.get("base_source_id"),
                    "category": entry.get("category"),
                    "language": entry.get("language"),
                    "prompt": entry.get("prompt"),
                    "response": entry.get("response"),
                    "status": entry.get("status"),
                    "reason": entry.get("reason"),
                    "rounds": entry.get("rounds"),
                    "worst_round": entry.get("worst_round"),
                    "round_statuses": entry.get("round_statuses", {}),
                    "violated_rules": entry.get("violated_rules", []),
                    "profile_name": profile_name,
                }
            )
    return flattened


def _merge_flattened_results(
    existing_results: List[Dict[str, Any]],
    new_results: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    merged: Dict[tuple[str, str], Dict[str, Any]] = {}
    for entry in existing_results:
        merged[(str(entry.get("section") or ""), str(entry.get("prompt_id") or ""))] = dict(entry)
    for entry in new_results:
        merged[(str(entry.get("section") or ""), str(entry.get("prompt_id") or ""))] = dict(entry)
    return sorted(
        merged.values(),
        key=lambda entry: (str(entry.get("section") or ""), str(entry.get("prompt_id") or "")),
    )


def get_attack_categories_for_scan_type(scan_type: str) -> List[str]:
    mapping = {
        SCAN_TYPE_ATTACK_CORE: ["excessive_agency", "jailbreak"],
        SCAN_TYPE_ATTACK_SURFACE: ["miscellaneous", "output_handling"],
        SCAN_TYPE_ATTACK_INJECTION: ["prompt_injection"],
        SCAN_TYPE_ATTACK_ONLY: list(CATEGORY_ORDER),
        SCAN_TYPE_FULL: list(CATEGORY_ORDER),
    }
    return mapping.get(scan_type, [])


def save_comparison_session_result(
    *,
    payload: Dict[str, Any],
    ai_profile: Dict[str, Any] | None,
    target_url: str,
    conversation_mode: str,
    job_id: str | None = None,
    judge_model: str = "gpt-4o",
) -> Path:
    path = comparison_session_path()
    if path.exists():
        session_data = json.loads(path.read_text(encoding="utf-8"))
    else:
        session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        session_data = {
            "session_id": session_id,
            "created_at": _now_iso(),
            "scan_type": payload.get("scan_type"),
            "prompt_set_version": "current",
            "target_url": target_url,
            "conversation_mode": conversation_mode,
            "judge_model": judge_model,
            "profiles": [],
        }

    profile_name = str((ai_profile or {}).get("name") or "unknown")
    flattened_results = _flatten_results_for_comparison(profile_name, payload)
    profile_entry = {
        "profile_id": str((ai_profile or {}).get("ai_name") or profile_name),
        "profile_name": profile_name,
        "job_id": job_id,
        "ai_profile": ai_profile or {},
        "results": flattened_results,
        "updated_at": _now_iso(),
    }

    profiles: List[Dict[str, Any]] = []
    replaced = False
    for entry in session_data.get("profiles", []):
        if entry.get("profile_name") != profile_name:
            profiles.append(entry)
            continue
        merged_entry = dict(entry)
        merged_entry["results"] = _merge_flattened_results(
            list(entry.get("results") or []),
            flattened_results,
        )
        merged_entry["ai_profile"] = ai_profile or entry.get("ai_profile") or {}
        merged_entry["job_id"] = job_id or entry.get("job_id")
        merged_entry["updated_at"] = _now_iso()
        profiles.append(merged_entry)
        replaced = True
    if not replaced:
        profiles.append(profile_entry)
    session_data["profiles"] = profiles
    previous_scan_type = str(session_data.get("scan_type") or "")
    current_scan_type = str(payload.get("scan_type") or "")
    session_data["scan_type"] = (
        current_scan_type
        if not previous_scan_type or previous_scan_type == current_scan_type
        else "mixed"
    )
    session_data["target_url"] = target_url
    session_data["conversation_mode"] = conversation_mode
    session_data["judge_model"] = judge_model
    path.write_text(json.dumps(session_data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def generate_comparison_report_from_session() -> Dict[str, Any]:
    path = comparison_session_path()
    if not path.exists():
        raise RuntimeError("comparison session json not found")
    session_data = json.loads(path.read_text(encoding="utf-8"))
    timestamp = int(time.time())
    report_path = COMPARISON_ROOT / f"comparison_report_{timestamp}.pdf"
    generate_comparison_report(session_data, str(report_path))
    return {
        "session_json": str(path),
        "report_file": str(report_path),
        "session_id": session_data.get("session_id"),
        "profile_count": len(session_data.get("profiles", [])),
    }

SECTION_PRIORITY: Dict[str, Dict[str, int]] = {
    SECTION_ATTACK: {
        STATUS_SAFE: 1,
        STATUS_ERROR: 2,
        STATUS_WARNING: 3,
        STATUS_DANGEROUS: 4,
    },
    SECTION_BASELINE: {
        BASELINE_STATUS_PASS: 1,
        BASELINE_STATUS_ERROR: 2,
        BASELINE_STATUS_SOFT_FAIL: 3,
        BASELINE_STATUS_FAIL: 4,
    },
}


def normalize_conversation_mode(conversation_mode: str) -> str:
    normalized = (conversation_mode or DEFAULT_CONVERSATION_MODE).strip()
    if normalized not in CONVERSATION_MODES:
        raise ValueError(f"Unsupported conversation mode: {conversation_mode}")
    return normalized


def ensure_log_dir(scan_type: str, mode: str, conversation_mode: str, timestamp: int) -> Path:
    target = LOG_ROOT / scan_type / mode / conversation_mode / str(timestamp)
    target.mkdir(parents=True, exist_ok=True)
    return target


def stable_entry_key(entry: Dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(entry.get("source_id") or ""),
        str(entry.get("base_source_id") or ""),
        str(entry.get("variant_type") or ""),
        str(entry.get("prompt") or ""),
    )


def stable_sort_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(entries, key=stable_entry_key)


def allocate_counts(total: int, distribution: Dict[str, int], keys: tuple[str, ...] | List[str]) -> Dict[str, int]:
    if total <= 0:
        return {key: 0 for key in keys}
    raw_counts = {key: (total * distribution.get(key, 0)) / 100 for key in keys}
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


def load_base_entries(category: str, set_types: tuple[str, ...]) -> List[Dict[str, Any]]:
    entries = get_prompt_entries(categories=[category], set_types=set_types)
    if entries:
        return stable_sort_entries(entries)
    return stable_sort_entries(load_prompt_entries_by_category(category, limit=200, set_types=set_types))


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


def select_category_prompts(category: str, target_count: int, settings: Dict[str, Any]) -> List[Dict[str, Any]]:
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
        bundle.extend(variant_map.get(base_entry.get("source_id") or "", [])[: max(0, variants_per_base - 1)])
        for entry in bundle:
            selected.append(entry)
            if len(selected) >= target_count:
                return selected
    return selected[:target_count]


def build_attack_cases(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    selected_categories = list(settings.get("selected_categories") or CATEGORY_ORDER)
    if settings["mode"] == "standard":
        prompt_entries = stable_sort_entries(get_prompt_entries(categories=selected_categories))
        settings["total_limit"] = len(prompt_entries)
        settings["rounds"] = 1
        settings["variants_per_base"] = 1
    else:
        # Legacy preset behavior for sampled attack scans.
        # counts = allocate_counts(
        #     int(settings["total_limit"]),
        #     settings["category_distribution"],
        #     CATEGORY_ORDER,
        # )
        # prompt_entries = []
        # for category in CATEGORY_ORDER:
        #     prompt_entries.extend(select_category_prompts(category, counts[category], settings))
        counts = allocate_counts(int(settings["total_limit"]), settings["category_distribution"], CATEGORY_ORDER)
        prompt_entries = []
        for category in selected_categories:
            prompt_entries.extend(select_category_prompts(category, counts[category], settings))
        prompt_entries = stable_sort_entries(prompt_entries[: int(settings["total_limit"])])

    conversation_counts = allocate_counts(
        len(prompt_entries),
        settings["conversation_mode_distribution"],
        [DEFAULT_CONVERSATION_MODE, "conversational"],
    )

    conversation_modes: List[str] = []
    for conversation_mode in [DEFAULT_CONVERSATION_MODE, "conversational"]:
        conversation_modes.extend([conversation_mode] * conversation_counts.get(conversation_mode, 0))
    while len(conversation_modes) < len(prompt_entries):
        conversation_modes.append(DEFAULT_CONVERSATION_MODE)

    mode = settings["mode"]
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


def build_baseline_cases(ai_profile: Dict[str, Any] | None, conversation_mode: str) -> List[Dict[str, Any]]:
    entries = get_baseline_prompt_entries(ai_profile)
    return [
        {
            "id": entry["id"],
            "prompt": entry["prompt"],
            "category": entry["category"],
            "conversation_mode": conversation_mode,
            "source_id": entry.get("source_id"),
            "source_mode": entry.get("source_mode"),
            "language": entry.get("language"),
            "evaluation_hint": entry.get("evaluation_hint"),
        }
        for entry in entries
    ]


def maybe_shuffle_cases(cases: List[Dict[str, Any]], seed: int | None, shuffle_enabled: bool) -> List[Dict[str, Any]]:
    copied_cases = list(cases)
    if not shuffle_enabled:
        return copied_cases
    rng = random.Random(seed) if seed is not None else random.Random()
    rng.shuffle(copied_cases)
    return copied_cases


def determine_final_status(statuses: List[str], section: str) -> str:
    normalized = [normalize_status(status, section) for status in statuses]
    if section == SECTION_BASELINE:
        if BASELINE_STATUS_FAIL in normalized:
            return BASELINE_STATUS_FAIL
        if BASELINE_STATUS_SOFT_FAIL in normalized:
            return BASELINE_STATUS_SOFT_FAIL
        if all(status == BASELINE_STATUS_ERROR for status in normalized):
            return BASELINE_STATUS_ERROR
        if BASELINE_STATUS_ERROR in normalized and BASELINE_STATUS_PASS in normalized:
            return BASELINE_STATUS_SOFT_FAIL
        return BASELINE_STATUS_PASS
    if STATUS_DANGEROUS in normalized:
        return STATUS_DANGEROUS
    if STATUS_WARNING in normalized:
        return STATUS_WARNING
    if all(status == STATUS_ERROR for status in normalized):
        return STATUS_ERROR
    if STATUS_ERROR in normalized and STATUS_SAFE in normalized:
        return STATUS_WARNING
    return STATUS_SAFE


def build_aggregated_results(
    history_map: Dict[str, List[Dict[str, Any]]],
    metadata: List[Dict[str, Any]],
    section: str,
) -> List[Dict[str, Any]]:
    aggregated: List[Dict[str, Any]] = []
    for meta in metadata:
        history = history_map.get(meta["id"], [])
        if not history:
            continue
        statuses = [entry["status"] for entry in history]
        worst_round = sorted(
            history,
            key=lambda entry: SECTION_PRIORITY[section].get(entry.get("status"), 0),
            reverse=True,
        )[0]
        aggregated.append(
            {
                "prompt_id": meta["id"],
                "prompt": meta["prompt"],
                "category": meta["category"],
                "source_id": meta.get("source_id"),
                "source_mode": meta.get("source_mode"),
                "base_source_id": meta.get("base_source_id"),
                "language": meta.get("language"),
                "conversation_mode": meta["conversation_mode"],
                "status": determine_final_status(statuses, section),
                "response": worst_round.get("response", ""),
                "reason": worst_round.get("reason", ""),
                "violated_rules": worst_round.get("violated_rules", []),
                "evaluation_hint": meta.get("evaluation_hint"),
                "rounds": len(history),
                "round_statuses": dict(Counter(statuses)),
                "worst_round": worst_round.get("round"),
            }
        )
    return aggregated


def write_round_log(log_dir: Path, section: str, round_number: int, entries: List[Dict[str, Any]]) -> Path:
    section_dir = log_dir / section
    section_dir.mkdir(parents=True, exist_ok=True)
    path = section_dir / f"round-{round_number}.json"
    with path.open("w", encoding="utf-8") as fh:
        json.dump(entries, fh, ensure_ascii=False, indent=2)
    return path


def write_summary_files(log_dir: Path, payload: Dict[str, Any]) -> tuple[Path, Path]:
    json_path = log_dir / "summary.json"
    with json_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    csv_path = log_dir / "summary.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "section",
                "prompt_id",
                "category",
                "final_status",
                "rounds",
                "reason",
                "violated_rules",
                "intent",
                "risk",
                "expected_difference",
            ]
        )
        for section in [SECTION_BASELINE, SECTION_ATTACK]:
            for entry in payload.get(section, {}).get("results", []):
                hint = entry.get("evaluation_hint") or {}
                writer.writerow(
                    [
                        section,
                        entry.get("prompt_id"),
                        entry.get("category"),
                        entry.get("status"),
                        entry.get("rounds"),
                        entry.get("reason"),
                        "|".join(entry.get("violated_rules") or []),
                        hint.get("intent", ""),
                        hint.get("risk", ""),
                        json.dumps(hint.get("expected_difference", ""), ensure_ascii=False),
                    ]
                )
    return json_path, csv_path


def build_attack_settings(
    mode: str,
    is_random: bool | None,
    conversation_mode: str | None,
    scan_overrides: Dict[str, Any] | None,
    ai_profile: Dict[str, Any] | None,
    scan_type: str,
) -> Dict[str, Any]:
    settings = build_scan_settings(
        mode=mode,
        overrides=scan_overrides,
        conversation_mode=conversation_mode,
        shuffle_enabled=is_random,
    )
    settings["ai_profile"] = ai_profile
    settings["selected_categories"] = get_attack_categories_for_scan_type(scan_type)
    return settings


def build_baseline_settings(conversation_mode: str | None, ai_profile: Dict[str, Any] | None) -> Dict[str, Any]:
    resolved_mode = normalize_conversation_mode(conversation_mode or DEFAULT_CONVERSATION_MODE)
    return {
        "mode": "baseline",
        "requested_mode": "baseline",
        "ai_profile": ai_profile,
        "rounds": 1,
        "total_limit": 0,
        "variants_per_base": 1,
        "shuffle_enabled": False,
        "seed": None,
        "category_distribution": {},
        "conversation_mode_distribution": {
            key: 100 if key == resolved_mode else 0
            for key in [DEFAULT_CONVERSATION_MODE, "conversational"]
        },
    }


def execute_section(
    driver: WebChatDriver,
    section: str,
    cases: List[Dict[str, Any]],
    log_dir: Path,
    ai_profile: Dict[str, Any] | None,
    rounds: int = 1,
) -> List[Dict[str, Any]]:
    per_prompt_history: Dict[str, List[Dict[str, Any]]] = {case["id"]: [] for case in cases}
    error_streak = 0

    for round_number in range(1, rounds + 1):
        round_entries: List[Dict[str, Any]] = []
        for meta in cases:
            prompt_text = meta["prompt"]
            try:
                response = driver.send_prompt(prompt_text, conversation_mode=meta["conversation_mode"])
                if not response:
                    status = BASELINE_STATUS_ERROR if section == SECTION_BASELINE else STATUS_ERROR
                    reason = "no response"
                    response_text = ""
                    violated_rules = ["evaluation_unavailable"] if section == SECTION_BASELINE else []
                    error_streak += 1
                elif "[Error]" in response:
                    status = BASELINE_STATUS_ERROR if section == SECTION_BASELINE else STATUS_ERROR
                    reason = "timeout" if "Timeout" in response else "target returned error"
                    response_text = response
                    violated_rules = ["evaluation_unavailable"] if section == SECTION_BASELINE else []
                    error_streak += 1
                else:
                    error_streak = 0
                    if section == SECTION_BASELINE:
                        result = evaluate_baseline_response(
                            profile_name=str((ai_profile or {}).get("name") or ""),
                            prompt=prompt_text,
                            category=meta["category"],
                            response=response,
                            ai_profile=ai_profile,
                            evaluation_hint=meta.get("evaluation_hint"),
                        )
                    else:
                        result = evaluate_attack_response(prompt_text, response, meta["category"])
                    status = normalize_status(result.get("status"), section)
                    reason = str(result.get("reason", ""))
                    response_text = response
                    violated_rules = list(result.get("violated_rules") or [])
            except Exception as exc:
                logger.exception("section=%s prompt_id=%s exception=%s", section, meta["id"], exc)
                status = BASELINE_STATUS_ERROR if section == SECTION_BASELINE else STATUS_ERROR
                reason = "driver exception"
                response_text = str(exc)
                violated_rules = ["evaluation_unavailable"] if section == SECTION_BASELINE else []
                error_streak += 1

            history_item = {
                "prompt_id": meta["id"],
                "prompt": prompt_text,
                "category": meta["category"],
                "round": round_number,
                "status": status,
                "response": response_text,
                "reason": reason,
                "violated_rules": violated_rules,
                "evaluation_hint": meta.get("evaluation_hint"),
            }
            per_prompt_history[meta["id"]].append(history_item)
            round_entries.append(history_item)

            if error_streak >= 10:
                raise RuntimeError("Too many consecutive errors.")
            time.sleep(DEFAULT_INTERVAL_SECONDS)

        write_round_log(log_dir, section, round_number, round_entries)

    return build_aggregated_results(per_prompt_history, cases, section)


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
    scan_type: str = SCAN_TYPE_ATTACK_ONLY,
    job_id: str | None = None,
) -> Dict[str, Any]:
    try:
        if conversation_mode:
            normalize_conversation_mode(conversation_mode)

        run_baseline = scan_type in {SCAN_TYPE_BASELINE_ONLY, SCAN_TYPE_FULL}
        run_attack = scan_type in {
            SCAN_TYPE_ATTACK_ONLY,
            SCAN_TYPE_FULL,
            SCAN_TYPE_ATTACK_CORE,
            SCAN_TYPE_ATTACK_SURFACE,
            SCAN_TYPE_ATTACK_INJECTION,
        }

        attack_settings = build_attack_settings(
            mode,
            is_random,
            conversation_mode,
            scan_overrides,
            ai_profile,
            scan_type,
        )
        baseline_settings = build_baseline_settings(conversation_mode, ai_profile)
        conversation_mode_summary = summarize_conversation_mode(attack_settings["conversation_mode_distribution"])
        timestamp = int(time.time())
        log_dir = ensure_log_dir(scan_type, attack_settings["mode"], conversation_mode_summary, timestamp)

        resolved_space_name = (ai_profile or {}).get("space_name") or ""
        resolved_project_name = (ai_profile or {}).get("project_name") or ""
        resolved_ai_name = (ai_profile or {}).get("ai_name") or ""

        driver = WebChatDriver(
            url,
            INPUT_SELECTOR,
            OUTPUT_SELECTOR,
            headless=False,
            space_name=resolved_space_name,
            project_name=resolved_project_name,
            ai_name=resolved_ai_name,
        )

        try:
            driver.start()
            if not resolved_space_name or not resolved_project_name or not resolved_ai_name:
                raise RuntimeError(
                    f"navigation targets are missing: space_name={resolved_space_name!r}, "
                    f"project_name={resolved_project_name!r}, ai_name={resolved_ai_name!r}"
                )
            driver.login(org, username, password)

            baseline_results: List[Dict[str, Any]] = []
            attack_results: List[Dict[str, Any]] = []

            if run_baseline:
                baseline_cases = build_baseline_cases(ai_profile, summarize_conversation_mode(baseline_settings["conversation_mode_distribution"]))
                baseline_settings["total_limit"] = len(baseline_cases)
                baseline_results = execute_section(driver, SECTION_BASELINE, baseline_cases, log_dir, ai_profile, rounds=1)

            if run_attack:
                attack_cases = maybe_shuffle_cases(
                    build_attack_cases(attack_settings),
                    attack_settings.get("seed"),
                    bool(attack_settings["shuffle_enabled"]),
                )
                attack_results = execute_section(
                    driver,
                    SECTION_ATTACK,
                    attack_cases,
                    log_dir,
                    ai_profile,
                    rounds=int(attack_settings["rounds"]),
                )
        finally:
            driver.close()

        payload: Dict[str, Any] = {
            "status": "completed",
            "scan_type": scan_type,
            "mode": attack_settings["mode"],
            "requested_mode": attack_settings["requested_mode"],
            "conversation_mode": conversation_mode_summary,
            "ai_profile": ai_profile,
            SECTION_BASELINE: {
                "profile_name": (ai_profile or {}).get("name"),
                "results": baseline_results,
                "status_counts": {
                    "PASS": sum(1 for item in baseline_results if item["status"] == BASELINE_STATUS_PASS),
                    "SOFT_FAIL": sum(1 for item in baseline_results if item["status"] == BASELINE_STATUS_SOFT_FAIL),
                    "FAIL": sum(1 for item in baseline_results if item["status"] == BASELINE_STATUS_FAIL),
                    "ERROR": sum(1 for item in baseline_results if item["status"] == BASELINE_STATUS_ERROR),
                },
            },
            SECTION_ATTACK: {
                "results": attack_results,
                "status_counts": {
                    "SAFE": sum(1 for item in attack_results if item["status"] == STATUS_SAFE),
                    "WARNING": sum(1 for item in attack_results if item["status"] == STATUS_WARNING),
                    "DANGEROUS": sum(1 for item in attack_results if item["status"] == STATUS_DANGEROUS),
                    "ERROR": sum(1 for item in attack_results if item["status"] == STATUS_ERROR),
                },
            },
            "scan_settings": {
                "attack": {
                    "total_limit": attack_settings["total_limit"],
                    "rounds": attack_settings["rounds"],
                    "variants_per_base": attack_settings["variants_per_base"],
                    "category_distribution": attack_settings["category_distribution"],
                    "selected_categories": attack_settings.get("selected_categories", []),
                    "shuffle_enabled": attack_settings["shuffle_enabled"],
                    "seed": attack_settings.get("seed"),
                },
                "baseline": {
                    "total_limit": len(baseline_results),
                    "rounds": 1,
                },
            },
        }

        summary_json, summary_csv = write_summary_files(log_dir, payload)
        report_path = log_dir / f"{scan_type}_report_{timestamp}.pdf"
        generate_report(payload, str(report_path), ai_profile=ai_profile)
        comparison_session = save_comparison_session_result(
            payload=payload,
            ai_profile=ai_profile,
            target_url=url,
            conversation_mode=conversation_mode_summary,
            job_id=job_id,
        )

        payload["summary_json"] = str(summary_json)
        payload["summary_csv"] = str(summary_csv)
        payload["report_file"] = str(report_path)
        payload["log_dir"] = str(log_dir)
        payload["comparison_session_json"] = str(comparison_session)
        return payload
    except Exception as exc:
        traceback.print_exc()
        return {
            "status": "failed",
            "scan_type": scan_type,
            "error": str(exc) or "init crash",
            "ai_profile": ai_profile,
        }
