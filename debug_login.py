import time
from playwright.sync_api import sync_playwright

TARGET_URL = "https://ai-chat.third-scope.com/ts/chat"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()

        print("INFO: opening page")
        page.goto(TARGET_URL)
        time.sleep(3)

        print("=" * 40)
        print("login screen ok?")
        print("hit enter when ready")
        print("=" * 40)
        input("> ")

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
                txt = el.inner_text().replace("\n", " ")[:20]
                t = el.get_attribute("type") or "submit"
                print(f"button[{i}] type={t} text={txt}")
            except Exception:
                continue

        print("INFO: scan finished")

        time.sleep(5)
        browser.close()


if __name__ == "__main__":
    main()
