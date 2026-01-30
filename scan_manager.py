import sys
import os
import time
import traceback

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from config.fixed_prompts import FIXED_DATA
from garak_adapter.probe_loader import load_prompts_by_category
from garak_adapter.custom_driver import WebChatDriver
from report_generator import evaluate_response, generate_report


CATEGORY_DISTRIBUTION = {
    "prompt_injection": 0.35,
    "jailbreak": 0.20,
    "output_handling": 0.15,
    "excessive_agency": 0.10,
    "miscellaneous": 0.20,
}

SCAN_CONFIG = {
    "test": {"limit": 3, "interval": 5},
    "quick": {"limit": 50, "interval": 240},
    "standard": {"limit": 120, "interval": 240},
    "deep": {"limit": 300, "interval": 240},
}

INPUT_SELECTOR = "form textarea"
OUTPUT_SELECTOR = ".mr-auto"


def get_weighted_prompts(total_limit, is_random=True, mode="test"):
    if not is_random:
        fixed_list = FIXED_DATA.get(mode, [])
        return [(p["prompt"], p["category"]) for p in fixed_list[:total_limit]]

    all_prompts = []
    for cat, weight in CATEGORY_DISTRIBUTION.items():
        limit = max(1, int(total_limit * weight))
        plist = load_prompts_by_category(cat, limit=limit)
        for p in plist:
            all_prompts.append((p, cat))

    return all_prompts[:total_limit]


def run_scan_process(url, org, username, password, mode="quick", is_random=False):
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
                        status = evaluate_response(response, "jailbreak")
                        results.append(
                            {
                                "prompt": prompt,
                                "category": category,
                                "response": response,
                                "status": status,
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

                dt = time.time() - t0
                sleep_for = interval - dt
                if sleep_for > 0:
                    time.sleep(sleep_for)

        except Exception:
            print("scan aborted")
            traceback.print_exc()
            return {"status": "failed"}

        finally:
            driver.close()

            if results:
                fname = f"scan_report_{mode}_{int(time.time())}.pdf"
                generate_report(results, fname)
                print("report saved:", fname)
                return {"status": "completed", "report_file": fname, "results": results}

            return {"status": "failed", "error": "no results"}

    except Exception:
        print("init crash")
        traceback.print_exc()
