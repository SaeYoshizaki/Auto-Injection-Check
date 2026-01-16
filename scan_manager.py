import sys
import os
import time
import random
import traceback

sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

from garak_adapter.probe_loader import load_prompts_by_level
from garak_adapter.custom_driver import WebChatDriver
from report_generator import evaluate_response, generate_report


SCAN_CONFIG = {
    "test": {"level": "quick", "limit": 3, "sleep": 5},
    "quick": {"level": "quick", "limit": None, "sleep": 10},
    "standard": {"level": "standard", "limit": None, "sleep": 30},
    "deep": {"level": "deep", "limit": None, "sleep": 45},
}

INPUT_SELECTOR = "form textarea"
OUTPUT_SELECTOR = ".mr-auto"


def run_scan_process(url, org, username, password, mode="quick"):
    print(f"[START] mode={mode}")

    try:
        config = SCAN_CONFIG.get(mode, SCAN_CONFIG["quick"])

        prompts = load_prompts_by_level(config["level"])
        if config["limit"]:
            prompts = prompts[: config["limit"]]

        print(f"[INFO] prompts={len(prompts)}")

        scan_results = []

        driver = WebChatDriver(url, INPUT_SELECTOR, OUTPUT_SELECTOR, headless=False)

        try:
            driver.start()
            print("[INFO] browser ready")

            driver.login(org, username, password)
            print("[INFO] login ok")

            consecutive_errors = 0

            for i, prompt in enumerate(prompts):
                print(f"[RUN] {i + 1}/{len(prompts)}")

                response = driver.send_prompt(prompt)

                if "[Error]" in response:
                    print("[ERR] response error")
                    consecutive_errors += 1

                    if consecutive_errors >= 3:
                        time.sleep(60)

                    scan_results.append(
                        {"prompt": prompt, "response": response, "status": "ERROR"}
                    )
                else:
                    consecutive_errors = 0
                    status = evaluate_response(response, "jailbreak")

                    scan_results.append(
                        {"prompt": prompt, "response": response, "status": status}
                    )

                if i < len(prompts) - 1:
                    wait_time = random.uniform(
                        config["sleep"] * 0.9, config["sleep"] * 1.2
                    )
                    time.sleep(wait_time)

        except Exception as e:
            print("[FAIL] scan aborted")
            traceback.print_exc()
            return {"status": "failed", "error": str(e)}

        finally:
            driver.close()

            if scan_results:
                report_filename = f"scan_report_{mode}_{int(time.time())}.pdf"
                generate_report(scan_results, report_filename)
                print("[END] completed")

                return {
                    "status": "completed",
                    "report_file": report_filename,
                    "results": scan_results,
                }

            print("[END] no results")
            return {"status": "failed", "error": "No results generated"}

    except Exception as e:
        print("[FATAL] init error")
        traceback.print_exc()
