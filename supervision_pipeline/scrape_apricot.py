#!/usr/bin/env python3
"""
Automated Apricot Report Runner & XLSX Exporter.

Logs into https://apricot.socialsolutions.com/report/run/report_id/486 using
saved session cookies or APRICOT_EMAIL / APRICOT_PASSWORD from .env, handles the
concurrent-session "Continue" prompt, triggers the right-hand "Export" menu,
confirms "Export" in the dialog box, and saves the downloaded .xlsx workbook.
"""

import argparse
import os
import shutil
import sys
import time
from datetime import date
from pathlib import Path
from typing import Dict, Optional

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

BASE_DIR = Path(__file__).resolve().parent
PROFILE_DIR = BASE_DIR / ".apricot_browser_profile"
EXPORTS_DIR = BASE_DIR / "apricot_exports"
REPORT_URL = "https://apricot.socialsolutions.com/report/run/report_id/486"
LOGIN_URL_MARKERS = ("/auth/login", "/login", "signin", "sso")


def load_env_files() -> None:
    """Load key=value pairs from local .env files without overwriting existing env vars."""
    candidates = [
        BASE_DIR / ".env",
        BASE_DIR.parent / "facilitation-scoring" / ".env",
        BASE_DIR.parent.parent / "docs" / "lscmi" / "audio-interview-app" / ".env",
    ]
    for env_path in candidates:
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


def is_login_page(page: Page) -> bool:
    """Return True if the current page appears to be an Apricot/Bonterra login screen."""
    url = (page.url or "").lower()
    if any(marker in url for marker in LOGIN_URL_MARKERS) or "bonterra" in url or "auth0" in url:
        return True
    if page.locator(".bonterra-auth-button, #bonterraAuthForm").count() > 0:
        return True
    pw_inputs = page.locator("input[type='password']")
    return pw_inputs.count() > 0 and pw_inputs.first.is_visible()


def handle_concurrent_session_prompt(page: Page) -> bool:
    """
    If Apricot warns that another browser session is logged in, click Continue
    to log out of other sessions. Returns True if a Continue prompt was clicked.
    """
    selectors = [
        "button:has-text('Continue')",
        "input[type='submit'][value*='Continue' i]",
        "input[type='button'][value*='Continue' i]",
        "a:has-text('Continue')",
        "button:has-text('Log out other')",
    ]
    for sel in selectors:
        loc = page.locator(sel)
        if loc.count() > 0:
            for i in range(loc.count()):
                el = loc.nth(i)
                if el.is_visible():
                    print("Detected concurrent session prompt — clicking Continue...", flush=True)
                    el.click()
                    page.wait_for_load_state("domcontentloaded", timeout=30000)
                    page.wait_for_timeout(2000)
                    return True
    return False


