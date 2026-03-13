from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sys
import os
import threading
import uuid
from datetime import datetime
from typing import Any, Dict

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from config.scan_presets import (
    CONVERSATION_MODE_ORDER,
    build_scan_settings,
    export_scan_options,
    get_allowed_scan_modes,
)
from scan_manager import run_scan_process

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


class ScanRequest(BaseModel):
    url: str
    organization: str
    username: str
    password: str
    mode: str = "standard"
    is_random: bool | None = None
    conversation_mode: str | None = None
    total_limit: int | None = None
    rounds: int | None = None
    variants_per_base: int | None = None
    category_distribution: Dict[str, int] | None = None
    conversation_mode_distribution: Dict[str, int] | None = None
    shuffle_enabled: bool | None = None
    seed: int | None = None


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


def update_job(job_id: str, **fields: Any) -> None:
    with JOB_LOCK:
        if job_id in JOB_STORE:
            JOB_STORE[job_id].update(fields)


def run_scan_job(job_id: str, req: ScanRequest) -> None:
    update_job(
        job_id,
        status="running",
        started_at=datetime.utcnow().isoformat(),
    )
    result = run_scan_process(
        req.url,
        req.organization,
        req.username,
        req.password,
        req.mode,
        req.is_random,
        req.conversation_mode,
        build_scan_overrides(req),
    )
    status = result.get("status", "failed")
    update_job(
        job_id,
        status=status,
        finished_at=datetime.utcnow().isoformat(),
        result=result,
    )


@app.get("/")
def read_root():
    return {"status": "ok", "message": "running"}


@app.get("/api/scan/options")
def get_scan_options():
    return export_scan_options()


@app.post("/api/scan")
def start_scan(req: ScanRequest, background_tasks: BackgroundTasks):
    if req.mode not in ALLOWED_SCAN_MODES:
        raise HTTPException(status_code=400, detail="invalid mode")
    if req.conversation_mode and req.conversation_mode not in ALLOWED_CONVERSATION_MODES:
        raise HTTPException(status_code=400, detail="invalid conversation_mode")
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
            "mode": resolved_settings["mode"],
            "requested_mode": req.mode,
            "is_random": resolved_settings["shuffle_enabled"],
            "conversation_mode": req.conversation_mode,
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

    background_tasks.add_task(run_scan_job, job_id, req)

    return {
        "status": "accepted",
        "job_id": job_id,
        "mode": resolved_settings["mode"],
        "requested_mode": req.mode,
        "is_random": resolved_settings["shuffle_enabled"],
        "conversation_mode": req.conversation_mode,
        "scan_settings": JOB_STORE[job_id]["scan_settings"],
    }


@app.get("/api/scan/{job_id}")
def get_scan_status(job_id: str):
    with JOB_LOCK:
        job = JOB_STORE.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        payload = dict(job)

    result = payload.pop("result", None)
    if result:
        payload["result"] = result
        payload["summary_json"] = result.get("summary_json")
        payload["summary_csv"] = result.get("summary_csv")
        payload["report_file"] = result.get("report_file")
        payload["log_dir"] = result.get("log_dir")

    return payload
