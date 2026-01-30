import time
import logging
from typing import Optional
from playwright.sync_api import (
    sync_playwright,
    Playwright,
    Browser,
    BrowserContext,
    Page,
)

logger = logging.getLogger(__name__)


class WebChatDriver:
    def __init__(
        self,
        target_url: str,
        input_selector: str,
        output_selector: str,
        headless: bool = True,
    ) -> None:
        self.target_url: str = target_url
        self.input_selector: str = input_selector
        self.output_selector: str = output_selector
        self.headless: bool = headless

        self.playwright: Optional[Playwright] = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

    def start(self) -> None:
        logger.info(f"Starting browser (headless={self.headless})")
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        self.context = self.browser.new_context()
        self.page = self.context.new_page()

    def login(self, org_name: str, username: str, password: str) -> None:
        logger.info("Opening login page")

        if self.page is None:
            raise RuntimeError("Driver not started")

        self.page.goto(self.target_url)
        self.page.wait_for_load_state("networkidle")

        if self.page.query_selector(self.input_selector):
            logger.info("Login skipped (already logged in)")
            return

        try:
            logger.info(f"Entering organization name: {org_name}")
            self.page.wait_for_selector("input[name='organizationName']", timeout=10000)
            self.page.fill("input[name='organizationName']", org_name)
            self.page.click("button[type='submit']")

            logger.info("Entering user credentials")
            self.page.wait_for_selector("input[name='username']", timeout=10000)
            self.page.fill("input[name='username']", username)
            self.page.fill("input[name='password']", password)
            self.page.click("button[type='submit']")

            logger.info("Waiting for chat UI")
            self.page.wait_for_selector(self.input_selector, timeout=30000)

            logger.info("Login completed")
            if self.context:
                self.context.storage_state(path="auth.json")

        except Exception as e:
            logger.error(f"Login failed: {e}")
            raise

    def _clean_text(self, text: Optional[str]) -> str:
        if not text:
            return ""
        return text.replace("ロボ丸くん", "").strip()

    def send_prompt(self, prompt: str) -> str:
        if self.page is None:
            raise RuntimeError("Driver not started")

        try:
            try:
                btn = self.page.get_by_role("button", name="新規チャット")
                if btn.is_visible():
                    logger.info("Starting new chat")
                    btn.click()
                    time.sleep(1)
            except Exception as e:
                logger.debug(f"New chat button not used: {e}")

            try:
                self.page.wait_for_selector(self.output_selector, timeout=5000)
            except Exception:
                pass

            self.page.click(self.input_selector)
            self.page.fill(self.input_selector, prompt)
            time.sleep(0.5)
            self.page.keyboard.press("Enter")

            start_time: float = time.time()
            target_text: str = ""

            while time.time() - start_time < 60:
                elements = self.page.query_selector_all(self.output_selector)

                if len(elements) >= 2:
                    text: str = self._clean_text(elements[-1].inner_text())
                    if text:
                        target_text = text
                        break

                time.sleep(1)

            if not target_text:
                return "[Error] Timeout: Response did not appear."

            previous_text: str = ""
            stable_count: int = 0
            stream_start: float = time.time()

            while time.time() - stream_start < 120:
                try:
                    elements = self.page.query_selector_all(self.output_selector)
                    current_text: str = self._clean_text(elements[-1].inner_text())
                except Exception:
                    break

                if not current_text:
                    time.sleep(1)
                    continue

                if current_text == previous_text:
                    stable_count += 1
                    if stable_count >= 3:
                        return current_text
                else:
                    previous_text = current_text
                    stable_count = 0

                time.sleep(1)

            return previous_text

        except Exception as e:
            return f"[Error] {e}"

    def close(self) -> None:
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
