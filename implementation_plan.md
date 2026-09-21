# Implementation Plan: Enhancing Gates & Removing Master Briefcase

## Overview
This plan transitions the participant experience from using the "Master Briefcase" to fully utilizing interactive 4-Week Gates. Participants will be able to update gate statuses, write notes, and fill out interactive worksheets (e.g., for Substance Recovery), while staff gain a dedicated report to track blocked or incomplete gate items across their caseload.

## User Review Required
> [!IMPORTANT]
> - This plan completely removes the **Participant-facing Master Briefcase** tabs. Staff will still have access to the 6-domain briefcase on the backend for their own tracking if needed, but participants will *only* interact with the Gates. Is this correct?
> - For the **Interactive Worksheets**, I have proposed a structured template for the "Substance Recovery" gate. Are there any other specific gates you'd like worksheets for right now (e.g., Budget, Transportation Plan)?

## Proposed Changes

### 1. Database Updates (`db.js`)
- Add a new column `participant_notes TEXT` to the `gate_criteria` table to separate participant responses from staff (`pm_notes`).
- Update the allowed `status` enums for gates to include `not_applicable`.

### 2. Backend API Updates (`server.js`)
- Create `POST /api/participant/gate-item` to allow participants to update a gate's status and participant notes.
- Create `GET /api/staff/gate-report` to aggregate all blocked (`red`) and incomplete (`pending`) gates across all active participants for the Staff Dashboard.

### 3. Participant Portal Enhancements (`public/index.html` & `public/app.js`)
- **Remove Briefcase:** Delete the "Master Briefcase" tabs and sub-views from both the First Shift and Re-entry Navigation participant portals.
- **Interactive Gates:** Overhaul the `renderGateCriteria` function. Each gate will now feature:
  - Status Select/Buttons: Pending, Completed, Blocked, Not Applicable.
  - A Textbox for adding context/notes.
  - A "Save Update" button.
- **Interactive Worksheets:** For specific gates (like `g3_mental_health` / Substance Recovery), replace the standard textbox with a structured mini-form (e.g., "Current Support Plan", "Known Triggers", "Meeting Schedule"). Saving this form compiles the answers into the `participant_notes` field.

### 4. Staff Dashboard Gate Report (`public/index.html` & `public/app.js`)
- Add a "Gate Status Report" button to the Staff Dashboard navigation.
- Build a new modal/view (`modal-gate-report`) that displays a table of all active participants, showing their current Gate week, and explicitly listing any items marked as `Blocked` or left `Pending`.

## Verification Plan
1. Log in as a participant and verify the Master Briefcase is gone.
2. Complete a gate item, change its status to "Blocked", and add a note.
3. Open the "Substance Recovery" gate and fill out the interactive worksheet.
4. Log in as Staff, open the new "Gate Status Report", and verify the participant's blocked items and worksheet notes are visible.
