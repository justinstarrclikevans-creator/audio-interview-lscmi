#!/usr/bin/env python3
"""
SkillCat Ranked List Scraper & Daily Supervision Report Generator.

Scrapes https://skillcat.app/local/skillcat/pages/ranked-list.php (using Google SSO
for justin@turnninety.com) and each employee's SkillCat portfolio page, tracks daily
course completion deltas in skillcat_history.json, flags learners who have not
completed a course within the last 2 working days, and outputs a formatted PDF report.
"""

import argparse
import json
import os
import re
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BASE_DIR = Path(__file__).resolve().parent
PROFILE_DIR = BASE_DIR / ".browser_profile"
STORAGE_STATE_PATH = BASE_DIR / "storage_state.json"
HISTORY_PATH = BASE_DIR / "skillcat_history.json"
DEBUG_HTML_PATH = BASE_DIR / "last_page_snapshot.html"
TARGET_URL = "https://skillcat.app/local/skillcat/pages/ranked-list.php"
SSO_EMAIL = "justin@turnninety.com"
PERSISTENT_COOKIE_TTL_SECONDS = 180 * 86400  # 180 days


def is_login_or_auth_url(url: str) -> bool:
    """Return True if the browser is currently on a login or OAuth page."""
    if not url or url.startswith("about:"):
        return True
    lowered = url.lower()
    if "accounts.google.com" in lowered or "accounts.youtube.com" in lowered:
        return True
    if "skillcat.app/login" in lowered or "skillcat.app/auth/" in lowered:
        return True
    return False


def has_training_data(html: str) -> bool:
    """Return True if the HTML contains the embedded training_data JSON array."""
    return bool(html and "const training_data =" in html)


def try_fast_http_fetch() -> Optional[str]:
    """
    Attempt to fetch ranked-list.php directly via requests using saved cookies
    from storage_state.json. Since MoodleSession has a 247-day timeout on SkillCat,
    this succeeds in <1s whenever a valid session cookie is saved.
    """
    if not STORAGE_STATE_PATH.exists():
        return None
    try:
        state = json.loads(STORAGE_STATE_PATH.read_text(encoding="utf-8"))
        session = requests.Session()
        session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                )
            }
        )
        for c in state.get("cookies", []):
            domain = c.get("domain", "")
            if "skillcat.app" in domain:
                session.cookies.set(c["name"], c["value"], domain=domain, path=c.get("path", "/"))
        resp = session.get(TARGET_URL, allow_redirects=False, timeout=20)
        if resp.status_code == 200 and has_training_data(resp.text):
            DEBUG_HTML_PATH.write_text(resp.text, encoding="utf-8")
            print("Fetched ranked-list.php directly via saved MoodleSession cookie.", flush=True)
            return resp.text
    except Exception as exc:
        print(f"Fast HTTP fetch skipped: {exc}", flush=True)
    return None


def persist_context_cookies(context) -> None:
    """
    Save all browser cookies (converting session cookies with expires <= 0 into
    persistent cookies with 180-day expiry) to STORAGE_STATE_PATH and re-inject
    them into the Chromium profile so they survive browser closure.
    """
    state = context.storage_state()
    future_exp = int(time.time()) + PERSISTENT_COOKIE_TTL_SECONDS
    updated_cookies = []
    for c in state.get("cookies", []):
        c_copy = dict(c)
        if c_copy.get("expires", -1) <= 0:
            c_copy["expires"] = future_exp
        updated_cookies.append(c_copy)
    state["cookies"] = updated_cookies
    STORAGE_STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")
    try:
        context.add_cookies(updated_cookies)
    except Exception:
        pass


def restore_persisted_cookies(context) -> None:
    """Load saved cookies from STORAGE_STATE_PATH into the Playwright context."""
    if not STORAGE_STATE_PATH.exists():
        return
    try:
        state = json.loads(STORAGE_STATE_PATH.read_text(encoding="utf-8"))
        cookies = state.get("cookies", [])
        if cookies:
            context.add_cookies(cookies)
    except Exception as exc:
        print(f"Warning: could not restore cookies from storage_state.json: {exc}", flush=True)


