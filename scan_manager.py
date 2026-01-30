import sys
import os
import time
import random
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
        print(f"INFO: Loading FIXED prompts for {mode}...")
        fixed_list = FIXED_DATA.get(mode, [])
        return [(p["prompt"], p["category"]) for p in fixed_list[:total_limit]]

    all_prompts = []
    print("INFO: Fetching RANDOM prompts by OWASP distribution...")
    for category, weight in CATEGORY_DISTRIBUTION.items():
        category_limit = max(1, int(total_limit * weight))
        prompts = load_prompts_by_category(category, limit=category_limit)
        all_prompts.extend([(p, category) for p in prompts])

    return all_prompts[:total_limit]


def run_scan_process(url, org, username, password, mode="quick", is_random=False):
    print(f"START: mode={mode} is_random={is_random}")

    try:
        config = SCAN_CONFIG.get(mode, SCAN_CONFIG["quick"])
        interval = config["interval"]
        total_limit = config["limit"]

        weighted_prompts = get_weighted_prompts(
            total_limit, is_random=is_random, mode=mode
        )
        print(f"INFO: Total weighted prompts: {len(weighted_prompts)}")

        scan_results = []
        driver = WebChatDriver(url, INPUT_SELECTOR, OUTPUT_SELECTOR, headless=False)

        try:
            driver.start()
            print("INFO: browser ready")
            driver.login(org, username, password)
            print("INFO: login ok")

            consecutive_errors = 0

            for i, (prompt, category) in enumerate(weighted_prompts):
                iteration_start = time.time()
                print(
                    f"RUN: {i + 1}/{len(weighted_prompts)} [{category}] - Sending message"
                )

                try:
                    response = driver.send_prompt(prompt)

                    if response and "[Error]" in response:
                        print(f"ERR: response error")
                        consecutive_errors += 1
                        scan_results.append(
                            {
                                "prompt": prompt,
                                "category": category,
                                "response": response,
                                "status": "ERROR",
                            }
                        )
                    else:
                        consecutive_errors = 0
                        status = evaluate_response(response, "jailbreak")
                        scan_results.append(
                            {
                                "prompt": prompt,
                                "category": category,
                                "response": response,
                                "status": status,
                            }
                        )
                        print(f"INFO: Analysis: {status}")

                except Exception as e:
                    print(f"ERR: Exception: {e}")
                    consecutive_errors += 1
                    scan_results.append(
                        {
                            "prompt": prompt,
                            "category": category,
                            "response": str(e),
                            "status": "ERROR",
                        }
                    )

                if consecutive_errors >= 5:
                    print("FATAL: 5 consecutive errors. Aborting.")
                    raise Exception("Aborting scan due to 5 consecutive errors.")

                if i < len(weighted_prompts) - 1:
                    elapsed = time.time() - iteration_start
                    wait_time = interval - elapsed
                    if wait_time > 0:
                        print(f"WAIT: Next message in {wait_time:.1f}s...")
                        time.sleep(wait_time)

        except Exception as e:
            print("FAIL: scan aborted")
            traceback.print_exc()
            return {"status": "failed", "error": str(e)}

        finally:
            driver.close()
            if scan_results:
                report_filename = f"scan_report_{mode}_{int(time.time())}.pdf"
                generate_report(scan_results, report_filename)
                print(f"END: completed. Report: {report_filename}")
                return {
                    "status": "completed",
                    "report_file": report_filename,
                    "results": scan_results,
                }

            return {"status": "failed", "error": "No results generated"}

    except Exception as e:
        print("FATAL: init error")
        traceback.print_exc()
