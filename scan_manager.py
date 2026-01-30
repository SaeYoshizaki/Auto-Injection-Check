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
    "test": {"limit": 3, "interval": 5},
    "quick": {"limit": 50, "interval": 240},
    "standard": {"limit": 120, "interval": 240},
    "deep": {"limit": 300, "interval": 240},
}

INPUT_SELECTOR: str = "form textarea"
OUTPUT_SELECTOR: str = ".mr-auto"


def get_weighted_prompts(
    total_limit: int,
    is_random: bool = True,
    mode: str = "test",
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
        conf: Dict[str, int] = SCAN_CONFIG.get(mode) or SCAN_CONFIG["quick"]
        interval: int = conf["interval"]
        total_limit: int = conf["limit"]

        prompts: List[Tuple[str, str]] = get_weighted_prompts(
            total_limit, is_random, mode
        )

        results: List[Dict[str, Any]] = []
        driver: WebChatDriver = WebChatDriver(
            url, INPUT_SELECTOR, OUTPUT_SELECTOR, headless=False
        )

        try:
            driver.start()
            driver.login(org, username, password)

            error_streak: int = 0

            for prompt, category in prompts:
                t0: float = time.time()

                try:
                    response: str = driver.send_prompt(prompt)

                    if response and "[Error]" in response:
                        error_streak += 1
                        results.append(
                            {
                                "prompt": prompt,
                                "category": category,
                                "response": response,
                                "status": "ERROR",
                            }
                        )
                    else:
                        error_streak = 0
                        eval_result: Dict[str, str] = evaluate_response(
                            prompt, response
                        )
                        status: str = eval_result["status"]
                        reason: str = eval_result.get("reason", "")

                        results.append(
                            {
                                "prompt": prompt,
                                "category": category,
                                "response": response,
                                "status": status,
                                "reason": reason,
                            }
                        )

                except Exception as e:
                    error_streak += 1
                    print("send fail:", e)
                    results.append(
                        {
                            "prompt": prompt,
                            "category": category,
                            "response": str(e),
                            "status": "ERROR",
                        }
                    )

                if error_streak >= 5:
                    print("too many errors, stopping")
                    raise Exception("error streak")

                dt: float = time.time() - t0
                sleep_for: float = interval - dt
                if sleep_for > 0:
                    time.sleep(sleep_for)

        except Exception:
            print("scan aborted")
            traceback.print_exc()
            return {"status": "failed"}

        finally:
            driver.close()

            if results:
                fname: str = f"scan_report_{mode}_{int(time.time())}.pdf"
                generate_report(results, fname)
                print("report saved:", fname)
                return {"status": "completed", "report_file": fname, "results": results}

            return {"status": "failed", "error": "no results"}

    except Exception:
        print("init crash")
        traceback.print_exc()
        return {"status": "failed", "error": "init crash"}
