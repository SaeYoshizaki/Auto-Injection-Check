Snapshot: final_release

This snapshot contains a fixed copy of:
- scan_logs
- comparison_sessions
- job_cache

Run backend against this frozen data:
REPORT_DATA_ROOT=/Users/yoshizakisae/Desktop/auto-injection-check/snapshots/final_release/data uvicorn server:app --reload

Then open the frontend as usual.
You can keep editing frontend CSS and UI without changing this snapshot data.
