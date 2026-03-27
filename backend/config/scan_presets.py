from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict

from config.fixed_prompts import (
    SET_TYPE_HIGH_RISK,
    SET_TYPE_REPRESENTATIVE,
    SET_TYPE_STABILITY,
)

DEFAULT_SCAN_MODE = "standard"

CATEGORY_ORDER = (
    "prompt_injection",
    "jailbreak",
    "output_handling",
    "excessive_agency",
    "miscellaneous",
)

CONVERSATION_MODE_ORDER = ("clean_chat", "conversational")

CATEGORY_LABELS: Dict[str, str] = {
    "prompt_injection": "プロンプトインジェクション",
    "jailbreak": "ジェイルブレイク",
    "output_handling": "危険出力",
    "excessive_agency": "過剰な権限の乱用",
    "miscellaneous": "その他",
}

CONVERSATION_MODE_LABELS: Dict[str, str] = {
    "clean_chat": "clean_chat",
    "conversational": "conversational",
}

SCAN_PRESET_CONFIGS: Dict[str, Dict[str, Any]] = {
    "standard": {
        "label": "標準スキャン",
        "description": "attack prompt 全件と baseline prompt 全件をまとめて実行します",
        "total_limit": 1,
        "rounds": 1,
        "variants_per_base": 1,
        "conversation_mode_distribution": {
            "clean_chat": 70,
            "conversational": 30,
        },
        "category_distribution": {
            "prompt_injection": 25,
            "jailbreak": 20,
            "output_handling": 20,
            "excessive_agency": 25,
            "miscellaneous": 10,
        },
        "shuffle_enabled": True,
        "seed": None,
        "set_types": (SET_TYPE_REPRESENTATIVE, SET_TYPE_HIGH_RISK),
    },
}

# Legacy presets kept here for easy restoration.
# "test": {
#     "label": "テスト実行",
#     "description": "3件だけ実行して動作確認します",
#     "total_limit": 3,
#     "rounds": 1,
#     "variants_per_base": 1,
#     "conversation_mode_distribution": {
#         "clean_chat": 100,
#         "conversational": 0,
#     },
#     "category_distribution": {
#         "prompt_injection": 34,
#         "jailbreak": 33,
#         "output_handling": 33,
#         "excessive_agency": 0,
#         "miscellaneous": 0,
#     },
#     "shuffle_enabled": True,
#     "seed": None,
#     "set_types": (SET_TYPE_REPRESENTATIVE,),
# },
# "light": {
#     "label": "簡単スキャン",
#     "description": "短時間でざっと確認します",
#     "total_limit": 20,
#     "rounds": 1,
#     "variants_per_base": 1,
#     "conversation_mode_distribution": {
#         "clean_chat": 80,
#         "conversational": 20,
#     },
#     "category_distribution": {
#         "prompt_injection": 30,
#         "jailbreak": 25,
#         "output_handling": 15,
#         "excessive_agency": 20,
#         "miscellaneous": 10,
#     },
#     "shuffle_enabled": True,
#     "seed": None,
#     "set_types": (SET_TYPE_REPRESENTATIVE,),
# },
# "full": {
#     "label": "フルスキャン",
#     "description": "より多くの攻撃パターンで詳しく確認します",
#     "total_limit": 200,
#     "rounds": 3,
#     "variants_per_base": 3,
#     "conversation_mode_distribution": {
#         "clean_chat": 50,
#         "conversational": 50,
#     },
#     "category_distribution": {
#         "prompt_injection": 25,
#         "jailbreak": 20,
#         "output_handling": 20,
#         "excessive_agency": 25,
#         "miscellaneous": 10,
#     },
#     "shuffle_enabled": True,
#     "seed": None,
#     "set_types": (
#         SET_TYPE_REPRESENTATIVE,
#         SET_TYPE_HIGH_RISK,
#         SET_TYPE_STABILITY,
#     ),
# },

LEGACY_MODE_ALIASES: Dict[str, str] = {
    "risk_discovery": "standard",
    "stability_audit": "standard",
    # "smoke": "light",
    # "full_assessment": "full",
}


def _copy_settings(config: Dict[str, Any]) -> Dict[str, Any]:
    return deepcopy(config)


def list_primary_scan_modes() -> list[str]:
    return list(SCAN_PRESET_CONFIGS.keys())


def get_allowed_scan_modes() -> set[str]:
    return set(SCAN_PRESET_CONFIGS) | set(LEGACY_MODE_ALIASES)


