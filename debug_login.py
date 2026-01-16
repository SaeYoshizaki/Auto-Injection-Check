import time
from playwright.sync_api import sync_playwright

TARGET_URL = "https://ai-chat.third-scope.com/ts/chat"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        print("[INFO] open")
        page.goto(TARGET_URL)
        time.sleep(3)

        print("=" * 50)
        print("check login screen")
        print("press enter to continue")
        print("=" * 50)
        input("> ")

        print("[INFO] scan form")

        inputs = page.query_selector_all("input")
        print(f"[INFO] inputs={len(inputs)}")
        for i, el in enumerate(inputs):
            try:
                type_attr = el.get_attribute("type") or "text"
                name_attr = el.get_attribute("name") or "-"
                placeholder = el.get_attribute("placeholder") or "-"
                print(
                    f"input[{i}] type={type_attr} name={name_attr} placeholder={placeholder}"
                )
            except:
                pass

        buttons = page.query_selector_all("button")
        print(f"[INFO] buttons={len(buttons)}")
        for i, el in enumerate(buttons):
            try:
                text = el.inner_text().replace("\n", " ")[:20]
                type_attr = el.get_attribute("type") or "submit"
                print(f"button[{i}] type={type_attr} text={text}")
            except:
                pass

        print("[INFO] done")

        time.sleep(5)
        browser.close()


if __name__ == "__main__":
    main()
