from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sys
import os

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

class ScanRequest(BaseModel):
    url: str
    organization: str
    username: str
    password: str
    mode: str = "quick"
    is_random: bool = False

@app.get("/")
def read_root():
    return {
        "status": "ok",
        "message": "running",
    }

@app.post("/api/scan")
def start_scan(req: ScanRequest, background_tasks: BackgroundTasks):
    print(f"REQ: mode={req.mode} is_random={req.is_random} user={req.username}")

    background_tasks.add_task(
        run_scan_process,
        req.url,
        req.organization,
        req.username,
        req.password,
        req.mode,
        req.is_random
    )

    return {
        "status": "accepted",
        "mode": req.mode,
        "is_random": req.is_random
    }