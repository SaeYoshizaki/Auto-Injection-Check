import sys
import os
import time
import traceback
from typing import Dict, List, Tuple, Any

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from config.fixed_prompts import FIXED_DATA
from garak_adapter.probe_loader import load_prompts_by_category
from garak_adapter.custom_driver import WebChatDriver
from report_generator import evaluate_response, generate_report

CATEGORY_DISTRIBUTION: Dict[str, float] = {
    "prompt_injection": 0.35,
    "jailbreak": 0.20,
    "output_handling": 0.15,
    "excessive_agency": 0.10,
    "miscellaneous": 0.20,
}

SCAN_CONFIG: Dict[str, Dict[str, int]] = {
    "JP-test1": {"limit": 3, "interval": 5},
    "JP-test2": {"limit": 3, "interval": 5},
    "JP-test3": {"limit": 3, "interval": 5},
    "test1": {"limit": 3, "interval": 5},
    "test2": {"limit": 3, "interval": 5},
    "test3": {"limit": 3, "interval": 5},
    "quick": {"limit": 50, "interval": 240},
    "standard": {"limit": 120, "interval": 240},
    "deep": {"limit": 300, "interval": 240},
}

INPUT_SELECTOR: str = "form textarea"
OUTPUT_SELECTOR: str = ".mr-auto"

def get_weighted_prompts(
    total_limit: int,
    is_random: bool = True,
    mode: str = "test1",
) -> List[Tuple[str, str]]:

    if not is_random:
        fixed_list: List[Dict[str, Any]] = FIXED_DATA.get(mode, [])
        return [(p["prompt"], p["category"]) for p in fixed_list[:total_limit]]

    all_prompts: List[Tuple[str, str]] = []
    for cat, weight in CATEGORY_DISTRIBUTION.items():
        limit: int = max(1, int(total_limit * weight))
        plist: List[str] = load_prompts_by_category(cat, limit=limit)
        for p in plist:
            all_prompts.append((p, cat))

    return all_prompts[:total_limit]

def run_scan_process(
    url: str,
    org: str,
    username: str,
    password: str,
    mode: str = "quick",
    is_random: bool = False,
) -> Dict[str, Any]:

    try:
        conf = SCAN_CONFIG.get(mode) or SCAN_CONFIG["quick"]
        interval = conf["interval"]
        total_limit = conf["limit"]

        prompts = get_weighted_prompts(total_limit, is_random, mode)

        results = []
        driver = WebChatDriver(url, INPUT_SELECTOR, OUTPUT_SELECTOR, headless=False)

        try:
            driver.start()
            driver.login(org, username, password)
            error_streak = 0

            for prompt, category in prompts:
                t0 = time.time()
                try:
                    response = driver.send_prompt(prompt)
                    if response and "[Error]" in response:
                        error_streak += 1
                        results.append({"prompt": prompt, "category": category, "response": response, "status": "ERROR"})
                    else:
                        error_streak = 0
                        eval_result = evaluate_response(prompt, response)
                        results.append({
                            "prompt": prompt, 
                            "category": category, 
                            "response": response, 
                            "status": eval_result["status"], 
                            "reason": eval_result.get("reason", "")
                        })
                except Exception as e:
                    error_streak += 1
                    results.append({"prompt": prompt, "category": category, "response": str(e), "status": "ERROR"})

                if error_streak >= 5:
                    raise Exception("Too many consecutive errors.")

                dt = time.time() - t0
                if interval - dt > 0:
                    time.sleep(interval - dt)

        finally:
            driver.close()
            if results:
                fname = f"scan_report_{mode}_{int(time.time())}.pdf"
                generate_report(results, fname)
                return {"status": "completed", "report_file": fname, "results": results}
            return {"status": "failed", "error": "no results"}

    except Exception:
        traceback.print_exc()
        return {"status": "failed", "error": "init crash"}