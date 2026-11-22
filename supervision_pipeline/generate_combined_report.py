#!/usr/bin/env python3
"""
Turn90 Combined Apricot + SkillCat Operational & Supervision Report Generator.

Implements all specifications from App development-4.pdf:
  1. First Shift Payment Report (Last Week Mon-Fri pts * $9, Current Week Enrollments, Last Week Exits)
  2. Funnel Report (Enrollments/Exits + Exit Reasons, Resource Coord -> Consultations -> Orientation -> Day 1, Waitlist)
  3. Active Program Dashboards (First Shift & Reentry Navigation)
  4. SkillCat Progress (Total modules + Last 5 working days)
  5. Case Plan & Briefcase Feedback (Detailed per-participant feedback from Case Notes, batched by Case Manager)
  6. Employment Retention (30/60/90/180 days from Employment Historical)
  7. Referrals & Credentials (By Center & Case Manager)
  8. Flags (Points <25%, Missing CM Session / Drug Test, Missing Case Plan / Briefcase, <25%/wk Briefcase, 7d No Contact, 30d No Job Check-in)

Outputs:
  - Universal Report (PDF + Markdown)
  - Per-Location Reports for Charleston, Columbia, and Spartanburg (PDF + Markdown)
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import openpyxl
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BASE_DIR = Path(__file__).resolve().parent
EXPORTS_DIR = BASE_DIR / "apricot_exports"
REPORTS_DIR = BASE_DIR / "reports"
SKILLCAT_HISTORY_PATH = BASE_DIR / "skillcat_history.json"
FEEDBACK_CACHE_PATH = BASE_DIR / "case_feedback_cache.json"

CENTERS = ["Charleston", "Columbia", "Spartanburg"]
CENTER_CM_MAP = {
    "Charleston": "TB",
    "Columbia": "Jenn",
    "Spartanburg": "DiYoung",
}

GATE_DENOMINATORS = {1: 8, 2: 10, 3: 7, 4: 8}
TOTAL_BRIEFCASE_ITEMS = sum(GATE_DENOMINATORS.values())  # 33


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


def find_latest_xlsx(explicit_path: Optional[str] = None) -> Path:
    """Locate the Apricot XLSX workbook to process."""
    if explicit_path:
        p = Path(explicit_path).expanduser().resolve()
        if not p.exists():
            raise FileNotFoundError(f"Specified XLSX not found: {p}")
        return p

    latest_export = EXPORTS_DIR / "apricot_latest.xlsx"
    if latest_export.exists():
        return latest_export

    candidates: List[Path] = []
    for folder in [EXPORTS_DIR, Path.home() / "Downloads", BASE_DIR.parent.parent / "docs" / "apricot"]:
        if folder.exists():
            candidates.extend(folder.glob("*Main report*.xlsx"))
            candidates.extend(folder.glob("Justin_Main_Report_*.xlsx"))
    candidates = [c for c in candidates if not c.name.startswith("~$")]
    if not candidates:
        raise FileNotFoundError(
            "No Apricot XLSX workbook found. Run `python3 scrape_apricot.py` first or pass `--xlsx <path>`."
        )
    return max(candidates, key=lambda p: p.stat().st_mtime)


def parse_date(val: Any) -> Optional[date]:
    """Parse common date formats from Excel cells into a datetime.date."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s or s in ("--", "None", "N/A", "null"):
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def norm_str(val: Any) -> str:
    """Normalize cell values to clean strings."""
    if val is None:
        return ""
    s = str(val).strip()
    return "" if s in ("None", "--") else s


def norm_center(val: Any) -> str:
    """Normalize center names."""
    s = norm_str(val)
    if not s:
        return ""
    low = s.lower()
    if "charleston" in low or low == "chs":
        return "Charleston"
    if "columbia" in low or low == "col":
        return "Columbia"
    if "spartanburg" in low or low == "spb":
        return "Spartanburg"
    if "macdougal" in low:
        return "MacDougal Prison"
    return s


def norm_program(val: Any) -> str:
    """Normalize program names."""
    s = norm_str(val)
    low = s.lower()
    if "first shift" in low:
        return "First Shift"
    if "reentry" in low:
        return "Reentry Navigation"
    if "pre-release" in low or "prerelease" in low:
        return "Prerelease"
    return s


def get_last_n_working_days(ref_date: date, n: int = 5) -> List[date]:
    """Return the last n weekdays (Mon-Fri) on or before ref_date, oldest to newest."""
    days: List[date] = []
    cur = ref_date
    while len(days) < n:
        if cur.weekday() < 5:
            days.append(cur)
        cur -= timedelta(days=1)
    days.reverse()
    return days


def read_sheet_rows(wb: openpyxl.Workbook, candidate_names: List[str]) -> List[Dict[str, Any]]:
    """Read rows from the first matching sheet name as list of dicts."""
    sheet_name = next((n for n in candidate_names if n in wb.sheetnames), None)
    if not sheet_name:
        return []
    ws = wb[sheet_name]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        headers = [norm_str(h) for h in next(rows_iter)]
    except StopIteration:
        return []
    records: List[Dict[str, Any]] = []
    for row in rows_iter:
        if not any(cell is not None and str(cell).strip() != "" for cell in row):
            continue
        rec: Dict[str, Any] = {}
        for idx, h in enumerate(headers):
            if h:
                rec[h] = row[idx] if idx < len(row) else None
        records.append(rec)
    return records


