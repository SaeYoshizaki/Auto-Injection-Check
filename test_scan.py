import argparse
import json
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from config.fixed_prompts import get_prompt_entries, get_prompt_entries_for_mode
from report_generator import evaluate_response, normalize_status

STATUS_PRIORITY = {
    "SAFE": 1,
    "ERROR": 2,
    "WARNING": 3,
    "DANGEROUS": 4,
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="smoke")
    parser.add_argument("--set-type")
    parser.add_argument("--limit", type=int, default=3)
    return parser.parse_args()


def load_entries(mode: str, set_type: str | None, limit: int):
    if set_type:
        return get_prompt_entries(set_types=[set_type], limit=limit)
    return get_prompt_entries_for_mode(mode, limit=limit)


def build_sample_history(entries, mode: str):
    metadata = []
    history_map = {}

    for index, entry in enumerate(entries, start=1):
        prompt_id = f"{mode}-{index}"
        metadata.append(
            {
                "id": prompt_id,
                "prompt": entry["prompt"],
                "category": entry["category"],
                "set_type": entry.get("set_type"),
            }
        )
        response = "I cannot help with that request."
        evaluation = evaluate_response(entry["prompt"], response)
        history_map[prompt_id] = [
            {
                "prompt_id": prompt_id,
                "prompt": entry["prompt"],
                "category": entry["category"],
                "set_type": entry.get("set_type"),
                "round": 1,
                "status": normalize_status(evaluation.get("status")),
                "response": response,
                "reason": evaluation.get("reason", ""),
            }
        ]

    return metadata, history_map


def determine_final_status(statuses):
    normalized = [normalize_status(status) for status in statuses]
    if "DANGEROUS" in normalized:
        return "DANGEROUS"
    if "WARNING" in normalized:
        return "WARNING"
    if all(status == "ERROR" for status in normalized):
        return "ERROR"
    if "ERROR" in normalized and "SAFE" in normalized:
        return "WARNING"
    return "SAFE"


def build_aggregated_results(history_map, metadata):
    aggregated = []
    for meta in metadata:
        history = history_map.get(meta["id"], [])
        if not history:
            continue
        statuses = [entry["status"] for entry in history]
        worst_round = sorted(
            history,
            key=lambda entry: STATUS_PRIORITY.get(entry.get("status", "WARNING"), 0),
            reverse=True,
        )[0]
        round_statuses = {}
        for status in statuses:
            round_statuses[status] = round_statuses.get(status, 0) + 1
        error_rounds = round_statuses.get("ERROR", 0)
        aggregated.append(
            {
                "prompt_id": meta["id"],
                "prompt": meta["prompt"],
                "category": meta["category"],
                "set_type": meta.get("set_type"),
                "status": determine_final_status(statuses),
                "response": worst_round.get("response", ""),
                "reason": worst_round.get("reason", ""),
                "rounds": len(history),
                "round_statuses": round_statuses,
                "worst_round": worst_round.get("round"),
                "had_error": error_rounds > 0,
                "error_rounds": error_rounds,
            }
        )
    return aggregated


def main():
    args = parse_args()
    entries = load_entries(args.mode, args.set_type, args.limit)
    if not entries:
        raise SystemExit("no prompt entries found")

    metadata, history_map = build_sample_history(entries, args.mode)
    aggregated = build_aggregated_results(history_map, metadata)
    if not aggregated:
        raise SystemExit("aggregation failed")

    payload = {
        "mode": args.mode,
        "requested_set_type": args.set_type,
        "prompt_count": len(entries),
        "prompt_set_types": sorted(
            {entry.get("set_type") for entry in entries if entry.get("set_type")}
        ),
        "evaluation_sample": {
            "status": aggregated[0]["status"],
            "reason": aggregated[0]["reason"],
        },
        "aggregated_sample": aggregated[0],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
