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
ALLOWED_CONVERSATION_MODES = {"clean_chat", "conversational"}


class ScanRequest(BaseModel):
    url: str
    organization: str
    username: str
    password: str
    mode: str = "smoke"
    is_random: bool = False
    conversation_mode: str = "clean_chat"


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


@app.post("/api/scan")
def start_scan(req: ScanRequest, background_tasks: BackgroundTasks):
    if req.conversation_mode not in ALLOWED_CONVERSATION_MODES:
        raise HTTPException(status_code=400, detail="invalid conversation_mode")

    job_id = uuid.uuid4().hex
    with JOB_LOCK:
        JOB_STORE[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
            "mode": req.mode,
            "is_random": req.is_random,
            "conversation_mode": req.conversation_mode,
        }

    background_tasks.add_task(run_scan_job, job_id, req)

    return {
        "status": "accepted",
        "job_id": job_id,
        "mode": req.mode,
        "is_random": req.is_random,
        "conversation_mode": req.conversation_mode,
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