def dedupe_records(rows: List[Dict[str, Any]], key_fn) -> List[Dict[str, Any]]:
    """Deduplicate rows preserving first occurrence."""
    seen = set()
    out = []
    for r in rows:
        k = key_fn(r)
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def compute_weeks_enrolled(start_dt: Optional[date], ref_date: date) -> int:
    """Start date is Week 1; increments every Monday after."""
    if not start_dt or start_dt > ref_date:
        return 1 if start_dt else 0
    start_monday = start_dt - timedelta(days=start_dt.weekday())
    ref_monday = ref_date - timedelta(days=ref_date.weekday())
    weeks = ((ref_monday - start_monday).days // 7) + 1
    return max(1, weeks)


def generate_ai_case_feedback(
    participant: Dict[str, Any],
    notes: List[Dict[str, Any]],
    cache: Dict[str, str],
    use_ai: bool = True,
) -> str:
    """
    Generate detailed feedback based on case notes evaluating how well Case Plan
    and Briefcase are being addressed. Uses Gemini if available and enabled,
    cached by participant + note content hash, with deterministic fallback.
    """
    notes_sig_payload = json.dumps(
        [
            (n["date_str"], n["staff"], n["context"], n["interaction"], n["notes"][:300])
            for n in notes[:10]
        ],
        sort_keys=True,
    )
    cp_sig = f"{participant['program']}|{participant['case_plan_ok']}|{participant['gate_pcts']}|{notes_sig_payload}"
    cache_key = f"{participant['record_id']}:{hashlib.sha256(cp_sig.encode()).hexdigest()[:16]}"
    if cache_key in cache:
        return cache[cache_key]

    # Deterministic structured summary (used as fallback or when --no-ai)
    g = participant["gate_pcts"]
    gate_str = f"G1:{g[1]}% G2:{g[2]}% G3:{g[3]}% G4:{g[4]}%"
    recent_note = notes[0] if notes else None
    fallback_parts = []
    if not participant["case_plan_ok"]:
        fallback_parts.append("Case Plan incomplete/missing in Apricot.")
    else:
        fallback_parts.append("Case Plan on file.")
    if not participant["briefcase_exists"]:
        fallback_parts.append("Briefcase not initialized (0% across Gates 1-4).")
    else:
        fallback_parts.append(f"Briefcase progress: {gate_str}.")
    if recent_note:
        snippet = recent_note["notes"][:180].replace("\n", " ").strip()
        fallback_parts.append(
            f"Latest note ({recent_note['date_str']}, {recent_note['staff']}): {recent_note['context'] or recent_note['interaction']}. {snippet}"
        )
    else:
        fallback_parts.append("No case notes logged for this enrollment.")
    fallback_text = " ".join(fallback_parts)

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not use_ai or not api_key or not notes:
        cache[cache_key] = fallback_text
        return fallback_text

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        notes_text = "\n".join(
            f"- [{n['date_str']}] ({n['staff']} | {n['context']} | {n['interaction']}): {n['notes'][:400]}"
            for n in notes[:6]
        )
        prompt = (
            f"You are a Turn90 program supervisor reviewing case notes for {participant['fullname']} "
            f"(Program: {participant['program']}, Center: {participant['center']}, Case Manager: {participant['case_manager']}).\n"
            f"Case Plan Status: {'Complete' if participant['case_plan_ok'] else 'Incomplete/Missing'} "
            f"({participant.get('case_plan_detail', 'N/A')})\n"
            f"Briefcase Progress: {gate_str} (Initialized: {participant['briefcase_exists']})\n"
            f"Recent Case Notes (newest first):\n{notes_text}\n\n"
            "Write 2-3 concise, concrete sentences of supervisory feedback on how well the team is "
            "addressing their Case Plan and Briefcase based ONLY on the facts above, and state the immediate next step."
        )
        fast_model = os.environ.get("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite").strip()
        resp = client.models.generate_content(model=fast_model, contents=prompt)
        text = (resp.text or "").strip().replace("\n", " ")
        if text:
            cache[cache_key] = text
            return text
    except Exception:
        pass

    cache[cache_key] = fallback_text
    return fallback_text


def build_report_data(xlsx_path: Path, report_date: date, use_ai: bool = True) -> Dict[str, Any]:
    """Parse Apricot XLSX + SkillCat history and compute all metrics required by App development-4.pdf."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)

    # Time windows
    curr_mon = report_date - timedelta(days=report_date.weekday())
    curr_fri = curr_mon + timedelta(days=4)
    prev_mon = curr_mon - timedelta(days=7)
    prev_fri = prev_mon + timedelta(days=4)
    ytd_start = date(report_date.year, 1, 1)

    # Load sheets
    raw_enrollments = read_sheet_rows(wb, ["Enrollments and Exits - Rows"])
    raw_res_coord = read_sheet_rows(wb, ["Funnel-Resource Coordin - Rows"])
    raw_consults = read_sheet_rows(wb, ["Funnel-Reentry Consulta - Rows"])
    raw_waitlist = read_sheet_rows(wb, ["Waitlist - Rows"])
    raw_orientation = read_sheet_rows(wb, ["Orientation - Rows"])
    raw_points = read_sheet_rows(wb, ["Points - Rows", "First Shift Points - Rows"])
    raw_fs_cp = read_sheet_rows(wb, ["First Shift Case Plan - Rows"])
    raw_rn_cp = read_sheet_rows(wb, ["Reentry Nav Case Plan - Rows"])
    raw_referrals = read_sheet_rows(wb, ["Referrals - Rows"])
    raw_briefcase = read_sheet_rows(wb, ["Briefcase - Rows"])
    raw_lscmi = read_sheet_rows(wb, ["LSCMI - Rows"])
    raw_bio = read_sheet_rows(wb, ["Bio Info - Rows"])
    raw_employment = read_sheet_rows(wb, ["Employment - Rows"])
    raw_emp_hist = read_sheet_rows(wb, ["Employment Historical - Rows"])
    raw_drug_test = read_sheet_rows(wb, ["Drug Test - Rows"])
    raw_case_notes = read_sheet_rows(wb, ["Case Notes - Rows"])
    raw_credentials = read_sheet_rows(wb, ["Credentials - Rows"])

    # Helper: infer center across sheets for any record_id
    inferred_center: Dict[str, str] = {}
    for sheet_rows in [raw_enrollments, raw_points, raw_fs_cp, raw_bio, raw_briefcase, raw_case_notes]:
        for r in sheet_rows:
            rid = norm_str(r.get("Record ID"))
            c = norm_center(r.get("At which Turn90 Center is the client...") or r.get("Preferred enrollment location"))
            if rid and c in CENTERS and rid not in inferred_center:
                inferred_center[rid] = c

    # Deduplicate Enrollments
    enrollments = dedupe_records(
        raw_enrollments,
        lambda r: (
            norm_str(r.get("Record ID")),
            norm_program(r.get("Program Enrollment:") or r.get("Which Program?")),
            norm_str(r.get("Enrollment Start Date:")),
            norm_str(r.get("Date enrollment ended:")),
        ),
    )

    # Bio Info map
    bio_by_id: Dict[str, Dict[str, str]] = {}
    for r in raw_bio:
        rid = norm_str(r.get("Record ID"))
        if not rid:
            continue
        dob = norm_str(r.get("Date of Birth (DOB)"))
        ssn = norm_str(r.get("Social Security Number (SSN)"))
        phone = norm_str(r.get("Phone Number"))
        email = norm_str(r.get("Email"))
        line1 = norm_str(r.get("Line1"))
        city = norm_str(r.get("City"))
        zipcode = norm_str(r.get("Zip"))
        missing = [
            lbl
            for lbl, val in [
                ("DOB", dob),
                ("SSN", ssn),
                ("Phone", phone),
                ("Email", email),
                ("Line1", line1),
                ("City", city),
                ("Zip", zipcode),
            ]
            if not val
        ]
        addr = ", ".join(p for p in [line1, city, zipcode] if p) or "N/A"
        bio_by_id[rid] = {
            "dob": dob or "N/A",
            "ssn": ssn or "N/A",
            "address": addr,
            "complete": "Yes" if not missing else f"No (Missing: {', '.join(missing)})",
            "is_complete": len(missing) == 0,
        }

    # Deduplicate Points
    points_rows = dedupe_records(
        raw_points,
        lambda r: (
            norm_str(r.get("Record ID")),
            norm_str(r.get("Date")),
            norm_str(r.get("Points")),
        ),
    )
    last_wk_pts: Dict[str, int] = defaultdict(int)
    curr_wk_pts: Dict[str, int] = defaultdict(int)
    pts_meta: Dict[str, Tuple[str, str]] = {}
    for r in points_rows:
        rid = norm_str(r.get("Record ID"))
        dt = parse_date(r.get("Date"))
        try:
            pts = int(float(r.get("Points") or 0))
        except (ValueError, TypeError):
            pts = 0
        name = f"{norm_str(r.get('First'))} {norm_str(r.get('Last'))}".strip()
        ctr = norm_center(r.get("At which Turn90 Center is the client...")) or inferred_center.get(rid, "Unknown")
        if rid:
            pts_meta[rid] = (name, ctr)
        if dt and prev_mon <= dt <= prev_fri:
            last_wk_pts[rid] += pts
        if dt and curr_mon <= dt <= curr_fri:
            curr_wk_pts[rid] += pts

    # Section 1: First Shift Payment Report
    fs_enrollments = [e for e in enrollments if norm_program(e.get("Program Enrollment:") or e.get("Which Program?")) == "First Shift"]
    payment_rows = []
    for rid, pts in sorted(last_wk_pts.items(), key=lambda x: (-x[1], pts_meta.get(x[0], ("", ""))[0])):
        if pts > 0:
            name, ctr = pts_meta.get(rid, ("Unknown", "Unknown"))
            payment_rows.append(
                {
                    "record_id": rid,
                    "fullname": name,
                    "center": ctr,
                    "points": pts,
                    "payment": pts * 9,
                }
            )

    curr_wk_fs_enrollments = []
    prev_wk_fs_exits = []
    for e in fs_enrollments:
        rid = norm_str(e.get("Record ID"))
        name = f"{norm_str(e.get('First'))} {norm_str(e.get('Last'))}".strip()
        ctr = norm_center(e.get("At which Turn90 Center is the client...")) or inferred_center.get(rid, "Unknown")
        bio = bio_by_id.get(rid, {"dob": "N/A", "ssn": "N/A", "address": "N/A"})
        s_dt = parse_date(e.get("Enrollment Start Date:"))
        e_dt = parse_date(e.get("Date enrollment ended:"))
        if s_dt and curr_mon <= s_dt <= curr_fri:
            curr_wk_fs_enrollments.append(
                {
                    "record_id": rid,
                    "fullname": name,
                    "center": ctr,
                    "start_date": s_dt.isoformat(),
                    "dob": bio["dob"],
                    "ssn": bio["ssn"],
                    "address": bio["address"],
                }
            )
        if e_dt and prev_mon <= e_dt <= prev_fri:
            prev_wk_fs_exits.append(
                {
                    "record_id": rid,
                    "fullname": name,
                    "center": ctr,
                    "exit_date": e_dt.isoformat(),
                    "exit_reason": norm_str(e.get("How did the client exit Reentry Nav or...")) or "Unspecified",
                    "dob": bio["dob"],
                    "ssn": bio["ssn"],
                    "address": bio["address"],
                }
            )

    # Section 2: Funnel Report
    funnel_programs: Dict[Tuple[str, str], Dict[str, Any]] = defaultdict(
        lambda: {"enrollments": 0, "exits": 0, "active": 0, "exit_reasons": Counter()}
    )
    for e in enrollments:
        rid = norm_str(e.get("Record ID"))
        prog = norm_program(e.get("Program Enrollment:") or e.get("Which Program?")) or "Other"
        ctr = (
            norm_center(e.get("At which Turn90 Center is the client..."))
            or norm_center(e.get("At which facility are the classes taking..."))
            or inferred_center.get(rid, "Unassigned")
        )
        e_dt = parse_date(e.get("Date enrollment ended:"))
        bucket = funnel_programs[(prog, ctr)]
        bucket["enrollments"] += 1
        if e_dt:
            bucket["exits"] += 1
            reason = (
                norm_str(e.get("How did the client exit Reentry Nav or..."))
                or norm_str(e.get("How did client leave the pre-release program?"))
                or "Exited (No reason given)"
            )
            bucket["exit_reasons"][reason] += 1
        else:
            bucket["active"] += 1

    # Resource Coordination, Reentry Consultations, Orientation, Waitlist
    res_coord = dedupe_records(
        raw_res_coord,
        lambda r: (norm_str(r.get("Record ID")), norm_str(r.get("Date of resource coordination screening"))),
    )
    consults = dedupe_records(
        raw_consults,
        lambda r: (norm_str(r.get("Record ID")), norm_str(r.get("Date of Reentry Consultation"))),
    )
    orientations = dedupe_records(
        raw_orientation,
        lambda r: (norm_str(r.get("Record ID")), norm_str(r.get("Date of Orientation"))),
    )
    waitlist = dedupe_records(
        raw_waitlist,
        lambda r: (norm_str(r.get("Record ID")), norm_str(r.get("Date added to waitlist"))),
    )

    def count_timeframes(rows: List[Dict[str, Any]], date_key: str, center_fn) -> Dict[str, Dict[str, int]]:
        out: Dict[str, Dict[str, int]] = defaultdict(lambda: {"ytd": 0, "last_wk": 0, "curr_wk": 0})
        for r in rows:
            dt = parse_date(r.get(date_key))
            ctr = center_fn(r) or "Unspecified"
            if dt and dt >= ytd_start:
                out[ctr]["ytd"] += 1
                out["Total"]["ytd"] += 1
            if dt and prev_mon <= dt <= prev_fri:
                out[ctr]["last_wk"] += 1
                out["Total"]["last_wk"] += 1
            if dt and curr_mon <= dt <= curr_fri:
                out[ctr]["curr_wk"] += 1
                out["Total"]["curr_wk"] += 1
        return dict(out)

    rc_counts = count_timeframes(
        res_coord,
        "Date of resource coordination screening",
        lambda r: inferred_center.get(norm_str(r.get("Record ID")), "Unassigned"),
    )
    consult_counts = count_timeframes(
        consults,
        "Date of Reentry Consultation",
        lambda r: norm_center(r.get("Preferred enrollment location")) or inferred_center.get(norm_str(r.get("Record ID")), "Unspecified"),
    )
    consult_eligibility = Counter(norm_str(r.get("Elgible for First Shift?")) or "Unspecified" for r in consults)
    consult_ref_sources = Counter(norm_str(r.get("Referral Source")) or "Unspecified" for r in consults)

    waitlist_counts = Counter(norm_center(r.get("Which center?")) or "Unspecified" for r in waitlist)

    orient_outcomes = defaultdict(lambda: {"ytd_yes": 0, "ytd_no": 0, "last_wk_yes": 0, "last_wk_no": 0, "curr_wk_yes": 0, "curr_wk_no": 0})
    fs_day1_by_id = {norm_str(e.get("Record ID")): parse_date(e.get("Enrollment Start Date:")) for e in fs_enrollments}
    day1_enrolled = defaultdict(lambda: {"ytd": 0, "last_wk": 0, "curr_wk": 0})
    for o in orientations:
        rid = norm_str(o.get("Record ID"))
        dt = parse_date(o.get("Date of Orientation"))
        ctr = inferred_center.get(rid, "Unspecified")
        completed = norm_str(o.get("Did they successfully complete orientation?")).lower() == "yes"
        if dt and dt >= ytd_start:
            orient_outcomes[ctr]["ytd_yes" if completed else "ytd_no"] += 1
        if dt and prev_mon <= dt <= prev_fri:
            orient_outcomes[ctr]["last_wk_yes" if completed else "last_wk_no"] += 1
        if dt and curr_mon <= dt <= curr_fri:
            orient_outcomes[ctr]["curr_wk_yes" if completed else "curr_wk_no"] += 1
        if completed and rid in fs_day1_by_id and fs_day1_by_id[rid] and dt and fs_day1_by_id[rid] >= dt:
            if dt >= ytd_start:
                day1_enrolled[ctr]["ytd"] += 1
            if prev_mon <= dt <= prev_fri:
                day1_enrolled[ctr]["last_wk"] += 1
            if curr_mon <= dt <= curr_fri:
                day1_enrolled[ctr]["curr_wk"] += 1

    # Deduplicate Case Notes (newest first)
    case_notes = dedupe_records(
        raw_case_notes,
        lambda r: (
            norm_str(r.get("Record ID")),
            norm_str(r.get("Date of activity:")),
            norm_str(r.get("Staff providing service")),
            norm_str(r.get("Service Context")),
            norm_str(r.get("What happened during this interaction")),
            norm_str(r.get("Notes"))[:200],
        ),
    )
    notes_by_id: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for n in case_notes:
        rid = norm_str(n.get("Record ID"))
        dt = parse_date(n.get("Date of activity:"))
        notes_by_id[rid].append(
            {
                "date": dt,
                "date_str": dt.isoformat() if dt else norm_str(n.get("Date of activity:")),
                "staff": norm_str(n.get("Staff providing service")) or "Unknown",
                "context": norm_str(n.get("Service Context")),
                "interaction": norm_str(n.get("What happened during this interaction")),
                "notes": norm_str(n.get("Notes")),
            }
        )
    for rid in notes_by_id:
        notes_by_id[rid].sort(key=lambda x: x["date"] or date.min, reverse=True)

    # Briefcase map (keep most complete per record_id)
    briefcase_by_id: Dict[str, Dict[str, Any]] = {}
    for r in raw_briefcase:
        rid = norm_str(r.get("Record ID"))
        if not rid:
            continue
        gates = {}
        total_items = 0
        for g_num in (1, 2, 3, 4):
            items = [s.strip() for s in norm_str(r.get(f"Gate {g_num} Checklist")).split("|") if s.strip()]
            pct = min(100, round(len(items) * 100 / GATE_DENOMINATORS[g_num]))
            gates[g_num] = pct
            total_items += len(items)
        overall_pct = min(100, round(total_items * 100 / TOTAL_BRIEFCASE_ITEMS))
        if rid not in briefcase_by_id or overall_pct > briefcase_by_id[rid]["overall_pct"]:
            briefcase_by_id[rid] = {
                "exists": True,
                "gate_pcts": gates,
                "overall_pct": overall_pct,
                "goal_90": norm_str(r.get("90 Day Goal")),
            }

    # Case Plans
    fs_cp_by_id: Dict[str, Dict[str, Any]] = {}
    for r in raw_fs_cp:
        rid = norm_str(r.get("Record ID"))
        fa1 = norm_str(r.get("Focus Area 1"))
        sit1 = norm_str(r.get("Focus Area 1 Situation"))
        fa2 = norm_str(r.get("Focus Area 2"))
        sit2 = norm_str(r.get("Focus Area 2 Situations"))
        ok = bool(fa1 and sit1)
        fs_cp_by_id[rid] = {
            "exists": True,
            "ok": ok,
            "detail": f"FA1: {fa1 or 'Missing'} (Sit: {'Yes' if sit1 else 'No'}); FA2: {fa2 or 'None'} (Sit: {'Yes' if sit2 else 'No'})",
        }

    rn_cp_by_id: Dict[str, Dict[str, Any]] = {}
    for r in raw_rn_cp:
        rid = norm_str(r.get("Record ID"))
        cm = norm_str(r.get("Case Manager")) or "Daisy Boynton"
        plan_txt = norm_str(r.get("Case Plan"))
        rn_cp_by_id[rid] = {
            "exists": bool(plan_txt),
            "case_manager": cm,
            "detail": plan_txt[:120] if plan_txt else "Missing",
        }

    # LSCMI & Drug Test
    lscmi_by_id = {}
    for r in raw_lscmi:
        rid = norm_str(r.get("Record ID"))
        score = norm_str(r.get("Total LS/CMI Score (from Section 1)"))
        if rid and score:
            lscmi_by_id[rid] = score
    drug_test_ids = {norm_str(r.get("Record ID")) for r in raw_drug_test if norm_str(r.get("Record ID"))}

    # Section 3: Active Program Dashboards
    active_first_shift = []
    active_reentry_nav = []
    seen_active = set()

    # Load feedback cache
    feedback_cache: Dict[str, str] = {}
    if FEEDBACK_CACHE_PATH.exists():
        try:
            feedback_cache = json.loads(FEEDBACK_CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            feedback_cache = {}

    for e in enrollments:
        if parse_date(e.get("Date enrollment ended:")) is not None:
            continue
        rid = norm_str(e.get("Record ID"))
        prog = norm_program(e.get("Program Enrollment:") or e.get("Which Program?"))
        if prog not in ("First Shift", "Reentry Navigation"):
            continue
        if (rid, prog) in seen_active:
            continue
        seen_active.add((rid, prog))

        name = f"{norm_str(e.get('First'))} {norm_str(e.get('Last'))}".strip()
        ctr = norm_center(e.get("At which Turn90 Center is the client...")) or inferred_center.get(rid, "Charleston")
        start_dt = parse_date(e.get("Enrollment Start Date:"))
        bc = briefcase_by_id.get(rid, {"exists": False, "gate_pcts": {1: 0, 2: 0, 3: 0, 4: 0}, "overall_pct": 0})
        p_notes = notes_by_id.get(rid, [])
        last_note = p_notes[0] if p_notes else None

        if prog == "First Shift":
            cm = CENTER_CM_MAP.get(ctr, "TB")
            cp = fs_cp_by_id.get(rid, {"exists": False, "ok": False, "detail": "Missing"})
            weeks = compute_weeks_enrolled(start_dt, report_date)
            pts_wk = curr_wk_pts.get(rid, 0)
            has_cm_week = any(
                n["date"] and curr_mon <= n["date"] <= curr_fri
                and (
                    "case management" in n["context"].lower()
                    or "briefcase" in n["notes"].lower()
                    or "case plan" in n["notes"].lower()
                    or "1-on-1" in n["context"].lower()
                )
                for n in p_notes
            )
            # Apricot's 'Drug Test - Rows' section is an exception list of active
            # First Shift participants MISSING a drug test this week.
            has_drug_test = rid not in drug_test_ids
            bio = bio_by_id.get(rid, {"complete": "No (Not on file)", "is_complete": False})
            rec = {
                "record_id": rid,
                "fullname": name,
                "program": "First Shift",
                "center": ctr,
                "case_manager": cm,
                "weeks_enrolled": weeks,
                "points_this_week": pts_wk,
                "case_plan_ok": cp["ok"],
                "case_plan_exists": cp["exists"],
                "case_plan_detail": cp["detail"],
                "briefcase_exists": bc["exists"],
                "gate_pcts": bc["gate_pcts"],
                "overall_briefcase_pct": bc["overall_pct"],
                "drug_test_week": has_drug_test,
                "cm_session_week": has_cm_week,
                "lscmi_score": lscmi_by_id.get(rid, "N/A"),
                "bio_complete": bio["complete"],
                "bio_is_complete": bio["is_complete"],
                "last_contact": last_note["date_str"] if last_note else "None",
            }
            rec["feedback"] = generate_ai_case_feedback(rec, p_notes, feedback_cache, use_ai=use_ai)
            active_first_shift.append(rec)
        else:
            rn_cp = rn_cp_by_id.get(rid, {"exists": False, "case_manager": "Daisy Boynton", "detail": "Missing"})
            cm = rn_cp["case_manager"]
            rec = {
                "record_id": rid,
                "fullname": name,
                "program": "Reentry Navigation",
                "center": ctr,
                "case_manager": cm,
                "case_plan_ok": rn_cp["exists"],
                "case_plan_exists": rn_cp["exists"],
                "case_plan_detail": rn_cp["detail"],
                "briefcase_exists": bc["exists"],
                "gate_pcts": bc["gate_pcts"],
                "overall_briefcase_pct": bc["overall_pct"],
                "last_contact": last_note["date_str"] if last_note else "None",
                "last_contact_date": last_note["date"] if last_note else None,
            }
            rec["feedback"] = generate_ai_case_feedback(rec, p_notes, feedback_cache, use_ai=use_ai)
            active_reentry_nav.append(rec)

    FEEDBACK_CACHE_PATH.write_text(json.dumps(feedback_cache, indent=2), encoding="utf-8")

    # Section 4: SkillCat
    skillcat_rows = []
    if SKILLCAT_HISTORY_PATH.exists():
        sc_data = json.loads(SKILLCAT_HISTORY_PATH.read_text(encoding="utf-8"))
        snaps = sc_data.get("snapshots", {})
        if snaps:
            latest_sc_date = sorted(snaps.keys())[-1]
            sc_snap = snaps[latest_sc_date]
            win5 = get_last_n_working_days(date.fromisoformat(latest_sc_date), n=5)
            base5_key = (win5[0] - timedelta(days=1)).isoformat()
            base5_snap = snaps.get(base5_key, {})
            for uid, info in sorted(sc_snap.items(), key=lambda kv: kv[1].get("fullname", "")):
                tot = int(info.get("total_courses", 0))
                last5 = info.get("completed_last_5_working_days")
                if last5 is None:
                    last5 = max(0, tot - int(base5_snap.get(uid, {}).get("total_courses", tot))) if uid in base5_snap else 0
                skillcat_rows.append(
                    {
                        "fullname": info.get("fullname", ""),
                        "total_modules": tot,
                        "last_5_working_days": int(last5),
                        "latest_completion": info.get("latest_completion_date") or "None",
                        "flagged_2_working_days": bool(info.get("flagged_2_working_days", False)),
                    }
                )

    # Section 6: Employment Historical 30/60/90/180-Day Retention
    emp_hist = dedupe_records(
        raw_emp_hist,
        lambda r: (norm_str(r.get("Record ID")), norm_str(r.get("Company Name")), norm_str(r.get("Employment Start Date"))),
    )
    retention = {}
    for horizon in (30, 60, 90, 180):
        qualified = 0
        retained = 0
        for r in emp_hist:
            s_dt = parse_date(r.get("Employment Start Date"))
            if not s_dt or s_dt > report_date:
                continue
            e_dt = parse_date(r.get("When was the client's last known date of..."))
            if e_dt:
                days_worked = (e_dt - s_dt).days
                # If ended before horizon, counts as failure for this horizon
                qualified += 1
                if days_worked >= horizon:
                    retained += 1
            else:
                days_active = (report_date - s_dt).days
                # Only count active employments that have existed long enough to qualify
                if days_active >= horizon:
                    qualified += 1
                    retained += 1
        pct = round((retained * 100 / qualified), 1) if qualified else 0.0
        retention[horizon] = {"retained": retained, "qualified": qualified, "rate": pct}

    # Section 7: Referrals & Credentials for active First Shift & Reentry Nav
    active_map = {r["record_id"]: r for r in (active_first_shift + active_reentry_nav)}
    referrals = dedupe_records(
        raw_referrals,
        lambda r: (
            norm_str(r.get("Record ID")),
            norm_str(r.get("Date referral was made:")),
            norm_str(r.get("Staff making the referral:")),
            norm_str(r.get("Primary Need (Reason for Referral):")),
            norm_str(r.get("Name of Organization:")),
        ),
    )
    ref_by_center_cm: Dict[Tuple[str, str], int] = Counter()
    for r in referrals:
        rid = norm_str(r.get("Record ID"))
        if rid in active_map:
            p = active_map[rid]
            staff = norm_str(r.get("Staff making the referral:")) or p["case_manager"]
            ref_by_center_cm[(p["center"], staff)] += 1

    credentials = dedupe_records(
        raw_credentials,
        lambda r: (norm_str(r.get("Record ID")), norm_str(r.get("Credential Earned")), norm_str(r.get("Date Completed"))),
    )
    cred_by_center_cm: Dict[Tuple[str, str, str], int] = Counter()
    for r in credentials:
        rid = norm_str(r.get("Record ID"))
        if rid in active_map:
            p = active_map[rid]
            cred = norm_str(r.get("Credential Earned")) or "Unknown"
            cred_by_center_cm[(p["center"], p["case_manager"], cred)] += 1

    # Section 8: Flags
    elapsed_weekdays = min(5, max(1, report_date.weekday() + 1)) if report_date.weekday() < 5 else 5
    expected_pts = elapsed_weekdays * 10
    min_25pct_pts = expected_pts * 0.25  # missing >75% means <25% of expected points

    flags = {
        "missing_75pct_points": [
            r for r in active_first_shift if r["points_this_week"] < min_25pct_pts
        ],
        "missing_cm_session": [r for r in active_first_shift if not r["cm_session_week"]],
        "missing_drug_test": [r for r in active_first_shift if not r["drug_test_week"]],
        "missing_case_plan": [
            r for r in (active_first_shift + active_reentry_nav) if not r["case_plan_ok"]
        ],
        "missing_briefcase": [
            r for r in (active_first_shift + active_reentry_nav) if not r["briefcase_exists"]
        ],
        "behind_briefcase_25pct_wk": [
            r
            for r in active_first_shift
            if r["overall_briefcase_pct"] < min(100, r["weeks_enrolled"] * 25)
        ],
        "reentry_no_contact_7d": [
            r
            for r in active_reentry_nav
            if r["last_contact_date"] is None or (report_date - r["last_contact_date"]).days > 7
        ],
        "employment_no_checkin_30d": [],
    }

    emp_dedup = dedupe_records(
        raw_employment,
        lambda r: (norm_str(r.get("Record ID")), norm_str(r.get("Company Name")), norm_str(r.get("Employment Start Date"))),
    )
    for r in emp_dedup:
        if parse_date(r.get("When was the client's last known date of...")) is not None:
            continue
        checkin_dt = parse_date(r.get("Date employment check-in was completed by..."))
        if checkin_dt is None or (report_date - checkin_dt).days > 30:
            rid = norm_str(r.get("Record ID"))
            flags["employment_no_checkin_30d"].append(
                {
                    "record_id": rid,
                    "fullname": f"{norm_str(r.get('First'))} {norm_str(r.get('Last'))}".strip(),
                    "center": inferred_center.get(rid, "Unknown"),
                    "company": norm_str(r.get("Company Name")),
                    "last_checkin": checkin_dt.isoformat() if checkin_dt else "Never",
                }
            )

    return {
        "report_date": report_date.isoformat(),
        "source_xlsx": xlsx_path.name,
        "curr_week": f"{curr_mon.isoformat()} to {curr_fri.isoformat()}",
        "prev_week": f"{prev_mon.isoformat()} to {prev_fri.isoformat()}",
        "expected_pts": expected_pts,
        "payment_rows": payment_rows,
        "curr_wk_fs_enrollments": curr_wk_fs_enrollments,
        "prev_wk_fs_exits": prev_wk_fs_exits,
        "funnel_programs": dict(funnel_programs),
        "rc_counts": rc_counts,
        "consult_counts": consult_counts,
        "consult_eligibility": dict(consult_eligibility),
        "consult_ref_sources": dict(consult_ref_sources),
        "waitlist_counts": dict(waitlist_counts),
        "orient_outcomes": dict(orient_outcomes),
        "day1_enrolled": dict(day1_enrolled),
        "active_first_shift": active_first_shift,
        "active_reentry_nav": active_reentry_nav,
        "skillcat_rows": skillcat_rows,
        "retention": retention,
        "ref_by_center_cm": dict(ref_by_center_cm),
        "cred_by_center_cm": dict(cred_by_center_cm),
        "flags": flags,
    }


def filter_by_location(data: Dict[str, Any], location: Optional[str]) -> Dict[str, Any]:
    """Filter report data for a specific location (or return full data if location is None)."""
    if not location:
        return data
    d = dict(data)
    d["payment_rows"] = [r for r in data["payment_rows"] if r["center"] == location]
    d["curr_wk_fs_enrollments"] = [r for r in data["curr_wk_fs_enrollments"] if r["center"] == location]
    d["prev_wk_fs_exits"] = [r for r in data["prev_wk_fs_exits"] if r["center"] == location]
    d["active_first_shift"] = [r for r in data["active_first_shift"] if r["center"] == location]
    d["active_reentry_nav"] = [r for r in data["active_reentry_nav"] if r["center"] == location]
    d["ref_by_center_cm"] = {k: v for k, v in data["ref_by_center_cm"].items() if k[0] == location}
    d["cred_by_center_cm"] = {k: v for k, v in data["cred_by_center_cm"].items() if k[0] == location}
    d["flags"] = {
        k: [item for item in v if item.get("center") == location]
        for k, v in data["flags"].items()
    }
    return d


def render_markdown(data: Dict[str, Any], location: Optional[str]) -> str:
    """Render the full report as clean Markdown."""
    scope = location or "Universal (All Centers)"
    lines = [
        f"# Turn90 Combined Supervision & Operational Report — {scope}",
        f"**Report Date:** {data['report_date']} | **Source:** `{data['source_xlsx']}`",
        f"**Last Week (Payroll):** {data['prev_week']} | **Current Week:** {data['curr_week']}",
        "",
        "---",
        "## 1. First Shift Payment Report",
        "| Record ID | Full Name | Center | Points | Payment ($9/pt) |",
        "|---|---|---|---:|---:|",
    ]
    total_pts = sum(r["points"] for r in data["payment_rows"])
    total_pay = sum(r["payment"] for r in data["payment_rows"])
    for r in data["payment_rows"]:
        lines.append(f"| {r['record_id']} | {r['fullname']} | {r['center']} | {r['points']} | ${r['payment']:,} |")
    lines.append(f"| **TOTAL** | **{len(data['payment_rows'])} Participants** | | **{total_pts}** | **${total_pay:,}** |")

    lines.extend(["", "### Current Week Enrollments", "| Record ID | Full Name | Center | DOB | SSN | Address |", "|---|---|---|---|---|---|"])
    for r in data["curr_wk_fs_enrollments"]:
        lines.append(f"| {r['record_id']} | {r['fullname']} | {r['center']} | {r['dob']} | {r['ssn']} | {r['address']} |")
    if not data["curr_wk_fs_enrollments"]:
        lines.append("| — | None | — | — | — | — |")

    lines.extend(["", "### Previous Week Exits", "| Record ID | Full Name | Center | Exit Date | Exit Reason | DOB | SSN | Address |", "|---|---|---|---|---|---|---|---|"])
    for r in data["prev_wk_fs_exits"]:
        lines.append(f"| {r['record_id']} | {r['fullname']} | {r['center']} | {r['exit_date']} | {r['exit_reason']} | {r['dob']} | {r['ssn']} | {r['address']} |")
    if not data["prev_wk_fs_exits"]:
        lines.append("| — | None | — | — | — | — | — | — |")

    lines.extend(["", "---", "## 2. Funnel Report", "| Program | Center | Enrollments | Exits | Active | Top Exit Reasons |", "|---|---|---:|---:|---:|---|"])
    for (prog, ctr), info in sorted(data["funnel_programs"].items()):
        if location and ctr != location:
            continue
        reasons = ", ".join(f"{k}: {v}" for k, v in info["exit_reasons"].most_common(3)) or "None"
        lines.append(f"| {prog} | {ctr} | {info['enrollments']} | {info['exits']} | {info['active']} | {reasons} |")

    lines.extend(["", "### Phase Metrics (YTD / Last Week / Current Week)", "| Metric | Center | YTD | Last Week | Current Week |", "|---|---|---:|---:|---:|"])
    for ctr, c in sorted(data["rc_counts"].items()):
        if location and ctr not in (location, "Total"):
            continue
        lines.append(f"| Resource Coordinations | {ctr} | {c['ytd']} | {c['last_wk']} | {c['curr_wk']} |")
    for ctr, c in sorted(data["consult_counts"].items()):
        if location and ctr not in (location, "Total"):
            continue
        lines.append(f"| Reentry Consultations | {ctr} | {c['ytd']} | {c['last_wk']} | {c['curr_wk']} |")
    for ctr, c in sorted(data["day1_enrolled"].items()):
        if location and ctr != location:
            continue
        lines.append(f"| Orientation -> Day 1 FS Enrolled | {ctr} | {c['ytd']} | {c['last_wk']} | {c['curr_wk']} |")

    lines.append(f"\n**Consultation Eligibility:** {dict(data['consult_eligibility'])}")
    lines.append(f"**Referral Sources:** {dict(data['consult_ref_sources'])}")
    lines.append(f"**Active Waitlist by Center:** {dict(data['waitlist_counts'])}")
    lines.append(f"**Orientation Outcomes (Yes/No):** {dict(data['orient_outcomes'])}")

    lines.extend(["", "---", "## 3. Active Program Dashboards", "### First Shift Active Dashboard",
                  "| Record ID | Name | Center | Wks | Pts (Wk) | Case Plan | Briefcase G1/G2/G3/G4 | Drug Test | CM Session | LS/CMI | Bio Info |",
                  "|---|---|---|---:|---:|---|---|---|---|---|---|"])
    for r in data["active_first_shift"]:
        g = r["gate_pcts"]
        lines.append(
            f"| {r['record_id']} | {r['fullname']} | {r['center']} | {r['weeks_enrolled']} | {r['points_this_week']} | "
            f"{'Yes' if r['case_plan_ok'] else 'No'} | {g[1]}/{g[2]}/{g[3]}/{g[4]}% | "
            f"{'Yes' if r['drug_test_week'] else 'No'} | {'Yes' if r['cm_session_week'] else 'No'} | {r['lscmi_score']} | {r['bio_complete']} |"
        )

    lines.extend(["", "### Reentry Navigation Active Dashboard", "| Record ID | Name | Case Manager | Case Plan | Briefcase G1/G2/G3/G4 | Last Contact |", "|---|---|---|---|---|---|"])
    for r in data["active_reentry_nav"]:
        g = r["gate_pcts"]
        lines.append(
            f"| {r['record_id']} | {r['fullname']} | {r['case_manager']} | {'Yes' if r['case_plan_ok'] else 'No'} | "
            f"{g[1]}/{g[2]}/{g[3]}/{g[4]}% | {r['last_contact']} |"
        )

    lines.extend(["", "---", "## 4. SkillCat Modules Progress", "| Participant | Total Modules | Completed (Last 5 Working Days) | Latest Completion |", "|---|---:|---:|---|"])
    for r in data["skillcat_rows"]:
        lines.append(f"| {r['fullname']} | {r['total_modules']} | {r['last_5_working_days']} | {r['latest_completion']} |")

    lines.extend(["", "---", "## 5. Case Plan & Briefcase Feedback (Batched by Case Manager)"])
    by_cm: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in data["active_first_shift"] + data["active_reentry_nav"]:
        by_cm[r["case_manager"]].append(r)
    for cm, plist in sorted(by_cm.items()):
        lines.append(f"\n### Case Manager: {cm}")
        for p in plist:
            lines.append(f"- **{p['fullname']} (#{p['record_id']}, {p['program']} — {p['center']}):** {p['feedback']}")

    lines.extend(["", "---", "## 6. Employment Retention (30 / 60 / 90 / 180 Days)", "| Horizon | Retained | Qualified | Retention Rate |", "|---|---:|---:|---:|"])
    for h in (30, 60, 90, 180):
        rt = data["retention"][h]
        lines.append(f"| {h} Days | {rt['retained']} | {rt['qualified']} | {rt['rate']}% |")

    lines.extend(["", "---", "## 7. Referrals & Credentials", "### Referrals Made by Center & Staff", "| Center | Staff | Count |", "|---|---|---:|"])
    for (ctr, staff), cnt in sorted(data["ref_by_center_cm"].items()):
        lines.append(f"| {ctr} | {staff} | {cnt} |")
    lines.extend(["", "### Credentials Earned by Center & Case Manager", "| Center | Case Manager | Credential | Count |", "|---|---|---|---:|"])
    for (ctr, cm, cred), cnt in sorted(data["cred_by_center_cm"].items()):
        lines.append(f"| {ctr} | {cm} | {cred} | {cnt} |")

    lines.extend(["", "---", "## 8. Operational Flags"])
    flag_labels = [
        ("missing_75pct_points", f"First Shift Missing >75% of Expected Points This Week (Expected: {data['expected_pts']})"),
        ("missing_cm_session", "Active First Shift Missing CM Session This Week"),
        ("missing_drug_test", "Active First Shift Missing Drug Test This Week"),
        ("missing_case_plan", "Missing Case Plan (First Shift & Reentry Nav)"),
        ("missing_briefcase", "Missing Briefcase (First Shift & Reentry Nav)"),
        ("behind_briefcase_25pct_wk", "First Shift Behind 25% Briefcase / Week"),
        ("reentry_no_contact_7d", "Active Reentry Nav No Contact in Last 7 Days"),
        ("employment_no_checkin_30d", "Employed Participants Without Job Check-In in Last 30 Days"),
    ]
    for key, label in flag_labels:
        items = data["flags"][key]
        lines.append(f"\n### {label} ({len(items)})")
        for item in items:
            extra = f" — {item.get('company', '')} (Last check-in: {item.get('last_checkin', '')})" if key == "employment_no_checkin_30d" else ""
            lines.append(f"- {item['fullname']} ({item.get('center', 'Unknown')}){extra}")
        if not items:
            lines.append("- None")

    return "\n".join(lines) + "\n"


def render_pdf(data: Dict[str, Any], location: Optional[str], output_path: Path) -> None:
    """Render a clean landscape PDF report using ReportLab."""
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=landscape(letter),
        leftMargin=0.4 * inch,
        rightMargin=0.4 * inch,
        topMargin=0.4 * inch,
        bottomMargin=0.4 * inch,
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=15, textColor=colors.HexColor("#1E293B"), spaceAfter=4)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=11.5, textColor=colors.HexColor("#0F172A"), spaceBefore=10, spaceAfter=4)
    h3 = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=9.5, textColor=colors.HexColor("#334155"), spaceBefore=6, spaceAfter=3)
    cell = ParagraphStyle("Cell", parent=styles["Normal"], fontSize=7.5, leading=9.5, textColor=colors.HexColor("#0F172A"))
    cell_b = ParagraphStyle("CellB", parent=cell, fontName="Helvetica-Bold")
    sub = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=8.5, textColor=colors.HexColor("#475569"), spaceAfter=8)

    def mk_table(headers: List[str], rows: List[List[Any]], col_widths: List[float]) -> Table:
        tbl_data = [[Paragraph(f"<font color='white'><b>{h}</b></font>", cell) for h in headers]]
        for r in rows:
            tbl_data.append([Paragraph(str(v), cell) for v in r])
        if len(tbl_data) == 1:
            tbl_data.append([Paragraph("None", cell)] + [Paragraph("", cell) for _ in headers[1:]])
        t = Table(tbl_data, colWidths=[w * inch for w in col_widths], repeatRows=1)
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        return t

    scope = location or "Universal (All Centers)"
    elems: List[Any] = [
        Paragraph(f"Turn90 Combined Supervision & Operational Report — {scope}", h1),
        Paragraph(
            f"<b>Report Date:</b> {data['report_date']} &nbsp;|&nbsp; "
            f"<b>Payroll Week:</b> {data['prev_week']} &nbsp;|&nbsp; "
            f"<b>Current Week:</b> {data['curr_week']} &nbsp;|&nbsp; "
            f"<b>Source:</b> {data['source_xlsx']}",
            sub,
        ),
    ]

    # 1. Payment Report
    elems.append(Paragraph("1. First Shift Payment Report (Last Week Mon–Fri @ $9/pt)", h2))
    pay_rows = [[r["record_id"], r["fullname"], r["center"], r["points"], f"${r['payment']:,}"] for r in data["payment_rows"]]
    total_pts = sum(r["points"] for r in data["payment_rows"])
    total_pay = sum(r["payment"] for r in data["payment_rows"])
    pay_rows.append(["TOTAL", f"{len(data['payment_rows'])} Participants", "", total_pts, f"${total_pay:,}"])
    elems.append(mk_table(["Record ID", "Full Name", "Center", "Points", "Payment ($9/pt)"], pay_rows, [1.1, 2.6, 1.5, 1.0, 1.4]))

    elems.append(Paragraph("Current Week First Shift Enrollments", h3))
    elems.append(
        mk_table(
            ["Record ID", "Full Name", "Center", "DOB", "SSN", "Address"],
            [[r["record_id"], r["fullname"], r["center"], r["dob"], r["ssn"], r["address"]] for r in data["curr_wk_fs_enrollments"]],
            [0.9, 1.8, 1.1, 1.0, 1.1, 4.1],
        )
    )
    elems.append(Paragraph("Previous Week First Shift Exits", h3))
    elems.append(
        mk_table(
            ["Record ID", "Full Name", "Center", "Exit Date", "Exit Reason", "Address"],
            [[r["record_id"], r["fullname"], r["center"], r["exit_date"], r["exit_reason"], r["address"]] for r in data["prev_wk_fs_exits"]],
            [0.9, 1.7, 1.0, 1.0, 2.4, 3.0],
        )
    )

    # 2. Funnel Report
    elems.append(Paragraph("2. Funnel Report", h2))
    f_rows = []
    for (prog, ctr), info in sorted(data["funnel_programs"].items()):
        if location and ctr != location:
            continue
        reasons = "; ".join(f"{k} ({v})" for k, v in info["exit_reasons"].most_common(3)) or "None"
        f_rows.append([prog, ctr, info["enrollments"], info["exits"], info["active"], reasons])
    elems.append(mk_table(["Program", "Center", "Enrollments", "Exits", "Active", "Top Exit Reasons"], f_rows, [1.6, 1.4, 0.9, 0.8, 0.8, 4.5]))

    phase_rows = []
    for ctr, c in sorted(data["rc_counts"].items()):
        if not location or ctr in (location, "Total"):
            phase_rows.append(["Resource Coordinations", ctr, c["ytd"], c["last_wk"], c["curr_wk"]])
    for ctr, c in sorted(data["consult_counts"].items()):
        if not location or ctr in (location, "Total"):
            phase_rows.append(["Reentry Consultations", ctr, c["ytd"], c["last_wk"], c["curr_wk"]])
    for ctr, c in sorted(data["day1_enrolled"].items()):
        if not location or ctr == location:
            phase_rows.append(["Completed Orient. -> Day 1 FS", ctr, c["ytd"], c["last_wk"], c["curr_wk"]])
    elems.append(Spacer(1, 4))
    elems.append(mk_table(["Phase Metric", "Center", "YTD", "Last Week", "Current Week"], phase_rows, [2.8, 1.8, 1.1, 1.2, 1.2]))

    # 3. Active Dashboards
    elems.append(PageBreak())
    elems.append(Paragraph("3. Active Program Dashboards", h2))
    elems.append(Paragraph("First Shift Active Dashboard", h3))
    fs_rows = [
        [
            r["record_id"],
            r["fullname"],
            r["center"],
            r["weeks_enrolled"],
            r["points_this_week"],
            "Yes" if r["case_plan_ok"] else "No",
            f"{r['gate_pcts'][1]}/{r['gate_pcts'][2]}/{r['gate_pcts'][3]}/{r['gate_pcts'][4]}%",
            "Yes" if r["drug_test_week"] else "No",
            "Yes" if r["cm_session_week"] else "No",
            r["lscmi_score"],
            r["bio_complete"],
        ]
        for r in data["active_first_shift"]
    ]
    elems.append(
        mk_table(
            ["ID", "Name", "Center", "Wks", "Pts", "Case Plan", "Gates 1-4", "Drug Test", "CM Sess", "LS/CMI", "Bio Info"],
            fs_rows,
            [0.6, 1.3, 0.9, 0.4, 0.4, 0.7, 1.1, 0.7, 0.7, 0.6, 2.6],
        )
    )

    elems.append(Paragraph("Reentry Navigation Active Dashboard", h3))
    rn_rows = [
        [
            r["record_id"],
            r["fullname"],
            r["case_manager"],
            "Yes" if r["case_plan_ok"] else "No",
            f"{r['gate_pcts'][1]}/{r['gate_pcts'][2]}/{r['gate_pcts'][3]}/{r['gate_pcts'][4]}%",
            r["last_contact"],
        ]
        for r in data["active_reentry_nav"]
    ]
    elems.append(mk_table(["ID", "Name", "Case Manager", "Case Plan", "Gates 1-4", "Last Contact"], rn_rows, [0.9, 2.2, 1.8, 1.0, 1.5, 1.4]))

    # 4. SkillCat
    elems.append(Paragraph("4. SkillCat Progress (Total & Last 5 Working Days)", h2))
    sc_rows = [[r["fullname"], r["total_modules"], r["last_5_working_days"], r["latest_completion"]] for r in data["skillcat_rows"]]
    elems.append(mk_table(["Participant", "Total Modules", "Last 5 Working Days", "Latest Completion"], sc_rows, [3.0, 1.5, 1.8, 1.8]))

    # 5. Case Plan Feedback
    elems.append(PageBreak())
    elems.append(Paragraph("5. Case Plan & Briefcase Feedback (Batched by Case Manager)", h2))
    by_cm: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in data["active_first_shift"] + data["active_reentry_nav"]:
        by_cm[r["case_manager"]].append(r)
    for cm, plist in sorted(by_cm.items()):
        elems.append(Paragraph(f"Case Manager: {cm}", h3))
        fb_rows = [[p["fullname"], p["program"], p["center"], p["feedback"]] for p in plist]
        elems.append(mk_table(["Participant", "Program", "Center", "Case Plan & Briefcase Feedback"], fb_rows, [1.5, 1.2, 1.0, 6.3]))

    # 6. Employment & 7. Referrals/Credentials
    elems.append(Paragraph("6. Employment Retention (30 / 60 / 90 / 180 Days)", h2))
    ret_rows = [[f"{h} Days", data["retention"][h]["retained"], data["retention"][h]["qualified"], f"{data['retention'][h]['rate']}%"] for h in (30, 60, 90, 180)]
    elems.append(mk_table(["Horizon", "Retained", "Qualified", "Retention Rate"], ret_rows, [2.0, 1.5, 1.5, 1.5]))

    elems.append(Paragraph("7. Referrals & Credentials (Active Cohort)", h2))
    ref_rows = [[ctr, staff, cnt] for (ctr, staff), cnt in sorted(data["ref_by_center_cm"].items())]
    elems.append(mk_table(["Center", "Staff Making Referral", "Referrals"], ref_rows, [2.0, 3.0, 1.5]))
    elems.append(Spacer(1, 4))
    cred_rows = [[ctr, cm, cred, cnt] for (ctr, cm, cred), cnt in sorted(data["cred_by_center_cm"].items())]
    elems.append(mk_table(["Center", "Case Manager", "Credential Earned", "Count"], cred_rows, [1.8, 2.0, 3.5, 1.0]))

    # 8. Flags
    elems.append(Paragraph("8. Operational Flags", h2))
    flag_defs = [
        ("missing_75pct_points", f"First Shift Missing >75% Points This Week (Expected: {data['expected_pts']})"),
        ("missing_cm_session", "Active First Shift Missing CM Session This Week"),
        ("missing_drug_test", "Active First Shift Missing Drug Test This Week"),
        ("missing_case_plan", "Missing Case Plan (First Shift & Reentry Nav)"),
        ("missing_briefcase", "Missing Briefcase (First Shift & Reentry Nav)"),
        ("behind_briefcase_25pct_wk", "First Shift Behind 25% Briefcase/Week"),
        ("reentry_no_contact_7d", "Active Reentry Nav No Contact in Last 7 Days"),
        ("employment_no_checkin_30d", "Employed Without Job Check-In in Last 30 Days"),
    ]
    flag_tbl_rows = []
    for key, label in flag_defs:
        items = data["flags"][key]
        names = ", ".join(f"{it['fullname']} ({it.get('center', '?')})" for it in items) or "None"
        flag_tbl_rows.append([label, len(items), names])
    elems.append(mk_table(["Flag Rule", "Count", "Participants Flagged"], flag_tbl_rows, [3.2, 0.7, 6.1]))

    doc.build(elems)


def generate_all_reports(xlsx_path: Path, report_date: date, use_ai: bool = True) -> List[Path]:
    """Build universal and per-location reports (PDF + Markdown)."""
    load_env_files()
    data = build_report_data(xlsx_path, report_date, use_ai=use_ai)

    out_dir = REPORTS_DIR / report_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    generated: List[Path] = []

    scopes: List[Optional[str]] = [None] + CENTERS
    for loc in scopes:
        filtered = filter_by_location(data, loc)
        tag = loc if loc else "Universal"
        md_path = out_dir / f"Turn90_Combined_Report_{tag}_{report_date.isoformat()}.md"
        pdf_path = out_dir / f"Turn90_Combined_Report_{tag}_{report_date.isoformat()}.pdf"
        md_path.write_text(render_markdown(filtered, loc), encoding="utf-8")
        render_pdf(filtered, loc, pdf_path)
        generated.extend([md_path, pdf_path])
        if loc is None:
            latest_pdf = BASE_DIR / "Turn90_Combined_Report_Latest.pdf"
            shutil.copyfile(pdf_path, latest_pdf)
            generated.append(latest_pdf)

    return generated


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Turn90 Combined Apricot + SkillCat Reports.")
    parser.add_argument("--xlsx", type=str, default=None, help="Path to Apricot XLSX export.")
    parser.add_argument("--date", type=str, default=None, help="Report date YYYY-MM-DD (default: today).")
    parser.add_argument("--no-ai", action="store_true", help="Disable Gemini AI case note feedback.")
    args = parser.parse_args()

    report_date = date.fromisoformat(args.date) if args.date else date.today()
    xlsx_path = find_latest_xlsx(args.xlsx)
    print(f"Generating combined reports for {report_date} using {xlsx_path}...", flush=True)
    files = generate_all_reports(xlsx_path, report_date, use_ai=not args.no_ai)
    for f in files:
        print(f"  Created: {f}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