def fetch_ranked_list_html(
    interactive_login: bool = False,
    allow_snapshot_fallback: bool = True,
    timeout_sec: int = 240,
) -> Tuple[str, bool]:
    """
    Return (html, is_live) for https://skillcat.app/local/skillcat/pages/ranked-list.php.
    """
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    if not interactive_login:
        fast_html = try_fast_http_fetch()
        if fast_html:
            return fast_html, True

    modes = [False] if not interactive_login else [True]
    for headless in [not interactive_login]:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(PROFILE_DIR),
                headless=headless,
                ignore_default_args=["--enable-automation"],
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
                viewport={"width": 1440, "height": 900},
            )
            restore_persisted_cookies(context)

            page = context.pages[0] if context.pages else context.new_page()
            page.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )

            print(f"Navigating to {TARGET_URL} (headless={headless})...", flush=True)
            page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2000)

            if is_login_or_auth_url(page.url):
                print(f"Redirected to login page: {page.url}", flush=True)
                google_btn = page.locator("a.login-identityprovider-btn[href*='provider=google']")
                if google_btn.count() > 0:
                    print("Clicking Google SSO button...", flush=True)
                    google_btn.first.click()
                    page.wait_for_load_state("domcontentloaded")
                    page.wait_for_timeout(3000)

                # Attempt automatic selection on Google Account Chooser & Consent screens
                for _ in range(4):
                    if not is_login_or_auth_url(page.url):
                        break
                    try:
                        acct = page.locator(f"[data-identifier='{SSO_EMAIL}']")
                        if acct.count() > 0 and acct.first.is_visible():
                            # Check if it says "Signed out"
                            acct_text = acct.first.inner_text()
                            if "signed out" not in acct_text.lower():
                                print(f"Selecting active Google account {SSO_EMAIL}...", flush=True)
                                acct.first.click()
                                page.wait_for_timeout(3000)
                                continue
                        # Check for a "Continue" / "Allow" button on OAuth consent page
                        cont_btn = page.locator("button:has-text('Continue'), button:has-text('Allow')")
                        if cont_btn.count() > 0 and cont_btn.first.is_visible():
                            print("Clicking OAuth Continue button...", flush=True)
                            cont_btn.first.click()
                            page.wait_for_timeout(3000)
                            continue
                    except Exception:
                        pass
                    page.wait_for_timeout(1000)

                if is_login_or_auth_url(page.url):
                    if headless:
                        context.close()
                        if allow_snapshot_fallback and DEBUG_HTML_PATH.exists():
                            cached = DEBUG_HTML_PATH.read_text(encoding="utf-8")
                            if has_training_data(cached):
                                print(
                                    "Using cached ranked-list snapshot for employee roster and fetching live portfolios.",
                                    flush=True,
                                )
                                return cached, False
                        raise RuntimeError(
                            "Google SSO session requires interactive login. Run with --login once to save session."
                        )

                    print(
                        f"Waiting up to {timeout_sec}s for interactive Google SSO login ({SSO_EMAIL})...",
                        flush=True,
                    )
                    deadline = time.time() + timeout_sec
                    while time.time() < deadline:
                        logged_in = False
                        for tab in context.pages:
                            cur = tab.url
                            if "skillcat.app" in cur and not is_login_or_auth_url(cur):
                                page = tab
                                logged_in = True
                                print(f"Login succeeded! Landed on: {cur}", flush=True)
                                break
                        if logged_in:
                            break
                        page.wait_for_timeout(1000)
                    else:
                        context.close()
                        raise RuntimeError("Timed out waiting for interactive Google SSO login.")

            if "ranked-list.php" not in page.url:
                print(f"Navigating authenticated session to {TARGET_URL}...", flush=True)
                page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60000)

            page.wait_for_timeout(3000)
            html = page.content()
            if has_training_data(html):
                DEBUG_HTML_PATH.write_text(html, encoding="utf-8")
                persist_context_cookies(context)
                print(
                    f"Saved live ranked-list snapshot ({len(html)} bytes) and persistent session cookies.",
                    flush=True,
                )
                context.close()
                return html, True

            context.close()
            raise RuntimeError("Loaded page did not contain SkillCat training_data.")


