# Implementation Plan: AI Caseload Dashboard & Staff Audit

## Overview
This plan upgrades the staff oversight tools by introducing an AI-powered Caseload Dashboard. This dashboard integrates participant gates, case notes, daily points, and weekly stability checks (drug screens) to generate actionable "Suggested Next Steps" for each participant. Additionally, it provides an automated staff audit that evaluates the quality of interventions case managers are applying based on their recent case notes.

## Proposed Changes

### 1. Backend AI Integration (`server.js`)
- Create a new endpoint: `GET /api/staff/ai-caseload-report`.
- This endpoint will gather data across all active participants:
  - Incomplete/Blocked `gate_criteria`
  - Recent `case_notes`
  - Recent `daily_points`
  - Recent `weekly_stability_checks` (drug screens/case mgmt)
- The endpoint will send this bundled data to the Gemini Pro model to output structured JSON containing:
  - `participant_insights`: Array of objects with `suggested_next_steps` (2-3 concise action items synthesizing the data).
  - `staff_audit`: A summary paragraph analyzing the quality of the staff's interventions (e.g., use of CBT/Motivational Interviewing, responsiveness to barriers).

### 2. Frontend UI/HTML Updates (`public/index.html`)
- Add a new "AI Dashboard" tab to the Staff Portal navigation (replacing the broken Gate Report tab from the previous iteration).
- Add the corresponding container `<div id="pm-ai-dashboard-content">` to house the new report.

### 3. Frontend Logic (`public/app.js`)
- Update `switchCaseloadTab` to support the new `ai-dashboard` tab.
- Implement `loadAiCaseloadReport()` which will:
  1. Fetch from `/api/staff/ai-caseload-report`.
  2. Display the **Staff Intervention Quality Analysis** prominently at the top.
  3. Render **Participant Action Plans** below, displaying their weekly points, drug screens, pending gates, and the AI-generated "Suggested Next Steps".

## Verification Plan
1. Log in as a staff member.
2. Click the new "AI Dashboard" tab.
3. Verify that the AI successfully generates the staff quality audit and participant-specific next steps based on recent data.