def resolve_scan_mode(mode: str | None) -> str:
    normalized = (mode or DEFAULT_SCAN_MODE).strip()
    if normalized in SCAN_PRESET_CONFIGS:
        return normalized
    if normalized in LEGACY_MODE_ALIASES:
        return LEGACY_MODE_ALIASES[normalized]
    raise ValueError(f"Unsupported scan mode: {mode}")


def _normalize_distribution(
    raw_distribution: Dict[str, Any] | None,
    keys: tuple[str, ...],
    label: str,
) -> Dict[str, int]:
    if raw_distribution is None:
        raise ValueError(f"{label} is required")

    normalized: Dict[str, int] = {}
    for key in keys:
        value = raw_distribution.get(key, 0)
        try:
            normalized[key] = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid value for {label}: {key}") from exc
        if normalized[key] < 0:
            raise ValueError(f"Negative value for {label}: {key}")

    total = sum(normalized.values())
    if total != 100:
        raise ValueError(f"{label} must sum to 100")

    return normalized


def get_scan_preset(mode: str | None = None) -> Dict[str, Any]:
    resolved_mode = resolve_scan_mode(mode)
    preset = _copy_settings(SCAN_PRESET_CONFIGS[resolved_mode])
    preset["mode"] = resolved_mode
    return preset


def build_scan_settings(
    mode: str | None = None,
    overrides: Dict[str, Any] | None = None,
    conversation_mode: str | None = None,
    shuffle_enabled: bool | None = None,
) -> Dict[str, Any]:
    requested_mode = (mode or DEFAULT_SCAN_MODE).strip()
    settings = get_scan_preset(requested_mode)
    settings["requested_mode"] = requested_mode

    overrides = overrides or {}

    for key in ("total_limit", "rounds", "variants_per_base"):
        if key in overrides and overrides[key] is not None:
            settings[key] = int(overrides[key])

    if "seed" in overrides:
        seed_value = overrides["seed"]
        settings["seed"] = None if seed_value in ("", None) else int(seed_value)

    if "shuffle_enabled" in overrides and overrides["shuffle_enabled"] is not None:
        settings["shuffle_enabled"] = bool(overrides["shuffle_enabled"])
    elif shuffle_enabled is not None:
        settings["shuffle_enabled"] = bool(shuffle_enabled)

    if "category_distribution" in overrides and overrides["category_distribution"] is not None:
        settings["category_distribution"] = _normalize_distribution(
            overrides["category_distribution"],
            CATEGORY_ORDER,
            "category_distribution",
        )

    if (
        "conversation_mode_distribution" in overrides
        and overrides["conversation_mode_distribution"] is not None
    ):
        settings["conversation_mode_distribution"] = _normalize_distribution(
            overrides["conversation_mode_distribution"],
            CONVERSATION_MODE_ORDER,
            "conversation_mode_distribution",
        )
    elif conversation_mode:
        if conversation_mode not in CONVERSATION_MODE_ORDER:
            raise ValueError(f"Unsupported conversation mode: {conversation_mode}")
        settings["conversation_mode_distribution"] = {
            key: 100 if key == conversation_mode else 0
            for key in CONVERSATION_MODE_ORDER
        }

    if settings["total_limit"] <= 0:
        raise ValueError("total_limit must be greater than 0")
    if settings["rounds"] <= 0:
        raise ValueError("rounds must be greater than 0")
    if settings["variants_per_base"] <= 0:
        raise ValueError("variants_per_base must be greater than 0")

    return settings


def summarize_conversation_mode(
    conversation_mode_distribution: Dict[str, int],
) -> str:
    enabled = [
        key
        for key in CONVERSATION_MODE_ORDER
        if conversation_mode_distribution.get(key, 0) > 0
    ]
    if len(enabled) == 1:
        return enabled[0]
    return "mixed"


def export_scan_options() -> Dict[str, Any]:
    return {
        "default_mode": DEFAULT_SCAN_MODE,
        "modes": [
            {
                "key": mode,
                "label": config["label"],
                "description": config["description"],
                "recommended": mode == DEFAULT_SCAN_MODE,
                "settings": {
                    "total_limit": config["total_limit"],
                    "rounds": config["rounds"],
                    "variants_per_base": config["variants_per_base"],
                    "category_distribution": deepcopy(config["category_distribution"]),
                    "conversation_mode_distribution": deepcopy(
                        config["conversation_mode_distribution"]
                    ),
                    "shuffle_enabled": config["shuffle_enabled"],
                    "seed": config["seed"],
                },
            }
            for mode, config in SCAN_PRESET_CONFIGS.items()
        ],
        "category_labels": CATEGORY_LABELS,
        "conversation_mode_labels": CONVERSATION_MODE_LABELS,
    }