def attempt_credential_login(page: Page, email: str, password: str) -> None:
    """Handle Bonterra landing button and fill email/password on Apricot login page."""
    bonterra_btn = page.locator(".bonterra-auth-button")
    if bonterra_btn.count() > 0 and bonterra_btn.first.is_visible():
        print("Clicking Bonterra 'Log in to your account' button...", flush=True)
        bonterra_btn.first.click()
        page.wait_for_load_state("domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)

    if not is_login_page(page):
        return

    email_selectors = [
        "input[type='email']",
        "input[name*='email' i]",
        "input[name*='user' i]",
        "input[id*='email' i]",
        "input[id*='user' i]",
        "input[type='text']",
    ]
    pw_selectors = [
        "input[type='password']",
        "input[name*='pass' i]",
        "input[id*='pass' i]",
    ]
    submit_selectors = [
        "button[type='submit']:not([aria-hidden='true'])",
        "input[type='submit']:not([aria-hidden='true'])",
        "button:has-text('Continue'):not([aria-hidden='true'])",
        "button:has-text('Next'):not([aria-hidden='true'])",
        "button:has-text('Log In'):not([aria-hidden='true'])",
        "button:has-text('Sign In'):not([aria-hidden='true'])",
        "button:has-text('Login'):not([aria-hidden='true'])",
    ]

    def find_submit_btn():
        for sel in submit_selectors:
            loc = page.locator(sel)
            for idx in range(loc.count()):
                cand = loc.nth(idx)
                if cand.is_visible():
                    return cand
        return None

    email_input = next(
        (page.locator(s).first for s in email_selectors if page.locator(s).count() > 0 and page.locator(s).first.is_visible()),
        None,
    )
    pw_input = next(
        (page.locator(s).first for s in pw_selectors if page.locator(s).count() > 0 and page.locator(s).first.is_visible()),
        None,
    )

    if email_input and not pw_input:
        print(f"Entering email {email}...", flush=True)
        email_input.fill(email)
        btn = find_submit_btn()
        if btn:
            btn.click()
        else:
            email_input.press("Enter")
        page.wait_for_load_state("domcontentloaded", timeout=45000)
        page.wait_for_timeout(2000)
        pw_input = next(
            (page.locator(s).first for s in pw_selectors if page.locator(s).count() > 0 and page.locator(s).first.is_visible()),
            None,
        )

    if not pw_input:
        raise RuntimeError("Could not locate password input on Apricot/Bonterra login page.")

    if email_input and email_input.is_visible():
        email_input.fill(email)

    print(f"Signing into Apricot as {email}...", flush=True)
    pw_input.fill(password)

    btn = find_submit_btn()
    if btn:
        btn.click()
    else:
        pw_input.press("Enter")

    page.wait_for_load_state("domcontentloaded", timeout=45000)
    page.wait_for_timeout(3000)


def find_export_menu_trigger(page: Page):
    """Locate the 'Export' action in Apricot's right-hand menu list."""
    candidates = [
        "#report-export-palette-button",
        "#action-palette a:has-text('Export')",
        "#action-palette button:has-text('Export')",
        ".action-palette a:has-text('Export')",
        ".right-menu a:has-text('Export')",
        "aside a:has-text('Export')",
        "aside button:has-text('Export')",
        "li a:has-text('Export')",
        "a:text-is('Export')",
        "button:text-is('Export')",
        "[title='Export']",
        "a:has-text('Export')",
        "button:has-text('Export')",
    ]
    for sel in candidates:
        loc = page.locator(sel)
        if loc.count() > 0:
            for i in range(loc.count()):
                el = loc.nth(i)
                if el.is_visible():
                    return el
    return None


def find_dialog_export_button(page: Page):
    """Locate the 'Export' confirmation button inside the Export dialog box."""
    modal_candidates = [
        "#overlay_content button[onclick*='report.export']",
        "#overlay_content button:has-text('Export')",
        "#overlay button:has-text('Export')",
        ".ui-dialog button:has-text('Export')",
        ".ui-dialog input[value*='Export' i]",
        ".modal button:has-text('Export')",
        ".modal input[value*='Export' i]",
        "[role='dialog'] button:has-text('Export')",
        "[role='dialog'] input[value*='Export' i]",
        "[role='dialog'] a:has-text('Export')",
    ]
    for sel in modal_candidates:
        loc = page.locator(sel)
        count = loc.count()
        if count > 0:
            for i in range(count):
                el = loc.nth(i)
                if el.is_visible():
                    return el
    return None


def export_apricot_report(
    report_date: date,
    interactive_login: bool = False,
    timeout_sec: int = 180,
) -> Path:
    """
    Navigate to Apricot report 486, authenticate if required, handle concurrent
    session prompt, trigger Export -> dialog Export, and save the .xlsx file.
    """
    load_env_files()
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    email = os.environ.get("APRICOT_EMAIL", "").strip()
    password = os.environ.get("APRICOT_PASSWORD", "").strip()
    headless = not interactive_login

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=headless,
            accept_downloads=True,
            ignore_default_args=["--enable-automation"],
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            viewport={"width": 1440, "height": 900},
        )
        page = context.pages[0] if context.pages else context.new_page()

        try:
            print(f"Navigating to Apricot report (headless={headless}): {REPORT_URL}", flush=True)
            page.goto(REPORT_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)

            handle_concurrent_session_prompt(page)

            # Click Bonterra landing button if present (may auto-authenticate via saved SSO cookie)
            bonterra_btn = page.locator(".bonterra-auth-button")
            if bonterra_btn.count() > 0 and bonterra_btn.first.is_visible():
                print("Clicking Bonterra 'Log in to your account' button...", flush=True)
                bonterra_btn.first.click()
                page.wait_for_load_state("domcontentloaded", timeout=45000)
                page.wait_for_timeout(2500)
                handle_concurrent_session_prompt(page)

            if is_login_page(page):
                if email and password and not interactive_login:
                    attempt_credential_login(page, email, password)
                    handle_concurrent_session_prompt(page)
                elif interactive_login:
                    if email and password:
                        attempt_credential_login(page, email, password)
                        handle_concurrent_session_prompt(page)
                    else:
                        print(
                            f"Waiting up to {timeout_sec}s for interactive Apricot login...",
                            flush=True,
                        )
                        deadline = time.time() + timeout_sec
                        while time.time() < deadline:
                            handle_concurrent_session_prompt(page)
                            if not is_login_page(page) and "apricot.socialsolutions.com" in page.url:
                                break
                            page.wait_for_timeout(1000)
                        else:
                            raise RuntimeError("Timed out waiting for interactive Apricot login.")
                else:
                    raise RuntimeError(
                        "Apricot session is not logged in. Set APRICOT_EMAIL and APRICOT_PASSWORD "
                        "in .env or run `python3 scrape_apricot.py --login` once."
                    )

            # Ensure we are on the report URL after login/session-override redirects
            handle_concurrent_session_prompt(page)
            if "report_id/486" not in (page.url or ""):
                print(f"Navigating to target report: {REPORT_URL}", flush=True)
                page.goto(REPORT_URL, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(3000)
                handle_concurrent_session_prompt(page)

            # Wait for report to finish rendering and right-hand Export menu to appear
            print("Waiting for Apricot report to load...", flush=True)
            export_trigger = None
            load_deadline = time.time() + 120
            while time.time() < load_deadline:
                handle_concurrent_session_prompt(page)
                export_trigger = find_export_menu_trigger(page)
                if export_trigger is not None:
                    break
                page.wait_for_timeout(1500)

            if export_trigger is None:
                raise RuntimeError("Timed out waiting for right-hand 'Export' menu on Apricot report.")

            print("Clicking 'Export' in right-hand menu...", flush=True)
            export_trigger.click()
            page.wait_for_timeout(1500)

            # Wait for Export dialog box and click Export inside it
            dialog_export_btn = None
            dlg_deadline = time.time() + 20
            while time.time() < dlg_deadline:
                dialog_export_btn = find_dialog_export_button(page)
                if dialog_export_btn is not None:
                    break
                page.wait_for_timeout(500)

            if dialog_export_btn is None:
                raise RuntimeError("Could not find 'Export' button inside the Export dialog box.")

            print("Confirming 'Export' in dialog and waiting for XLSX download...", flush=True)
            with page.expect_download(timeout=120000) as download_info:
                dialog_export_btn.click()

            download = download_info.value
            dated_path = EXPORTS_DIR / f"Justin_Main_Report_{report_date.isoformat()}.xlsx"
            latest_path = EXPORTS_DIR / "apricot_latest.xlsx"
            download.save_as(str(dated_path))
            shutil.copyfile(dated_path, latest_path)

            # Also mirror into ~/Downloads with YYMMDD naming convention
            downloads_dir = Path.home() / "Downloads"
            if downloads_dir.exists():
                yymmdd = report_date.strftime("%y%m%d")
                downloads_copy = downloads_dir / f"Justin's Main report {yymmdd}.xlsx"
                shutil.copyfile(dated_path, downloads_copy)
                print(f"Mirrored export to Downloads: {downloads_copy}", flush=True)

            print(f"Apricot report exported successfully: {dated_path}", flush=True)
            return dated_path

        except Exception as exc:
            try:
                page.screenshot(path=str(BASE_DIR / "apricot_debug_screenshot.png"), full_page=True)
                (BASE_DIR / "apricot_debug.html").write_text(page.content(), encoding="utf-8")
            except Exception:
                pass
            raise RuntimeError(f"Apricot export failed: {exc}") from exc
        finally:
            context.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Automate Apricot report 486 export to XLSX.")
    parser.add_argument(
        "--login",
        action="store_true",
        help="Launch visible browser window for interactive Apricot login.",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Override export date (YYYY-MM-DD), defaults to today.",
    )
    args = parser.parse_args()
    report_date = date.fromisoformat(args.date) if args.date else date.today()
    export_apricot_report(report_date=report_date, interactive_login=args.login)
    return 0


if __name__ == "__main__":
    sys.exit(main())
