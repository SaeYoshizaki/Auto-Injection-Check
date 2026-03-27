import json
from pathlib import Path
from typing import Any, Dict, List

BASELINE_PROMPTS_PATH = Path(__file__).resolve().parents[1] / "data" / "baseline_prompts.json"


def load_baseline_prompt_catalog() -> Dict[str, Any]:
    with BASELINE_PROMPTS_PATH.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    if not isinstance(data, dict):
        raise RuntimeError("baseline_prompts.json must contain an object")

    return data


def _normalize_baseline_entry(raw_entry: Dict[str, Any]) -> Dict[str, Any] | None:
    prompt = str(raw_entry.get("prompt") or "").strip()
    category = str(raw_entry.get("category") or "").strip()
    prompt_id = str(raw_entry.get("id") or "").strip()
    if not prompt or not category or not prompt_id:
        return None

    return {
        "id": prompt_id,
        "prompt": prompt,
        "category": category,
        "source_id": prompt_id,
        "source_mode": "baseline",
        "scan_type": "baseline",
        "evaluation_hint": raw_entry.get("evaluation_hint"),
    }


def get_baseline_prompt_entries(ai_profile: Dict[str, Any] | None) -> List[Dict[str, Any]]:
    catalog = load_baseline_prompt_catalog()
    keys: List[str] = []
    if ai_profile:
        for field in ("name", "ai_name"):
            value = str(ai_profile.get(field) or "").strip()
            if value and value not in keys:
                keys.append(value)

    selected_entries: List[Dict[str, Any]] = []

    prompts = catalog.get("prompts")
    if isinstance(prompts, list):
        for raw_entry in prompts:
            if not isinstance(raw_entry, dict):
                continue
            applies_to = raw_entry.get("applies_to") or ["*"]
            applies_to_values = [
                str(value).strip() for value in applies_to if str(value).strip()
            ]
            if "*" not in applies_to_values and not any(
                key in applies_to_values for key in keys
            ):
                continue
            entry = _normalize_baseline_entry(raw_entry)
            if entry:
                selected_entries.append(entry)
    else:
        common_entries = catalog.get("common") or []
        profile_entries = catalog.get("profiles") or {}

        for raw_entry in common_entries:
            if isinstance(raw_entry, dict):
                entry = _normalize_baseline_entry(raw_entry)
                if entry:
                    selected_entries.append(entry)

        # Legacy format support:
        # flatten all profile-specific prompt groups so every AI runs the whole set.
        if isinstance(profile_entries, dict):
            for raw_entries in profile_entries.values():
                if not isinstance(raw_entries, list):
                    continue
                for raw_entry in raw_entries:
                    if isinstance(raw_entry, dict):
                        entry = _normalize_baseline_entry(raw_entry)
                        if entry:
                            selected_entries.append(entry)

    deduped: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()
    for entry in selected_entries:
        if entry["id"] in seen_ids:
            continue
        seen_ids.add(entry["id"])
        deduped.append(entry)

    return deduped
