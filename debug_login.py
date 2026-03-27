import os
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

TARGET_URL = "https://dev.kanata.app/ja/"

USER_ID = os.getenv("KANATA_USER_ID", "")
PASSWORD = os.getenv("KANATA_PASSWORD", "")


def dump_form_info(page):
    print("INFO: checking form elements")

    inputs = page.query_selector_all("input")
    print("INFO: input count =", len(inputs))
    for i, el in enumerate(inputs):
        try:
            t = el.get_attribute("type") or "text"
            n = el.get_attribute("name") or "-"
            ph = el.get_attribute("placeholder") or "-"
            print(f"input[{i}] type={t} name={n} ph={ph}")
        except Exception:
            continue

    btns = page.query_selector_all("button")
    print("INFO: button count =", len(btns))
    for i, el in enumerate(btns):
        try:
            txt = el.inner_text().replace("\n", " ")[:40]
            t = el.get_attribute("type") or "submit"
            print(f"button[{i}] type={t} text={txt}")
        except Exception:
            continue


EMAIL_SELECTOR = 'input#email[name="email"]'
PASSWORD_SELECTOR = 'input#password[name="password"]'
LOGIN_BUTTON_SELECTOR = 'button[type="submit"]:has-text("サインイン")'

LOGIN_SUCCESS_URL_KEYWORDS = [
    "/ja/chat",
    "/chat",
]

LOGIN_SUCCESS_SELECTORS = [
    'button:has-text("新規チャット")',
    'textarea',
    '[contenteditable="true"]',
]


def wait_for_login_success(page, timeout_ms: int = 15000) -> bool:
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:
        pass

    current_url = page.url
    for keyword in LOGIN_SUCCESS_URL_KEYWORDS:
        if keyword in current_url:
            print(f"INFO: login success detected by url: {current_url}")
            return True

    for selector in LOGIN_SUCCESS_SELECTORS:
        try:
            page.locator(selector).first.wait_for(state="visible", timeout=3000)
            print(f"INFO: login success detected via {selector}")
            return True
        except PlaywrightTimeoutError:
            continue
        except Exception:
            continue
    return False


def login(page):
    print("INFO: opening page")
    page.goto(TARGET_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2000)

    print("INFO: filling email")
    page.locator(EMAIL_SELECTOR).wait_for(state="visible", timeout=10000)
    page.locator(EMAIL_SELECTOR).fill(USER_ID)

    print("INFO: filling password")
    page.locator(PASSWORD_SELECTOR).wait_for(state="visible", timeout=10000)
    page.locator(PASSWORD_SELECTOR).fill(PASSWORD)

    print("INFO: clicking login button")
    page.locator(LOGIN_BUTTON_SELECTOR).click()

    if wait_for_login_success(page):
        print("INFO: login completed")
        return True

    print("WARN: login success was not detected")
    print(f"INFO: current url = {page.url}")
    dump_form_info(page)
    return False


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=300)
        ctx = browser.new_context()
        page = ctx.new_page()

        ok = login(page)
        if ok:
            print(f"INFO: final url = {page.url}")
        if not ok:
            print("WARN: please check selector candidates or page flow")

        page.wait_for_timeout(5000)
        browser.close()


if __name__ == "__main__":
    main()