def format_elapsed_since_timestamp(unix_ts: int, now_ts: Optional[int] = None) -> str:
    """Format human-readable time elapsed since a Unix timestamp."""
    if not unix_ts:
        return "Never"
    if now_ts is None:
        now_ts = int(time.time())
    diff = max(0, now_ts - unix_ts)
    days = diff // 86400
    rem = diff % 86400
    hours = rem // 3600
    mins = (rem % 3600) // 60
    secs = rem % 60
    parts = []
    if days > 0:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours > 0:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if days == 0 and mins > 0:
        parts.append(f"{mins} min{'s' if mins != 1 else ''}")
    if days == 0 and hours == 0 and secs > 0:
        parts.append(f"{secs} sec{'s' if secs != 1 else ''}")
    return (" ".join(parts) + " ago") if parts else "Just now"


def parse_training_data_from_html(html: str, is_live: bool = True) -> List[Dict[str, Any]]:
    """Extract the training_data array embedded in ranked-list.php."""
    match = re.search(r"const\s+training_data\s*=\s*(\[.*?\]);\s*\n", html, re.DOTALL)
    if not match:
        match = re.search(r"const\s+training_data\s*=\s*(\[.*\]);", html)
    if not match:
        raise ValueError("Could not find `const training_data = [...]` in HTML.")
    raw_list = json.loads(match.group(1))
    now_ts = int(time.time())
    employees = []
    for item in raw_list:
        fullname = " ".join(str(item.get("fullname", "")).split())
        last_access_raw = item.get("last_access") or item.get("last_new_log")
        last_access_ts = int(last_access_raw) if str(last_access_raw).isdigit() else 0
        last_login_str = str(item.get("last_login") or "").strip()
        if not is_live and last_access_ts > 0:
            last_login_str = format_elapsed_since_timestamp(last_access_ts, now_ts)
        elif not last_login_str:
            last_login_str = format_elapsed_since_timestamp(last_access_ts, now_ts)

        employees.append(
            {
                "userid": str(item.get("userid", "")),
                "fullname": fullname,
                "email": item.get("email", ""),
                "last_login": last_login_str,
                "last_access": last_access_ts,
                "portfolio_link": item.get("portfolio_link", ""),
                "learning_plans": [
                    lp.get("name", "") for lp in (item.get("user_lps") or []) if lp.get("name")
                ],
            }
        )
    return employees


def classify_course_pathway(course_name: str) -> str:
    """Classify a SkillCat course/module title into a Turn90 SkillCat Trade Pathway."""
    lower = (course_name or "").lower()
    if any(k in lower for k in ["hvac", "epa 608", "refrigerant", "duct", "condensate", "furnace", "heat pump", "air conditioning", "thermostat"]):
        return "HVAC"
    if any(k in lower for k in ["electr", "fuse", "breaker", "multimeter", "wiring", "voltage", "circuit", "conduit", "ohm"]):
        return "Electrical"
    if any(k in lower for k in ["plumb", "pipe", "piping", "drain", "faucet", "toilet", "water heater", "valve"]):
        return "Plumbing"
    if any(k in lower for k in ["appliance", "maintenance", "carpentry", "drywall", "paint", "lock", "facilities", "measurement", "tool"]):
        return "Facilities_Maintenance"
    if any(k in lower for k in ["cdl", "commercial driving", "forklift", "osha", "safety", "lockout"]):
        return "Commercial_Safety"
    return "Work_Readiness_General"


