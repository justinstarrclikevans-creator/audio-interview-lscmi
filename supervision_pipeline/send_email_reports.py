#!/usr/bin/env python3
"""
Gmail SMTP Report Dispatcher for Turn90 Combined Supervision Reports.

Emails generated PDF reports (Universal, Charleston, Columbia, Spartanburg, SkillCat)
to designated recipients via Gmail SMTP using a Google App Password.

Configuration:
  1. Set SMTP_EMAIL (e.g. justin@turnninety.com) and SMTP_PASSWORD (16-char Google
     App Password) in .env.
  2. Edit email_routing.json to map each report scope to recipient email addresses.
"""

import argparse
import json
import os
import smtplib
import sys
from datetime import date
from email.message import EmailMessage
from pathlib import Path
from typing import Dict, List

BASE_DIR = Path(__file__).resolve().parent
REPORTS_DIR = BASE_DIR / "reports"
ROUTING_PATH = BASE_DIR / "email_routing.json"

DEFAULT_ROUTING = {
    "Universal": [],
    "Charleston": [],
    "Columbia": [],
    "Spartanburg": [],
    "SkillCat": [],
}


def load_env_files() -> None:
    """Load key=value pairs from local .env files if not already set."""
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


def ensure_routing_file() -> Dict[str, List[str]]:
    """Create email_routing.json template if missing and return routing config."""
    if not ROUTING_PATH.exists():
        ROUTING_PATH.write_text(json.dumps(DEFAULT_ROUTING, indent=2) + "\n", encoding="utf-8")
        return dict(DEFAULT_ROUTING)
    return json.loads(ROUTING_PATH.read_text(encoding="utf-8"))


def send_pdf_email(
    smtp_host: str,
    smtp_port: int,
    sender: str,
    password: str,
    recipients: List[str],
    subject: str,
    body: str,
    pdf_path: Path,
) -> None:
    """Send an email with a single PDF attachment over SMTP_SSL."""
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(body)
    msg.add_attachment(
        pdf_path.read_bytes(),
        maintype="application",
        subtype="pdf",
        filename=pdf_path.name,
    )

    with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30) as server:
        server.login(sender, password)
        server.send_message(msg)


def dispatch_emails(report_date: date, dry_run: bool = False) -> int:
    """Send configured PDF reports to their email recipients."""
    load_env_files()
    routing = ensure_routing_file()

    sender = os.environ.get("SMTP_EMAIL", "justin@turnninety.com").strip()
    password = os.environ.get("SMTP_PASSWORD", "").strip()
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip()
    smtp_port = int(os.environ.get("SMTP_PORT", "465"))

    if not password and not dry_run:
        print(
            "SMTP_PASSWORD not set in .env — skipping Gmail delivery. "
            f"Add SMTP_EMAIL and SMTP_PASSWORD (Google App Password) and configure {ROUTING_PATH.name}.",
            flush=True,
        )
        return 0

    date_str = report_date.isoformat()
    report_files = {
        "Universal": REPORTS_DIR / date_str / f"Turn90_Combined_Report_Universal_{date_str}.pdf",
        "Charleston": REPORTS_DIR / date_str / f"Turn90_Combined_Report_Charleston_{date_str}.pdf",
        "Columbia": REPORTS_DIR / date_str / f"Turn90_Combined_Report_Columbia_{date_str}.pdf",
        "Spartanburg": REPORTS_DIR / date_str / f"Turn90_Combined_Report_Spartanburg_{date_str}.pdf",
        "SkillCat": BASE_DIR / f"SkillCat_Supervision_Report_{date_str}.pdf",
    }

    sent_count = 0
    for scope, recipients in routing.items():
        clean_recipients = [r.strip() for r in (recipients or []) if r and r.strip()]
        if not clean_recipients:
            continue
        pdf_path = report_files.get(scope)
        if not pdf_path or not pdf_path.exists():
            print(f"Skipping email scope '{scope}': file not found ({pdf_path})", flush=True)
            continue

        subject = f"Turn90 {scope} Supervision Report — {date_str}"
        body = (
            f"Hello,\n\n"
            f"Attached is the Turn90 {scope} Supervision Report for {date_str}.\n\n"
            f"Automated Turn90 Reporting Pipeline"
        )

        if dry_run:
            print(f"[DRY RUN] Would email {pdf_path.name} -> {clean_recipients}", flush=True)
            sent_count += 1
            continue

        send_pdf_email(
            smtp_host=smtp_host,
            smtp_port=smtp_port,
            sender=sender,
            password=password,
            recipients=clean_recipients,
            subject=subject,
            body=body,
            pdf_path=pdf_path,
        )
        print(f"Emailed {pdf_path.name} -> {', '.join(clean_recipients)}", flush=True)
        sent_count += 1

    if sent_count == 0:
        print(f"No email recipients configured in {ROUTING_PATH}.", flush=True)
    return sent_count


def main() -> int:
    parser = argparse.ArgumentParser(description="Email Turn90 PDF reports via Gmail SMTP.")
    parser.add_argument("--date", type=str, default=None, help="Report date YYYY-MM-DD (default: today).")
    parser.add_argument("--dry-run", action="store_true", help="Print planned emails without sending.")
    args = parser.parse_args()

    report_date = date.fromisoformat(args.date) if args.date else date.today()
    dispatch_emails(report_date=report_date, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
