import time
import logging
import re
from typing import Optional, Sequence
from playwright.sync_api import (
    sync_playwright,
    Playwright,
    Browser,
    BrowserContext,
    Page,
    TimeoutError as PlaywrightTimeoutError,
)

logger = logging.getLogger(__name__)

DEFAULT_CONVERSATION_MODE = "clean_chat"
DEFAULT_SPACE_NAME = "検証用組織1"


class WebChatDriver:
    def __init__(
        self,
        target_url: str,
        input_selector: str,
        output_selector: str,
        headless: bool = True,
        space_name: str = "",
        project_name: str = "",
        ai_name: str = "",
    ) -> None:
        self.target_url: str = target_url
        self.input_selector: str = input_selector
        self.output_selector: str = output_selector
        self.headless: bool = headless
        self.space_name: str = space_name
        self.project_name: str = project_name
        self.ai_name: str = ai_name

        self.playwright: Optional[Playwright] = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

    def _validate_conversation_mode(self, conversation_mode: str) -> str:
        normalized = (conversation_mode or DEFAULT_CONVERSATION_MODE).strip()
        if normalized not in {DEFAULT_CONVERSATION_MODE, "conversational"}:
            raise ValueError(f"Unsupported conversation mode: {conversation_mode}")
        return normalized

    def start(self) -> None:
        logger.info("Starting browser (headless=%s)", self.headless)
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        logger.info("Browser page created")

    def _spaces_url(self) -> str:
        return f"{self.target_url.rstrip('/')}/spaces"

    def _is_login_form_visible(self) -> bool:
        if self.page is None:
            return False
        try:
            return self.page.locator("input#email[name='email']").first.is_visible()
        except Exception:
            return False

    def _is_chat_ready_visible(self) -> bool:
        if self.page is None:
            return False
        try:
            return self.page.locator("textarea[name='message']").first.is_visible()
        except Exception:
            return False

    def _wait_for_post_login_transition(self) -> None:
        if self.page is None:
            raise RuntimeError("Driver not started")

        start = time.time()
        while time.time() - start < 20:
            login_form_visible = self._is_login_form_visible()
            chat_ready_visible = self._is_chat_ready_visible()
            current_url = self.page.url

            logger.info(
                "Post-login wait: login_form_visible=%s chat_ready_visible=%s url=%s",
                login_form_visible,
                chat_ready_visible,
                current_url,
            )

            if not login_form_visible and (
                chat_ready_visible or "/spaces" in current_url or "/ja/" in current_url
            ):
                return

            self.page.wait_for_timeout(500)

        raise RuntimeError("post-login transition did not complete")

    def _wait_for_chat_ready(self) -> None:
        if self.page is None:
            raise RuntimeError("Driver not started")

        self.page.wait_for_selector("textarea[name='message']", timeout=30000)
        logger.info("Chat input is ready")

    def _click_space(self) -> None:
        if self.page is None:
            raise RuntimeError("Driver not started")

        logger.info("Waiting for space selection screen")
        self.page.wait_for_url("**/spaces", timeout=30000)
        logger.info("Space selection URL reached: %s", self.page.url)

        try:
            self.page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            logger.info("Continuing without networkidle on /spaces")

        space_name = (self.space_name or DEFAULT_SPACE_NAME).strip()
        if not space_name:
            raise RuntimeError("space_name is not set")

        logger.info("Selecting space by visible text: %s", space_name)
        target = self.page.get_by_role("button", name=space_name, exact=True)

        try:
            target.wait_for(state="visible", timeout=15000)
        except PlaywrightTimeoutError:
            logger.info("Exact role match not found, retrying with text-based button locator")
            target = self.page.locator(
                "button",
                has_text=re.compile(rf"^\s*{re.escape(space_name)}\s*$"),
            )
            target.wait_for(state="visible", timeout=15000)

        target.scroll_into_view_if_needed()
        previous_url = self.page.url

        try:
            target.click(timeout=10000)
        except PlaywrightTimeoutError:
            logger.info("Retrying space click with force=True")
            target.click(timeout=10000, force=True)

        try:
            self.page.wait_for_function(
                """(previousUrl) => {
                    return window.location.href !== previousUrl
                        || !window.location.pathname.endsWith('/spaces')
                        || document.querySelectorAll('a').length > 0;
                }""",
                arg=previous_url,
                timeout=15000,
            )
        except PlaywrightTimeoutError:
            logger.info("No immediate post-space state change detected after click")

        try:
            self.page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

    def _click_project(self) -> None:
        if self.page is None:
            raise RuntimeError("Driver not started")

        logger.info("Waiting for project list")
        self.page.wait_for_timeout(3000)
        logger.info("Project selection page URL: %s", self.page.url)

        if not self.project_name:
            raise RuntimeError("project_name is not set")

        logger.info("Selecting project: %s", self.project_name)
        target = self.page.locator("a").filter(has_text=self.project_name).first
        target.wait_for(state="visible", timeout=15000)
        target.click()

        try:
            self.page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

    def _click_ai(self) -> None:
        if self.page is None:
            raise RuntimeError("Driver not started")

        logger.info("Waiting for AI app list")
        self.page.wait_for_timeout(3000)
        logger.info("AI selection page URL: %s", self.page.url)

        if not self.ai_name:
            raise RuntimeError("ai_name is not set")

        logger.info("Selecting AI: %s", self.ai_name)
        target = self.page.locator("a[href*='/ai-chat/']").filter(
            has_text=self.ai_name
        ).first
        target.wait_for(state="visible", timeout=15000)
        target.click()

        try:
            self.page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

    def login(self, org_name: str, username: str, password: str) -> None:
        logger.info("Opening login page")

        if self.page is None:
            raise RuntimeError("Driver not started")

        self.page.goto(self.target_url, wait_until="domcontentloaded")
        logger.info("Opened target URL: %s", self.page.url)
        self.page.wait_for_timeout(2000)

        logger.info(
            "Navigation targets: space_name=%s project_name=%s ai_name=%s",
            self.space_name,
            self.project_name,
            self.ai_name,
        )

        already_logged_in = False
        login_form_visible = self._is_login_form_visible()
        chat_ready_visible = self._is_chat_ready_visible()

        logger.info("Login form visible: %s", login_form_visible)
        logger.info("Chat input visible: %s", chat_ready_visible)

        if chat_ready_visible and not login_form_visible:
            already_logged_in = True
            logger.info("Active session detected; will navigate to selected AI")

        try:
            if not already_logged_in:
                logger.info("Waiting for login form")
                self.page.wait_for_selector("input#email[name='email']", timeout=15000)
                self.page.wait_for_selector("input#password[name='password']", timeout=15000)

                logger.info("Entering email")
                self.page.fill("input#email[name='email']", username)

                logger.info("Entering password")
                self.page.fill("input#password[name='password']", password)

                logger.info("Clicking sign-in button")
                self.page.locator("button[type='submit']:has-text('サインイン')").click()
                logger.info("Sign-in button clicked")

                self._wait_for_post_login_transition()
                logger.info("URL after sign-in: %s", self.page.url)
                logger.info("Login form visible after sign-in: %s", self._is_login_form_visible())
                logger.info("Chat input visible after sign-in: %s", self._is_chat_ready_visible())
            else:
                logger.info("Skipping credential input because active session is already detected")

            current_url = self.page.url
            if "/spaces" not in current_url:
                logger.info("Navigating to spaces URL: %s", self._spaces_url())
                self.page.goto(self._spaces_url(), wait_until="domcontentloaded")
                try:
                    self.page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    pass
            else:
                logger.info("Already on spaces-related page: %s", current_url)

            self._click_space()
            self._click_project()
            self._click_ai()
            self._wait_for_chat_ready()

            logger.info("Login + navigation completed")
            if self.context:
                self.context.storage_state(path="auth.json")

        except Exception as e:
            logger.error("Login/navigation failed: %s", e)
            logger.error("Current URL: %s", self.page.url if self.page else "unknown")
            raise

    def _clean_text(self, text: Optional[str]) -> str:
        if not text:
            return ""
        return text.replace("ロボ丸くん", "").strip()

    def _get_visible_output_texts(self) -> list[str]:
        if self.page is None:
            return []

        texts: list[str] = []
        for el in self.page.query_selector_all(self.output_selector):
            try:
                if not el.is_visible():
                    continue
                text = self._clean_text(el.inner_text())
                if text:
                    texts.append(text)
            except Exception:
                continue
        return texts

    def _pick_new_response_text(
        self,
        before_texts: list[str],
        current_texts: list[str],
    ) -> str:
        if not current_texts:
            return ""

        if len(current_texts) > len(before_texts):
            appended = current_texts[len(before_texts):]
            merged = "\n\n".join(text for text in appended if text)
            if merged:
                return merged

        compare_len = min(len(before_texts), len(current_texts))
        for idx in range(compare_len - 1, -1, -1):
            if current_texts[idx] != before_texts[idx] and current_texts[idx]:
                return current_texts[idx]

        return current_texts[-1]

    def _start_new_chat(self) -> None:
        if self.page is None:
            return

        try:
            btn = self.page.get_by_role("button", name="新規チャット")
            if btn.is_visible():
                logger.info("Starting new chat")
                btn.click()
                time.sleep(1)
        except Exception as exc:
            logger.debug("New chat button not used: %s", exc)

    def reset_chat(self) -> None:
        self._start_new_chat()

    def _send_and_wait(self, prompt: str, start_new_chat: bool = False) -> str:
        if self.page is None:
            raise RuntimeError("Driver not started")

        if start_new_chat:
            self._start_new_chat()

        try:
            input_selector = "textarea[name='message']"
            send_button_selector = "button[type='submit']"

            self.page.wait_for_selector(input_selector, timeout=10000)
            logger.info("Prompt send started")
            logger.info("Prompt preview: %s", prompt[:80].replace("\n", " "))
            logger.info("Using input selector: %s", input_selector)
            logger.info("Using output selector: %s", self.output_selector)

            before_texts = self._get_visible_output_texts()
            logger.info("Output texts before send: count=%s", len(before_texts))
            if before_texts:
                logger.info(
                    "Last output before send preview=%s",
                    before_texts[-1][:120].replace("\n", " "),
                )

            self.page.click(input_selector)
            self.page.fill(input_selector, prompt)
            logger.info("Prompt filled into textarea")
            time.sleep(0.5)

            self.page.click(send_button_selector)
            logger.info("Send button clicked using selector: %s", send_button_selector)

            start_time = time.time()
            latest_candidate = ""
            previous_candidate = ""
            stable_count = 0

            while time.time() - start_time < 120:
                current_texts = self._get_visible_output_texts()
                logger.info("Current output text count: %s", len(current_texts))

                candidate_text = self._pick_new_response_text(before_texts, current_texts)
                if not candidate_text:
                    time.sleep(1)
                    continue

                latest_candidate = candidate_text
                logger.info(
                    "Candidate text length=%s stable_count=%s preview=%s",
                    len(candidate_text),
                    stable_count,
                    candidate_text[:120].replace("\n", " "),
                )

                if candidate_text == previous_candidate:
                    stable_count += 1
                    if stable_count >= 2:
                        logger.info("Response stabilized, waiting 5 seconds before next prompt")
                        time.sleep(5)
                        logger.info("Returning response after delay")
                        return candidate_text
                else:
                    previous_candidate = candidate_text
                    stable_count = 0

                time.sleep(1)

            logger.warning("Response did not stabilize before timeout")
            logger.info("Final fallback response, waiting 5 seconds before next prompt")
            time.sleep(5)
            return latest_candidate or "[Error] Timeout: Response did not stabilize."

        except Exception as exc:
            logger.exception("_send_and_wait failed: %s", exc)
            return f"[Error] {exc}"

    def _run_conversational_warmup(self, prompts: Sequence[str]) -> None:
        for prompt in prompts:
            response = self._send_and_wait(prompt, start_new_chat=False)
            if not response or "[Error]" in response:
                raise RuntimeError(f"Warmup failed for prompt: {prompt}")

    def send_prompt(
        self,
        prompt: str,
        conversation_mode: str = DEFAULT_CONVERSATION_MODE,
    ) -> str:
        normalized_mode = self._validate_conversation_mode(conversation_mode)
        logger.info("Sending prompt with conversation_mode=%s", normalized_mode)

        if normalized_mode == DEFAULT_CONVERSATION_MODE:
            return self._send_and_wait(prompt, start_new_chat=False)

        self._run_conversational_warmup(CONVERSATIONAL_WARMUP_PROMPTS)
        return self._send_and_wait(prompt, start_new_chat=False)

    def close(self) -> None:
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