def summarize_employee_pathway_and_flags(
    completed_courses: List[Dict[str, str]],
    learning_plans: List[str],
    flagged_2_working_days: bool,
    completed_last_5_working_days: int,
    cutoff_5_working_date: str,
) -> Dict[str, Any]:
    """Compute primary trade pathway, module breakdown, recent modules, and progress flags."""
    breakdown: Dict[str, int] = {}
    recent_modules: List[str] = []
    for c in completed_courses:
        cname = c.get("course_name", "")
        cdate = c.get("completed_date", "")
        p = classify_course_pathway(cname)
        breakdown[p] = breakdown.get(p, 0) + 1
        if cdate and cdate >= cutoff_5_working_date:
            recent_modules.append(f"{cname} ({cdate})")

    # Determine primary trade pathway (excluding Work_Readiness_General if trade modules exist)
    trade_counts = {k: v for k, v in breakdown.items() if k != "Work_Readiness_General"}
    if trade_counts:
        primary_pathway = max(trade_counts.items(), key=lambda kv: kv[1])[0]
    elif breakdown:
        primary_pathway = "Work_Readiness_General"
    else:
        primary_pathway = "Unassigned"

    flags: List[str] = []
    if len(completed_courses) == 0:
        flags.append("FLAG-SKILLCAT-ZERO: 0 modules completed on SkillCat")
    elif flagged_2_working_days:
        flags.append("FLAG-SKILLCAT-STALL: No modules completed in last 2 working days")
    if len(trade_counts) >= 3 and max(trade_counts.values()) < 3:
        flags.append("FLAG-PATHWAY-DRIFT: Scattered across 3+ trades without core pathway depth")

    return {
        "pathway": primary_pathway,
        "pathway_breakdown": breakdown,
        "recent_modules_last_5_days": recent_modules,
        "pathway_flags": flags,
    }


