from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sys
import os
import json
from pathlib import Path
import threading
import uuid
from datetime import datetime
from typing import Any, Dict, List
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(__file__)
PROJECT_ROOT = Path(BASE_DIR).resolve().parent
if BASE_DIR not in sys.path:
    sys.path.append(BASE_DIR)

from config.scan_presets import (
    CONVERSATION_MODE_ORDER,
    build_scan_settings,
    export_scan_options,
    get_allowed_scan_modes,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOB_STORE: Dict[str, Dict[str, Any]] = {}
JOB_LOCK = threading.Lock()
ALLOWED_SCAN_MODES = get_allowed_scan_modes()
ALLOWED_CONVERSATION_MODES = set(CONVERSATION_MODE_ORDER)
AI_PROFILES_PATH = os.path.join(BASE_DIR, "ai_profiles.json")
DATA_ROOT = Path(os.getenv("REPORT_DATA_ROOT", PROJECT_ROOT)).resolve()
JOB_CACHE_DIR = DATA_ROOT / "job_cache"
JOB_CACHE_DIR.mkdir(parents=True, exist_ok=True)

def comparison_session_path() -> Path:
    session_dir = DATA_ROOT / "comparison_sessions"
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir / "active_session.json"


class ScanRequest(BaseModel):
    url: str
    scan_type: str = "full_scan"
    mode: str = "standard"
    ai_profile_name: str | None = None
    is_random: bool | None = None
    conversation_mode: str | None = None
    total_limit: int | None = None
    rounds: int | None = None
    variants_per_base: int | None = None
    category_distribution: Dict[str, int] | None = None
    conversation_mode_distribution: Dict[str, int] | None = None
    shuffle_enabled: bool | None = None
    seed: int | None = None


class ComparisonReportResponse(BaseModel):
    status: str
    report_file: str
    session_json: str
    session_id: str | None = None
    profile_count: int = 0


def load_ai_profiles() -> List[Dict[str, Any]]:
    if not os.path.exists(AI_PROFILES_PATH):
        raise RuntimeError(f"ai_profiles.json not found: {AI_PROFILES_PATH}")

    with open(AI_PROFILES_PATH, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    if not isinstance(data, list):
        raise RuntimeError("ai_profiles.json must contain a list")

    return data


def get_ai_profile_by_name(name: str | None) -> Dict[str, Any] | None:
    if not name:
        return None

    for profile in load_ai_profiles():
        if profile.get("name") == name:
            return profile

    return None


def get_login_credentials() -> tuple[str, str]:
    user_id = os.getenv("KANATA_USER_ID", "")
    password = os.getenv("KANATA_PASSWORD", "")

    if not user_id or not password:
        raise RuntimeError(
            "KANATA_USER_ID and KANATA_PASSWORD must be set in environment variables"
        )

    return user_id, password


def build_scan_overrides(req: ScanRequest) -> Dict[str, Any]:
    return {
        "total_limit": req.total_limit,
        "rounds": req.rounds,
        "variants_per_base": req.variants_per_base,
        "category_distribution": req.category_distribution,
        "conversation_mode_distribution": req.conversation_mode_distribution,
        "shuffle_enabled": req.shuffle_enabled,
        "seed": req.seed,
    }


def get_job_cache_path(job_id: str) -> str:
    return str(JOB_CACHE_DIR / f"{job_id}.json")


def load_job_snapshot(job_id: str) -> Dict[str, Any] | None:
    path = get_job_cache_path(job_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else None


def save_job_snapshot(job_id: str, payload: Dict[str, Any]) -> None:
    path = get_job_cache_path(job_id)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def list_saved_single_reports() -> List[Dict[str, Any]]:
    reports: List[Dict[str, Any]] = []

    for path in sorted(JOB_CACHE_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        if not isinstance(data, dict):
            continue

        result = data.get("result") or {}
        if data.get("status") != "completed" or result.get("status") != "completed":
            continue

        job_id = str(data.get("job_id") or path.stem)
        reports.append(
            {
                "job_id": job_id,
                "scan_type": data.get("scan_type"),
                "mode": data.get("mode"),
                "requested_mode": data.get("requested_mode"),
                "ai_profile_name": data.get("ai_profile_name"),
                "created_at": data.get("created_at"),
                "finished_at": data.get("finished_at"),
                "report_path": f"/reports/single/{job_id}",
            }
        )

    reports.sort(
        key=lambda item: (
            item.get("finished_at") or item.get("created_at") or "",
            item.get("job_id") or "",
        ),
        reverse=True,
    )
    return reports


def build_saved_reports_index() -> Dict[str, Any]:
    comparison = None
    profiles: List[Dict[str, str]] = []
    session_path = comparison_session_path()

    if session_path.exists():
        try:
            session_data = json.loads(session_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            session_data = None

        if isinstance(session_data, dict):
            raw_profiles = session_data.get("profiles") or []
            if isinstance(raw_profiles, list):
                profiles = [
                    {
                        "profile_name": str(profile.get("name") or ""),
                        "report_path": f"/reports/profile/{str(profile.get('name') or '')}",
                    }
                    for profile in raw_profiles
                    if isinstance(profile, dict) and profile.get("name")
                ]

            comparison = {
                "session_id": session_data.get("session_id"),
                "created_at": session_data.get("created_at"),
                "report_path": "/reports/comparison",
            }

    return {
        "single_reports": list_saved_single_reports(),
        "comparison_report": comparison,
        "profile_reports": profiles,
    }


def update_job(job_id: str, **fields: Any) -> None:
    with JOB_LOCK:
        snapshot = dict(JOB_STORE.get(job_id) or load_job_snapshot(job_id) or {"job_id": job_id})
        snapshot.update(fields)
        JOB_STORE[job_id] = snapshot
        save_job_snapshot(job_id, snapshot)


def run_scan_job(job_id: str, req: ScanRequest) -> None:
    from scan_manager import run_scan_process

    update_job(
        job_id,
        status="running",
        started_at=datetime.utcnow().isoformat(),
    )

    try:
        user_id, password = get_login_credentials()
        ai_profile = get_ai_profile_by_name(req.ai_profile_name)
        result = run_scan_process(
            req.url,
            "",
            user_id,
            password,
            req.mode,
            req.is_random,
            req.conversation_mode,
            build_scan_overrides(req),
            ai_profile=ai_profile,
            scan_type=req.scan_type,
            job_id=job_id,
        )
        status = result.get("status", "failed")
        update_job(
            job_id,
            status=status,
            finished_at=datetime.utcnow().isoformat(),
            result=result,
        )
    except Exception as exc:
        update_job(
            job_id,
            status="failed",
            finished_at=datetime.utcnow().isoformat(),
            result={
                "status": "failed",
                "error": str(exc),
            },
        )

@app.get("/")
def read_root():
    return {"status": "ok", "message": "running"}


@app.get("/api/scan/options")
def get_scan_options():
    from report_generator import (
        SCAN_TYPE_ATTACK_CORE,
        SCAN_TYPE_ATTACK_INJECTION,
        SCAN_TYPE_ATTACK_SURFACE,
        SCAN_TYPE_BASELINE_ONLY,
        SCAN_TYPE_FULL,
    )

    payload = export_scan_options()
    payload["scan_types"] = [
        {"key": SCAN_TYPE_BASELINE_ONLY, "label": "baseline_prompts 実行", "description": "baseline_prompts.json を実行します"},
        {"key": SCAN_TYPE_ATTACK_CORE, "label": "過剰権限 + ジェイルブレイク", "description": "excessive_agency.jsonl と jailbreak.jsonl を実行します"},
        {"key": SCAN_TYPE_ATTACK_SURFACE, "label": "その他 + 危険出力", "description": "miscellaneous.jsonl と output_handling.jsonl を実行します"},
        {"key": SCAN_TYPE_ATTACK_INJECTION, "label": "プロンプトインジェクション", "description": "prompt_injection.jsonl を実行します"},
        {"key": SCAN_TYPE_FULL, "label": "全件まとめて実行", "description": "baseline と attack 全体をまとめて実行します"},
    ]
    return payload


@app.get("/api/ai-profiles")
def get_ai_profiles():
    return load_ai_profiles()


@app.post("/api/scan/comparison-report", response_model=ComparisonReportResponse)
def create_comparison_report():
    from scan_manager import generate_comparison_report_from_session

    try:
        result = generate_comparison_report_from_session()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "status": "completed",
        "report_file": result["report_file"],
        "session_json": result["session_json"],
        "session_id": result.get("session_id"),
        "profile_count": result.get("profile_count", 0),
    }


@app.get("/api/reports/single/{job_id}")
def get_single_html_report(job_id: str):
    from report_generator import build_single_report_view_data

    with JOB_LOCK:
        job = JOB_STORE.get(job_id) or load_job_snapshot(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        if job_id not in JOB_STORE:
            JOB_STORE[job_id] = dict(job)
        payload = dict(job)

    result = payload.get("result") or {}
    if payload.get("status") != "completed" or result.get("status") != "completed":
        raise HTTPException(status_code=400, detail="job not completed")

    return build_single_report_view_data(result, ai_profile=payload.get("ai_profile"))


@app.get("/api/reports/comparison")
def get_comparison_html_report():
    from report_generator import build_comparison_report_view_data

    path = comparison_session_path()
    if not path.exists():
        raise HTTPException(status_code=404, detail="comparison session json not found")
    session_data = json.loads(path.read_text(encoding="utf-8"))
    return build_comparison_report_view_data(session_data)


@app.get("/api/reports/profile/{profile_name}")
def get_profile_html_report(profile_name: str):
    from report_generator import build_profile_report_view_data

    path = comparison_session_path()
    if not path.exists():
        raise HTTPException(status_code=404, detail="comparison session json not found")
    session_data = json.loads(path.read_text(encoding="utf-8"))
    try:
        return build_profile_report_view_data(session_data, profile_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="profile report not found") from exc


@app.get("/api/reports")
def list_saved_reports():
    return build_saved_reports_index()


@app.post("/api/scan")
def start_scan(req: ScanRequest, background_tasks: BackgroundTasks):
    if req.scan_type not in {
        "attack_only",
        SCAN_TYPE_BASELINE_ONLY,
        SCAN_TYPE_FULL,
        SCAN_TYPE_ATTACK_CORE,
        SCAN_TYPE_ATTACK_SURFACE,
        SCAN_TYPE_ATTACK_INJECTION,
    }:
        raise HTTPException(status_code=400, detail="invalid scan_type")
    if req.mode not in ALLOWED_SCAN_MODES:
        raise HTTPException(status_code=400, detail="invalid mode")
    if req.conversation_mode and req.conversation_mode not in ALLOWED_CONVERSATION_MODES:
        raise HTTPException(status_code=400, detail="invalid conversation_mode")
    ai_profile = get_ai_profile_by_name(req.ai_profile_name)
    if req.ai_profile_name and ai_profile is None:
        raise HTTPException(status_code=400, detail="invalid ai_profile_name")

    try:
        resolved_settings = build_scan_settings(
            mode=req.mode,
            overrides=build_scan_overrides(req),
            conversation_mode=req.conversation_mode,
            shuffle_enabled=req.is_random,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job_id = uuid.uuid4().hex
    with JOB_LOCK:
        JOB_STORE[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
            "scan_type": req.scan_type,
            "mode": resolved_settings["mode"],
            "requested_mode": req.mode,
            "is_random": resolved_settings["shuffle_enabled"],
            "conversation_mode": req.conversation_mode,
            "ai_profile_name": req.ai_profile_name,
            "ai_profile": ai_profile,
            "scan_settings": {
                "total_limit": resolved_settings["total_limit"],
                "rounds": resolved_settings["rounds"],
                "variants_per_base": resolved_settings["variants_per_base"],
                "category_distribution": resolved_settings["category_distribution"],
                "conversation_mode_distribution": resolved_settings[
                    "conversation_mode_distribution"
                ],
                "shuffle_enabled": resolved_settings["shuffle_enabled"],
                "seed": resolved_settings.get("seed"),
            },
        }
        save_job_snapshot(job_id, JOB_STORE[job_id])

    background_tasks.add_task(run_scan_job, job_id, req)

    return {
        "status": "accepted",
        "scan_type": req.scan_type,
        "job_id": job_id,
        "mode": resolved_settings["mode"],
        "requested_mode": req.mode,
        "is_random": resolved_settings["shuffle_enabled"],
        "conversation_mode": req.conversation_mode,
        "ai_profile_name": req.ai_profile_name,
        "ai_profile": ai_profile,
        "scan_settings": JOB_STORE[job_id]["scan_settings"],
    }


@app.get("/api/scan/{job_id}")
def get_scan_status(job_id: str):
    with JOB_LOCK:
        job = JOB_STORE.get(job_id) or load_job_snapshot(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        if job_id not in JOB_STORE:
            JOB_STORE[job_id] = dict(job)
        payload = dict(job)

    result = payload.pop("result", None)
    if result:
        payload["result"] = result
        payload["summary_json"] = result.get("summary_json")
        payload["summary_csv"] = result.get("summary_csv")
        payload["report_file"] = result.get("report_file")
        payload["log_dir"] = result.get("log_dir")
        payload["comparison_session_json"] = result.get("comparison_session_json")
        payload["error"] = result.get("error")

    return payload
