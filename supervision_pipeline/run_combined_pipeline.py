#!/usr/bin/env python3
"""
End-to-End Turn90 Supervision & Apricot Combined Pipeline.

1. Automatically runs & exports Apricot Report 486 (.xlsx) via scrape_apricot.py
2. Scrapes SkillCat ranked list & portfolios via scrape_skillcat.py
3. Generates Universal + Per-Location (Charleston, Columbia, Spartanburg)
   combined PDF & Markdown reports via generate_combined_report.py
"""

import argparse
import subprocess
import sys
from datetime import date
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def run_step(cmd: list[str], label: str) -> None:
    print(f"\n=== {label} ===", flush=True)
    result = subprocess.run(cmd, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {result.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run full Apricot + SkillCat + Combined Report pipeline.")
    parser.add_argument("--login-apricot", action="store_true", help="Interactive browser login for Apricot.")
    parser.add_argument("--login-skillcat", action="store_true", help="Interactive browser login for SkillCat.")
    parser.add_argument("--skip-apricot", action="store_true", help="Skip live Apricot export and use latest local XLSX.")
    parser.add_argument("--skip-skillcat", action="store_true", help="Skip live SkillCat scrape and use skillcat_history.json.")
    parser.add_argument("--xlsx", type=str, default=None, help="Explicit Apricot XLSX path (implies --skip-apricot).")
    parser.add_argument("--date", type=str, default=None, help="Override report date (YYYY-MM-DD).")
    parser.add_argument("--no-ai", action="store_true", help="Disable Gemini AI case note feedback.")
    parser.add_argument("--no-email", action="store_true", help="Skip Gmail report delivery.")
    parser.add_argument("--slack", action="store_true", help="Also run Slack report delivery.")
    args = parser.parse_args()

    report_date = args.date or date.today().isoformat()
    py = sys.executable

    if not args.skip_apricot and not args.xlsx:
        cmd = [py, str(BASE_DIR / "scrape_apricot.py"), "--date", report_date]
        if args.login_apricot:
            cmd.append("--login")
        run_step(cmd, "Step 1: Automated Apricot Report 486 Export")

    if not args.skip_skillcat:
        cmd = [py, str(BASE_DIR / "scrape_skillcat.py"), "--date", report_date]
        if args.login_skillcat:
            cmd.append("--login")
        run_step(cmd, "Step 2: SkillCat Daily Scrape")

    cmd = [py, str(BASE_DIR / "generate_combined_report.py"), "--date", report_date]
    if args.xlsx:
        cmd.extend(["--xlsx", args.xlsx])
    if args.no_ai:
        cmd.append("--no-ai")
    run_step(cmd, "Step 3: Combined Report Generation (Universal + Per-Location)")

    if not args.no_email:
        run_step(
            [py, str(BASE_DIR / "send_email_reports.py"), "--date", report_date],
            "Step 4: Gmail Report Delivery",
        )

    if args.slack:
        run_step(
            [py, str(BASE_DIR / "send_slack_reports.py"), "--date", report_date],
            "Step 5: Slack Report Delivery",
        )

    print("\nPipeline completed successfully.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