def fetch_employee_portfolio(emp: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fetch an employee's SkillCat portfolio page and extract all completed courses
    and their completion dates.
    """
    url = emp.get("portfolio_link", "")
    completed_courses: List[Dict[str, str]] = []
    if url:
        try:
            resp = requests.get(url, timeout=25)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "lxml")
                section = (
                    soup.find("section", attrs={"data-region": "courses-section"}) or soup
                )
                for card in section.find_all("div", class_="course-card"):
                    name_el = card.find(class_="course-name")
                    date_el = card.find(class_="completion-date")
                    course_name = name_el.get_text(" ", strip=True) if name_el else ""
                    raw_date = (
                        date_el.get_text(" ", strip=True).replace("Completed:", "").strip()
                        if date_el
                        else ""
                    )
                    iso_date = ""
                    if raw_date:
                        try:
                            iso_date = datetime.strptime(raw_date, "%d %B %Y").date().isoformat()
                        except ValueError:
                            iso_date = raw_date
                    completed_courses.append(
                        {
                            "course_name": course_name,
                            "completed_date": iso_date,
                            "completed_date_raw": raw_date,
                        }
                    )
        except Exception as exc:
            print(f"Warning: failed to fetch portfolio for {emp['fullname']}: {exc}", flush=True)

    emp_result = dict(emp)
    emp_result["completed_courses"] = completed_courses
    emp_result["total_courses"] = len(completed_courses)
    return emp_result


def get_last_n_working_days(ref_date: date, n: int = 2) -> List[date]:
    """
    Return the last `n` working days (Monday=0 .. Friday=4) on or before `ref_date`,
    ordered oldest to newest.
    """
    working_days: List[date] = []
    cur = ref_date
    while len(working_days) < n:
        if cur.weekday() < 5:
            working_days.append(cur)
        cur -= timedelta(days=1)
    working_days.reverse()
    return working_days


def update_history_and_compute_metrics(
    employees: List[Dict[str, Any]], report_date: date
) -> Tuple[List[Dict[str, Any]], List[date]]:
    """
    Update skillcat_history.json and compute for each employee:
      - total_courses
      - daily_delta (courses completed relative to the day before)
      - latest_completion_date
      - flagged_2_working_days (True if no course completed within last 2 working days)
    """
    history: Dict[str, Any] = {"snapshots": {}}
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
            if "snapshots" not in history:
                history["snapshots"] = {}
        except Exception:
            history = {"snapshots": {}}

    snapshots: Dict[str, Dict[str, Any]] = history["snapshots"]

    # Backfill prior 7 days from exact portfolio completion dates if not already present
    for offset in range(7, 0, -1):
        past_d = (report_date - timedelta(days=offset)).isoformat()
        if past_d not in snapshots:
            past_snap: Dict[str, Any] = {}
            for emp in employees:
                uid = emp["userid"]
                cnt = sum(
                    1
                    for c in emp.get("completed_courses", [])
                    if c.get("completed_date") and c["completed_date"] <= past_d
                )
                past_snap[uid] = {
                    "userid": uid,
                    "fullname": emp["fullname"],
                    "total_courses": cnt,
                    "reconstructed_from_portfolio": True,
                }
            snapshots[past_d] = past_snap

    yesterday_str = (report_date - timedelta(days=1)).isoformat()
    today_str = report_date.isoformat()
    working_window = get_last_n_working_days(report_date, n=2)
    cutoff_working_date = working_window[0].isoformat()
    working_window_5 = get_last_n_working_days(report_date, n=5)
    cutoff_5_working_date = working_window_5[0].isoformat()
    baseline_5_date_str = (working_window_5[0] - timedelta(days=1)).isoformat()
    baseline_5_snap = snapshots.get(baseline_5_date_str, {})

    yesterday_snap = snapshots.get(yesterday_str, {})
    today_snap: Dict[str, Any] = {}
    enriched: List[Dict[str, Any]] = []

    for emp in employees:
        uid = emp["userid"]
        total_courses = emp["total_courses"]
        valid_dates = sorted(
            [
                c["completed_date"]
                for c in emp.get("completed_courses", [])
                if re.match(r"^\d{4}-\d{2}-\d{2}$", c.get("completed_date", ""))
            ]
        )
        latest_completion = valid_dates[-1] if valid_dates else None

        # Courses completed relative to the day before
        if uid in yesterday_snap and "total_courses" in yesterday_snap[uid]:
            prev_total = int(yesterday_snap[uid]["total_courses"])
            daily_delta = total_courses - prev_total
        else:
            daily_delta = sum(1 for d in valid_dates if d == today_str)
            prev_total = total_courses - daily_delta

        # Check if completed a course within the last 2 working days
        completed_in_window_by_date = any(d >= cutoff_working_date for d in valid_dates)
        # Also check snapshot progression across the 2-working-day window in case a course lacked a date
        baseline_date_str = (working_window[0] - timedelta(days=1)).isoformat()
        baseline_snap = snapshots.get(baseline_date_str, {})
        completed_in_window_by_snap = (
            uid in baseline_snap
            and total_courses > int(baseline_snap[uid].get("total_courses", total_courses))
        )
        completed_in_last_2_working_days = (
            completed_in_window_by_date or completed_in_window_by_snap
        )
        flagged = not completed_in_last_2_working_days

        completed_5_by_date = sum(1 for d in valid_dates if d >= cutoff_5_working_date)
        completed_5_by_snap = (
            max(0, total_courses - int(baseline_5_snap[uid].get("total_courses", total_courses)))
            if uid in baseline_5_snap
            else 0
        )
        completed_last_5_working_days = max(completed_5_by_date, completed_5_by_snap)

        pathway_info = summarize_employee_pathway_and_flags(
            emp.get("completed_courses", []),
            emp.get("learning_plans", []),
            flagged,
            completed_last_5_working_days,
            cutoff_5_working_date,
        )

        record = dict(emp)
        record.update(
            {
                "previous_day_courses": prev_total,
                "daily_delta": daily_delta,
                "latest_completion_date": latest_completion,
                "flagged_2_working_days": flagged,
                "completed_last_5_working_days": completed_last_5_working_days,
                **pathway_info,
            }
        )
        enriched.append(record)

        today_snap[uid] = {
            "userid": uid,
            "fullname": emp["fullname"],
            "last_login": emp["last_login"],
            "last_access": emp["last_access"],
            "portfolio_link": emp.get("portfolio_link", ""),
            "learning_plans": emp.get("learning_plans", []),
            "total_courses": total_courses,
            "previous_day_courses": prev_total,
            "daily_delta": daily_delta,
            "latest_completion_date": latest_completion,
            "flagged_2_working_days": flagged,
            "completed_last_5_working_days": completed_last_5_working_days,
            "completed_courses": emp.get("completed_courses", []),
            **pathway_info,
            "updated_at": datetime.now().isoformat(),
        }

    snapshots[today_str] = today_snap
    HISTORY_PATH.write_text(json.dumps(history, indent=2), encoding="utf-8")
    return enriched, working_window


def generate_pdf_report(
    records: List[Dict[str, Any]],
    report_date: date,
    working_window: List[date],
    output_path: Path,
) -> None:
    """Render a clean, executive-ready PDF supervision report."""
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=letter,
        leftMargin=0.4 * inch,
        rightMargin=0.4 * inch,
        topMargin=0.4 * inch,
        bottomMargin=0.4 * inch,
        title=f"SkillCat Supervision Report - {report_date.isoformat()}",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#1E293B"),
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "ReportSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#475569"),
        spaceAfter=12,
    )
    cell_style = ParagraphStyle(
        "TableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.8,
        leading=11,
        textColor=colors.HexColor("#0F172A"),
    )
    cell_bold_style = ParagraphStyle(
        "TableCellBold",
        parent=cell_style,
        fontName="Helvetica-Bold",
    )
    flag_bad_style = ParagraphStyle(
        "FlagBad",
        parent=cell_style,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#B91C1C"),
    )
    flag_ok_style = ParagraphStyle(
        "FlagOk",
        parent=cell_style,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#15803D"),
    )

    total_users = len(records)
    flagged_users = sum(1 for r in records if r["flagged_2_working_days"])
    active_users = total_users - flagged_users
    total_delta = sum(r["daily_delta"] for r in records)

    win_start = working_window[0].strftime("%b %d, %Y")
    win_end = working_window[-1].strftime("%b %d, %Y")
    gen_ts = datetime.now().strftime("%b %d, %Y at %I:%M %p")

    elements = []
    elements.append(Paragraph("SkillCat Daily Supervision Report", title_style))
    elements.append(
        Paragraph(
            f"<b>Report Date:</b> {report_date.strftime('%B %d, %Y')} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"<b>2-Working-Day Activity Window:</b> {win_start} – {win_end} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"<b>Generated:</b> {gen_ts}",
            subtitle_style,
        )
    )

    # Summary KPI Banner Table
    kpi_data = [
        [
            Paragraph("<b>Total Learners</b>", subtitle_style),
            Paragraph("<b>Active (Last 2 Work Days)</b>", subtitle_style),
            Paragraph("<b>Flagged (No Course in 2 Work Days)</b>", subtitle_style),
            Paragraph("<b>Courses Completed vs. Yesterday</b>", subtitle_style),
        ],
        [
            Paragraph(f"<font size=14><b>{total_users}</b></font>", cell_bold_style),
            Paragraph(
                f"<font size=14 color='#15803D'><b>{active_users}</b></font>",
                cell_bold_style,
            ),
            Paragraph(
                f"<font size=14 color='#B91C1C'><b>{flagged_users}</b></font>",
                cell_bold_style,
            ),
            Paragraph(
                f"<font size=14 color='#0369A1'><b>{'+' if total_delta >= 0 else ''}{total_delta}</b></font>",
                cell_bold_style,
            ),
        ],
    ]
    kpi_table = Table(
        kpi_data,
        colWidths=[1.7 * inch, 1.9 * inch, 2.2 * inch, 1.8 * inch],
    )
    kpi_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#CBD5E1")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    elements.append(kpi_table)
    elements.append(Spacer(1, 14))

    # Main Learner Table
    headers = [
        "#",
        "Name",
        "Time Since Last Sign-In",
        "Courses\nCompleted",
        "vs. Day\nBefore",
        "Last Course\nCompleted",
        "2-Working-Day Status",
    ]
    table_rows = [headers]

    row_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8.8),
        ("LEADING", (0, 0), (-1, 0), 11),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (3, 0), (5, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
    ]

    for idx, rec in enumerate(records, start=1):
        delta = rec["daily_delta"]
        if delta > 0:
            delta_str = f"+{delta}"
        elif delta < 0:
            delta_str = str(delta)
        else:
            delta_str = "0"

        latest_dt_str = "Never"
        if rec.get("latest_completion_date"):
            try:
                dt_obj = datetime.strptime(rec["latest_completion_date"], "%Y-%m-%d").date()
                latest_dt_str = dt_obj.strftime("%b %d, %Y")
            except ValueError:
                latest_dt_str = str(rec["latest_completion_date"])

        is_flagged = rec["flagged_2_working_days"]
        if is_flagged:
            status_para = Paragraph("FLAGGED (No course in 2d)", flag_bad_style)
            bg_color = colors.HexColor("#FEF2F2")
        else:
            status_para = Paragraph("OK (Active)", flag_ok_style)
            bg_color = colors.white if idx % 2 == 1 else colors.HexColor("#F8FAFC")

        row_styles.append(("BACKGROUND", (0, idx), (-1, idx), bg_color))
        if delta > 0:
            row_styles.append(("TEXTCOLOR", (4, idx), (4, idx), colors.HexColor("#15803D")))
            row_styles.append(("FONTNAME", (4, idx), (4, idx), "Helvetica-Bold"))

        table_rows.append(
            [
                str(idx),
                Paragraph(rec["fullname"], cell_bold_style if is_flagged else cell_style),
                Paragraph(rec["last_login"], cell_style),
                str(rec["total_courses"]),
                delta_str,
                latest_dt_str,
                status_para,
            ]
        )

    main_table = Table(
        table_rows,
        colWidths=[
            0.32 * inch,
            1.45 * inch,
            1.40 * inch,
            0.80 * inch,
            0.68 * inch,
            0.95 * inch,
            2.10 * inch,
        ],
        repeatRows=1,
    )
    main_table.setStyle(TableStyle(row_styles))
    elements.append(main_table)

    doc.build(elements)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scrape SkillCat ranked list and generate daily PDF supervision report."
    )
    parser.add_argument(
        "--login",
        action="store_true",
        help="Launch visible browser window for Google SSO login.",
    )
    parser.add_argument(
        "--from-snapshot",
        action="store_true",
        help="Use existing last_page_snapshot.html for roster and fetch live portfolios.",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Override report date (YYYY-MM-DD), defaults to today.",
    )
    args = parser.parse_args()

    report_date = (
        datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else date.today()
    )

    if args.from_snapshot and DEBUG_HTML_PATH.exists():
        html = DEBUG_HTML_PATH.read_text(encoding="utf-8")
        is_live = True
    else:
        html, is_live = fetch_ranked_list_html(
            interactive_login=args.login,
            allow_snapshot_fallback=True,
        )

    employees = parse_training_data_from_html(html, is_live=is_live)
    print(f"Parsed {len(employees)} employees from ranked-list. Fetching portfolios...", flush=True)

    with ThreadPoolExecutor(max_workers=8) as executor:
        employees_with_courses = list(executor.map(fetch_employee_portfolio, employees))

    enriched_records, working_window = update_history_and_compute_metrics(
        employees_with_courses, report_date=report_date
    )

    pdf_filename = f"SkillCat_Supervision_Report_{report_date.isoformat()}.pdf"
    pdf_path = BASE_DIR / pdf_filename
    latest_pdf_path = BASE_DIR / "SkillCat_Supervision_Report_Latest.pdf"

    generate_pdf_report(
        records=enriched_records,
        report_date=report_date,
        working_window=working_window,
        output_path=pdf_path,
    )
    shutil.copyfile(pdf_path, latest_pdf_path)

    flagged_count = sum(1 for r in enriched_records if r["flagged_2_working_days"])
    print(
        f"Report generated successfully: {pdf_path} "
        f"({len(enriched_records)} learners, {flagged_count} flagged).",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
