/**
 * case_plan_exporter.js
 * Generates official, publication-quality printable & exportable Living Case Plans
 * for Turn90 Reentry Navigation clients.
 * 
 * Synthesizes:
 *  - Client demographics & stability tier
 *  - Living goals & actionable steps
 *  - 35-item Briefcase status & barrier audit
 *  - Critical barrier interventions
 *  - Upcoming session agenda
 *  - Recent navigation timeline
 *  - Formal participant/navigator mutual agreement signatures
 */

const { marked } = require('marked');

function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const DOMAIN_CONFIG = {
    core_stability: {
        title: 'Core Stability & Vital Documentation',
        icon: '🏠',
        description: 'Vital records, reliable contact, housing, transportation, and public safety-net benefits.'
    },
    employment_readiness: {
        title: 'Employment Readiness & Workforce Tools',
        icon: '💼',
        description: 'Aptitude assessment, Turn90 resume, interview mastery, and required work gear.'
    },
    skillcat: {
        title: 'Technical Credentials & SkillCat Progression',
        icon: '📜',
        description: 'Trade certifications, EPA/OSHA standards, and specialized vocational milestones.'
    },
    health_wellness: {
        title: 'Physical & Behavioral Health',
        icon: '🩺',
        description: 'Primary care medical home, vision/dental care, mental health counseling, and recovery supports.'
    },
    financial: {
        title: 'Financial Wellness & Asset Building',
        icon: '💳',
        description: 'Personal budgeting, credit report review, debt mitigation, and emergency savings.'
    },
    career_planning: {
        title: 'Career Pathways & Long-Term Growth',
        icon: '🚀',
        description: 'Target industry identification, entry-level career goals, and continuing education.'
    }
};

const CATEGORY_LABELS = {
    housing: '🏠 Housing & Transit',
    employment: '💼 Employment & Career',
    legal: '⚖️ Legal & Child Support',
    health: '🩺 Physical & Mental Health',
    credentials: '📜 Credentials & Trade Training',
    financial: '💳 Financial Empowerment',
    general: '🎯 General & Prosocial Stabilization'
};

function generateCasePlanHtml(data, options = {}) {
    const { client, goals = [], briefcase = [], agenda = '', sessions = [], user = {} } = data;
    const autoprint = !!options.autoprint;

    const todayStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const staffName = (user && user.name) ? user.name : 'Turn90 Reentry Navigator';

    // Tier badge formatting
    let tierText = 'Stable';
    let tierClass = 'tier-stable';
    if (client.stability_tier === 'immediate_triage') {
        tierText = '🚨 Immediate Triage';
        tierClass = 'tier-triage';
    } else if (client.stability_tier === 'at_risk') {
        tierText = '⚠️ At-Risk';
        tierClass = 'tier-at-risk';
    } else {
        tierText = '✅ Stable';
        tierClass = 'tier-stable';
    }

    // Briefcase statistics & critical barriers
    const verifiedItems = briefcase.filter(b => b.status === 'green');
    const criticalBarriers = briefcase.filter(b => b.status === 'red');
    const pendingItems = briefcase.filter(b => b.status === 'pending' || !b.status);

    // Goal statistics
    const inProgressGoals = goals.filter(g => g.status === 'in_progress');
    const completedGoals = goals.filter(g => g.status === 'completed');
    const blockedGoals = goals.filter(g => g.status === 'blocked');

    // Group briefcase items by domain (Reentry Navigation excludes SkillCat / CBT items)
    const briefcaseByDomain = {};
    for (const dKey of Object.keys(DOMAIN_CONFIG)) {
        if (dKey === 'skillcat') continue; // Reentry Navigation only includes Goals & Gates, not SkillCat/CBT
        briefcaseByDomain[dKey] = briefcase.filter(b => b.domain === dKey);
    }
    // Any items with other domain keys
    const otherItems = briefcase.filter(b => !DOMAIN_CONFIG[b.domain] && b.domain !== 'skillcat');
    if (otherItems.length > 0) {
        briefcaseByDomain['other'] = otherItems;
    }

    const assignedNavigator = client.case_manager || staffName || 'Daisy Boynton';
    const g1Pct = client.gate1_pct ?? 0;
    const g2Pct = client.gate2_pct ?? 0;
    const g3Pct = client.gate3_pct ?? 0;
    const g4Pct = client.gate4_pct ?? 0;

    // Rendered Agenda
    let renderedAgenda = '';
    if (agenda && agenda.trim()) {
        try {
            renderedAgenda = marked.parse(agenda.trim());
        } catch (e) {
            renderedAgenda = `<p>${escapeHtml(agenda).replace(/\n/g, '<br>')}</p>`;
        }
    } else {
        renderedAgenda = `<p style="color: #64748b; font-style: italic;">No specific agenda items recorded for the next interaction.</p>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Living Case Plan - ${escapeHtml(client.first_name)} ${escapeHtml(client.last_name)} | Turn90</title>
    <style>
        @page {
            size: letter;
            margin: 0.4in 0.5in;
        }
        * {
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 10pt;
            line-height: 1.45;
            color: #0f172a;
            background: #f8fafc;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .print-toolbar {
            position: sticky;
            top: 0;
            background: #0f172a;
            color: #ffffff;
            padding: 10px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            z-index: 9999;
            font-size: 13px;
        }
        .print-btn {
            background: #0f766e;
            color: white;
            border: none;
            padding: 7px 18px;
            font-size: 13px;
            font-weight: 700;
            border-radius: 6px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            transition: background 0.15s ease;
        }
        .print-btn:hover {
            background: #0d9488;
        }
        .close-btn {
            background: transparent;
            color: #94a3b8;
            border: 1px solid #475569;
            padding: 6px 14px;
            font-size: 12px;
            font-weight: 600;
            border-radius: 6px;
            cursor: pointer;
        }
        .close-btn:hover {
            color: #ffffff;
            border-color: #94a3b8;
        }
        .plan-sheet {
            max-width: 900px;
            margin: 24px auto 48px auto;
            background: #ffffff;
            padding: 40px 48px;
            border-radius: 10px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.06);
            border: 1px solid #e2e8f0;
        }
        .header-letterhead {
            border-bottom: 3px solid #0f766e;
            padding-bottom: 16px;
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }
        .brand-title {
            font-size: 22pt;
            font-weight: 900;
            letter-spacing: -0.5px;
            color: #0f172a;
            line-height: 1.1;
        }
        .brand-subtitle {
            font-size: 10.5pt;
            font-weight: 700;
            color: #0f766e;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-top: 4px;
        }
        .confidential-tag {
            display: inline-block;
            background: #fee2e2;
            color: #991b1b;
            font-size: 8pt;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 4px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-top: 6px;
        }
        .header-meta {
            text-align: right;
            font-size: 9pt;
            color: #475569;
            line-height: 1.4;
        }
        .header-meta strong {
            color: #0f172a;
        }
        .client-profile-card {
            background: #f8fafc;
            border: 1.5px solid #cbd5e1;
            border-radius: 8px;
            padding: 18px 22px;
            margin-bottom: 22px;
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 16px;
        }
        .client-name-title {
            font-size: 18pt;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 6px 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .tier-badge {
            font-size: 9pt;
            font-weight: 800;
            padding: 3px 10px;
            border-radius: 999px;
            display: inline-block;
        }
        .tier-stable { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
        .tier-at-risk { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
        .tier-triage { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }

        .client-details-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            font-size: 9pt;
            color: #334155;
            margin-top: 10px;
        }
        .client-details-grid div strong {
            color: #0f172a;
        }
        .client-notes-box {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 10px 14px;
            font-size: 8.5pt;
            color: #475569;
            line-height: 1.4;
        }
        .metrics-strip {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 24px;
        }
        .metric-cell {
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 10px 14px;
            text-align: center;
        }
        .metric-cell.alert {
            background: #fef2f2;
            border-color: #fecaca;
        }
        .metric-num {
            font-size: 16pt;
            font-weight: 900;
            color: #0f172a;
            line-height: 1.1;
        }
        .metric-cell.alert .metric-num {
            color: #dc2626;
        }
        .metric-lbl {
            font-size: 8pt;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 3px;
        }
        .section-heading {
            font-size: 12pt;
            font-weight: 800;
            color: #0f172a;
            border-bottom: 1.5px solid #0f766e;
            padding-bottom: 5px;
            margin: 26px 0 14px 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .section-heading-tag {
            font-size: 8pt;
            font-weight: 700;
            color: #0f766e;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* Critical Barriers Box */
        .critical-barriers-box {
            background: #fff1f2;
            border: 1.5px solid #fecdd3;
            border-left: 5px solid #e11d48;
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 24px;
            page-break-inside: avoid;
        }
        .critical-barriers-box h3 {
            margin: 0 0 8px 0;
            font-size: 11pt;
            font-weight: 800;
            color: #9f1239;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .barrier-item {
            background: #ffffff;
            border: 1px solid #fda4af;
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 8px;
            font-size: 9pt;
        }
        .barrier-item:last-child {
            margin-bottom: 0;
        }
        .barrier-item-title {
            font-weight: 700;
            color: #881337;
        }
        .barrier-item-notes {
            color: #4c0519;
            margin-top: 2px;
            font-size: 8.5pt;
        }

        /* Goals Section */
        .goal-card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-left: 4px solid #0f766e;
            border-radius: 6px;
            padding: 12px 16px;
            margin-bottom: 12px;
            page-break-inside: avoid;
        }
        .goal-card.blocked {
            border-left-color: #ef4444;
            background: #fffaf0;
        }
        .goal-card.completed {
            border-left-color: #10b981;
            background: #f8fafc;
        }
        .goal-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
        }
        .goal-title {
            font-size: 10.5pt;
            font-weight: 800;
            color: #0f172a;
            margin: 0;
        }
        .goal-meta {
            display: flex;
            gap: 12px;
            font-size: 8.5pt;
            color: #64748b;
            margin-top: 4px;
        }
        .goal-meta strong {
            color: #1e293b;
        }
        .goal-badge {
            font-size: 7.5pt;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 999px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .badge-in-progress { background: #e0f2fe; color: #0369a1; }
        .badge-completed { background: #dcfce7; color: #15803d; }
        .badge-blocked { background: #fee2e2; color: #b91c1c; }

        .goal-steps {
            margin-top: 8px;
            padding-left: 16px;
            font-size: 8.5pt;
            color: #334155;
        }
        .goal-step-item {
            margin-bottom: 3px;
            display: flex;
            align-items: flex-start;
            gap: 6px;
        }
        .step-box {
            font-family: monospace;
            font-size: 10pt;
            color: #64748b;
            line-height: 1;
        }

        /* Briefcase Matrix */
        .domain-block {
            margin-bottom: 18px;
            page-break-inside: avoid;
        }
        .domain-title {
            font-size: 10pt;
            font-weight: 800;
            color: #1e293b;
            margin: 0 0 6px 0;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .briefcase-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8.5pt;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            overflow: hidden;
        }
        .briefcase-table th {
            background: #f1f5f9;
            padding: 6px 10px;
            text-align: left;
            font-weight: 700;
            color: #475569;
            font-size: 8pt;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #e2e8f0;
        }
        .briefcase-table td {
            padding: 6px 10px;
            border-bottom: 1px solid #f1f5f9;
            vertical-align: top;
        }
        .briefcase-table tr:last-child td {
            border-bottom: none;
        }
        .status-dot {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-weight: 700;
            font-size: 8pt;
            padding: 1px 6px;
            border-radius: 4px;
        }
        .status-dot.green { background: #dcfce7; color: #166534; }
        .status-dot.red { background: #fee2e2; color: #991b1b; }
        .status-dot.pending { background: #f1f5f9; color: #64748b; }

        /* Agenda Block */
        .agenda-box {
            background: #f0fdf4;
            border: 1.5px solid #bbf7d0;
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 24px;
            font-size: 9pt;
            color: #14532d;
            line-height: 1.5;
            page-break-inside: avoid;
        }
        .agenda-box h3, .agenda-box h4 {
            color: #166534;
            margin-top: 0;
            margin-bottom: 8px;
            font-size: 10.5pt;
        }
        .agenda-box ul {
            margin: 6px 0 0 0;
            padding-left: 20px;
        }
        .agenda-box li {
            margin-bottom: 4px;
        }

        /* Recent Sessions */
        .session-item {
            border-bottom: 1px solid #e2e8f0;
            padding: 8px 0;
            font-size: 8.5pt;
            page-break-inside: avoid;
        }
        .session-item:last-child {
            border-bottom: none;
        }
        .session-title-line {
            display: flex;
            justify-content: space-between;
            font-weight: 700;
            color: #0f172a;
        }

        /* Signatures Section */
        .signature-section {
            margin-top: 32px;
            padding-top: 20px;
            border-top: 2px solid #cbd5e1;
            page-break-inside: avoid;
        }
        .commitment-text {
            font-size: 8pt;
            color: #475569;
            line-height: 1.4;
            margin-bottom: 24px;
            text-align: justify;
        }
        .signature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            margin-bottom: 20px;
        }
        .signature-box {
            font-size: 8.5pt;
        }
        .sig-line {
            border-bottom: 1.5px solid #0f172a;
            height: 38px;
            margin-bottom: 6px;
        }
        .sig-label {
            font-weight: 700;
            color: #0f172a;
        }
        .sig-name {
            color: #475569;
            font-size: 8pt;
        }
        .sig-date-line {
            margin-top: 10px;
            font-size: 8pt;
            color: #475569;
        }
        .review-schedule {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 8pt;
            color: #334155;
            text-align: center;
        }

        @media print {
            .no-print {
                display: none !important;
            }
            body {
                background: #ffffff !important;
                font-size: 9.5pt;
            }
            .plan-sheet {
                box-shadow: none !important;
                border: none !important;
                margin: 0 !important;
                padding: 0 !important;
                max-width: 100% !important;
            }
            .signature-section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>

    <!-- On-screen Print & Control Bar -->
    <div class="print-toolbar no-print">
        <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 18px;">📄</span>
            <div>
                <strong style="font-size: 13.5px;">Turn90 Reentry Navigation Living Case Plan</strong>
                <span style="font-size: 11.5px; color: #94a3b8; margin-left: 8px;">
                    ${escapeHtml(client.first_name)} ${escapeHtml(client.last_name)} &bull; ${escapeHtml(client.location)} Center
                </span>
            </div>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
            <button class="print-btn" onclick="window.print()">
                🖨️ Print / Save as PDF
            </button>
            <button class="close-btn" onclick="window.close()">
                ✕ Close
            </button>
        </div>
    </div>

    <!-- Printable Sheet Container -->
    <div class="plan-sheet">

        <!-- Letterhead Header -->
        <div class="header-letterhead">
            <div>
                <div class="brand-title">TURN90</div>
                <div class="brand-subtitle">Reentry Navigation &bull; Goals &amp; Briefcase Gates Case Plan (Non-CBT)</div>
                <span class="confidential-tag">🔒 Reentry Navigation &bull; Goals &amp; Gates 1–4</span>
            </div>
            <div class="header-meta">
                <div><strong>Center:</strong> ${escapeHtml(client.location)}, SC</div>
                <div><strong>Date Generated:</strong> ${todayStr}</div>
                <div><strong>Apricot ID:</strong> ${escapeHtml(client.apricot_id || 'N/A')}</div>
                <div><strong>Assigned Case Manager:</strong> ${escapeHtml(assignedNavigator)}</div>
            </div>
        </div>

        <!-- Client Profile Snapshot -->
        <div class="client-profile-card">
            <div>
                <div class="client-name-title">
                    <span>${escapeHtml(client.first_name)} ${escapeHtml(client.last_name)}</span>
                    <span class="tier-badge ${tierClass}">${tierText}</span>
                </div>
                <div class="client-details-grid">
                    <div><strong>Assigned Case Manager:</strong> ${escapeHtml(assignedNavigator)}</div>
                    <div><strong>Enrollment Start:</strong> ${escapeHtml(client.enrollment_start || 'On file')}</div>
                    <div><strong>Enrolled Center:</strong> ${escapeHtml(client.location)} Center</div>
                    <div><strong>Program Scope:</strong> Goals &amp; Briefcase Gates 1–4 (No CBT)</div>
                </div>
            </div>
            <div class="client-notes-box">
                <strong style="color: #0f172a; display: block; margin-bottom: 3px;">Stated Reentry Navigation Goals &amp; Plan:</strong>
                ${client.case_plan_text || client.notes ? escapeHtml(client.case_plan_text || client.notes) : '<em>No initial triage intake notes entered.</em>'}
            </div>
        </div>

        <!-- Metrics Overview Strip -->
        <div class="metrics-strip">
            <div class="metric-cell">
                <div class="metric-num">${g1Pct}%</div>
                <div class="metric-lbl">Gate 1 (Vital ID &amp; Meds)</div>
            </div>
            <div class="metric-cell">
                <div class="metric-num">${g2Pct}%</div>
                <div class="metric-lbl">Gate 2 (Housing, DMV, Resume)</div>
            </div>
            <div class="metric-cell">
                <div class="metric-num">${g3Pct}%</div>
                <div class="metric-lbl">Gate 3 (Health &amp; Banking)</div>
            </div>
            <div class="metric-cell">
                <div class="metric-num">${g4Pct}%</div>
                <div class="metric-lbl">Gate 4 (Work Gear &amp; Transit)</div>
            </div>
        </div>

        <!-- Critical Barriers Alert (if any red items) -->
        ${criticalBarriers.length > 0 ? `
        <div class="critical-barriers-box">
            <h3>🚨 Identified Critical Barriers Requiring Direct Navigator Intervention</h3>
            <p style="font-size: 8.5pt; color: #881337; margin: 0 0 10px 0;">
                The following briefcase stability markers are currently flagged as acute barriers. Navigator advocacy, system navigation, and referral actions are in progress to remove these obstacles:
            </p>
            ${criticalBarriers.map(b => {
                const domainName = DOMAIN_CONFIG[b.domain]?.title || b.domain;
                return `
                <div class="barrier-item">
                    <div style="display: flex; justify-content: space-between;">
                        <span class="barrier-item-title">${escapeHtml(b.title)}</span>
                        <span style="font-size: 7.5pt; color: #9f1239; font-weight: 700; text-transform: uppercase;">${escapeHtml(domainName)}</span>
                    </div>
                    <div class="barrier-item-notes">
                        <strong>Navigator Findings:</strong> ${b.notes ? escapeHtml(b.notes) : 'Active barrier identified during briefcase audit. Remediation required.'}
                    </div>
                </div>
                `;
            }).join('')}
        </div>
        ` : ''}

        <!-- 1. Next Interaction Agenda -->
        <div class="section-heading">
            <span>🗣️ Immediate Action Agenda & Next Session Focus</span>
            <span class="section-heading-tag">Navigator Checklist</span>
        </div>
        <div class="agenda-box">
            ${renderedAgenda}
        </div>

        <!-- 2. Living Goals & Action Roadmap -->
        <div class="section-heading">
            <span>🎯 Living Goals & Step-by-Step Action Roadmap</span>
            <span class="section-heading-tag">${goals.length} Goals Registered</span>
        </div>
        ${goals.length === 0 ? `
            <div style="padding: 16px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; text-align: center; color: #64748b; font-size: 9pt;">
                No goals recorded for this participant yet. Upload a check-in session to auto-generate goals.
            </div>
        ` : goals.map(g => {
            let badgeClass = 'badge-in-progress';
            let badgeLabel = '🔄 In Progress';
            let cardClass = '';

            if (g.status === 'completed') {
                badgeClass = 'badge-completed';
                badgeLabel = '✅ Completed';
                cardClass = 'completed';
            } else if (g.status === 'blocked') {
                badgeClass = 'badge-blocked';
                badgeLabel = '⛔ Blocked';
                cardClass = 'blocked';
            }

            const categoryLabel = CATEGORY_LABELS[g.category] || (g.category ? g.category.toUpperCase() : 'GENERAL');
            const steps = Array.isArray(g.action_steps) ? g.action_steps : [];

            return `
            <div class="goal-card ${cardClass}">
                <div class="goal-header">
                    <div>
                        <div style="font-size: 8pt; font-weight: 700; color: #0f766e; text-transform: uppercase; margin-bottom: 2px;">
                            ${escapeHtml(categoryLabel)}
                        </div>
                        <h4 class="goal-title">${escapeHtml(g.goal_title)}</h4>
                    </div>
                    <span class="goal-badge ${badgeClass}">${badgeLabel}</span>
                </div>
                <div class="goal-meta">
                    <span>Target Date: <strong>${g.target_date || 'Ongoing'}</strong></span>
                    <span>Assigned Lead: <strong style="text-transform: capitalize;">${escapeHtml(g.assigned_to || 'Client')}</strong></span>
                </div>
                ${steps.length > 0 ? `
                <div class="goal-steps">
                    ${steps.map(s => `
                        <div class="goal-step-item">
                            <span class="step-box">${g.status === 'completed' ? '☑' : '☐'}</span>
                            <span>${escapeHtml(s)}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
            `;
        }).join('')}

        <!-- 3. Comprehensive 35-Item Briefcase Status Breakdown -->
        <div class="section-heading" style="margin-top: 32px;">
            <span>💼 Comprehensive 35-Item Briefcase Status & Barrier Matrix</span>
            <span class="section-heading-tag">${verifiedItems.length} Verified &bull; ${criticalBarriers.length} Barriers &bull; ${pendingItems.length} Pending</span>
        </div>

        ${Object.keys(briefcaseByDomain).map(dKey => {
            const domainItems = briefcaseByDomain[dKey];
            if (!domainItems || domainItems.length === 0) return '';
            const conf = DOMAIN_CONFIG[dKey] || { title: dKey.toUpperCase(), icon: '📁' };

            return `
            <div class="domain-block">
                <div class="domain-title">
                    <span>${conf.icon}</span>
                    <span>${conf.title}</span>
                </div>
                <table class="briefcase-table">
                    <thead>
                        <tr>
                            <th style="width: 38%;">Item / Milestone</th>
                            <th style="width: 22%;">Status</th>
                            <th style="width: 40%;">Navigator Assessment & Verification Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${domainItems.map(item => {
                            let dotClass = 'pending';
                            let dotLabel = '⚪ Pending';
                            if (item.status === 'green') {
                                dotClass = 'green';
                                dotLabel = '🟢 Verified';
                            } else if (item.status === 'red') {
                                dotClass = 'red';
                                dotLabel = '🔴 Active Barrier';
                            }
                            return `
                            <tr>
                                <td><strong>${escapeHtml(item.title)}</strong></td>
                                <td><span class="status-dot ${dotClass}">${dotLabel}</span></td>
                                <td style="color: ${item.status === 'red' ? '#991b1b; font-weight: 600;' : '#475569;'}">
                                    ${item.notes ? escapeHtml(item.notes) : '<em style="color: #94a3b8;">Pending review</em>'}
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            `;
        }).join('')}

        <!-- 4. Recent Navigation Interactions Timeline (if available) -->
        ${sessions && sessions.length > 0 ? `
        <div class="section-heading" style="margin-top: 30px;">
            <span>📜 Recent Navigation Sessions & Interaction Timeline</span>
            <span class="section-heading-tag">Last ${Math.min(sessions.length, 3)} Sessions</span>
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 16px; margin-bottom: 24px;">
            ${sessions.slice(0, 3).map(s => `
                <div class="session-item">
                    <div class="session-title-line">
                        <span><strong>${escapeHtml(s.session_title || 'Session Check-In')}</strong> <span style="font-weight: normal; color: #64748b;">(${escapeHtml(s.session_type || 'check_in')})</span></span>
                        <span style="color: #64748b; font-size: 8pt;">${s.session_date || ''}</span>
                    </div>
                    ${s.notes_text ? `
                        <div style="color: #475569; margin-top: 3px; font-size: 8pt; line-height: 1.35;">
                            ${escapeHtml(s.notes_text).slice(0, 240)}${s.notes_text.length > 240 ? '...' : ''}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
        ` : ''}

        <!-- 5. Signatures & Mutual Accountability Agreement -->
        <div class="signature-section">
            <p class="commitment-text">
                <strong>Mutual Accountability & Living Case Plan Agreement:</strong><br>
                By signing below, the participant and Turn90 Reentry Navigator confirm that this individualized living case plan has been reviewed, agreed upon, and established as the operating roadmap toward personal stability, legal compliance, and long-term economic independence. The participant agrees to work toward the action steps identified, and Turn90 commits to providing trauma-informed coaching, barrier removal resources, and employment placement navigation. This plan is reviewed and updated at every 1-on-1 navigation session.
            </p>
            <div class="signature-grid">
                <div class="signature-box">
                    <div class="sig-line"></div>
                    <div class="sig-label">Participant Signature</div>
                    <div class="sig-name">${escapeHtml(client.first_name)} ${escapeHtml(client.last_name)}</div>
                    <div class="sig-date-line">Date: _________________________________</div>
                </div>
                <div class="signature-box">
                    <div class="sig-line"></div>
                    <div class="sig-label">Turn90 Reentry Navigator Signature</div>
                    <div class="sig-name">${escapeHtml(staffName)}</div>
                    <div class="sig-date-line">Date: _________________________________</div>
                </div>
            </div>
            <div class="review-schedule">
                <strong>Next Scheduled 30-Day Living Case Plan Review:</strong> ___________________________________
            </div>
        </div>

    </div>

    ${autoprint ? `
    <script>
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 450);
        };
    </script>
    ` : ''}

</body>
</html>`;
}

function generateApricotCasePlanHtml(evalContext, options = {}) {
    if (!evalContext) {
        throw new Error('Participant context is required to generate an Apricot Case Plan.');
    }
    const autoprint = options.autoprint === true;
    const isReentryNav = (evalContext.program || '').toLowerCase().includes('reentry');
    const todayStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const g1 = evalContext.gate1Pct ?? 0;
    const g2 = evalContext.gate2Pct ?? 0;
    const g3 = evalContext.gate3Pct ?? 0;
    const g4 = evalContext.gate4Pct ?? 0;
    const staffName = evalContext.caseManager || evalContext.lastContactStaff || (isReentryNav ? 'Daisy Boynton' : 'First Shift Case Manager');
    const nextSteps = Array.isArray(evalContext.whatToWorkOnNext) ? evalContext.whatToWorkOnNext : [];
    const recentNotes = Array.isArray(evalContext.recentNotes) ? evalContext.recentNotes : [];
    const headerColor = isReentryNav ? '#0f766e' : '#1e3a8a';
    const badgeBg = isReentryNav ? '#f0fdfa' : '#eff6ff';
    const badgeBorder = isReentryNav ? '#99f6e4' : '#bfdbfe';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Turn90 Case Plan — ${escapeHtml(evalContext.name)} (#${escapeHtml(evalContext.recordId)})</title>
    <style>
        @page { size: letter portrait; margin: 0.5in; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            background: #f1f5f9;
            margin: 0;
            padding: 0;
            font-size: 10pt;
            line-height: 1.45;
        }
        .print-toolbar {
            background: #0f172a;
            color: #ffffff;
            padding: 12px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 999;
        }
        .print-btn {
            background: #0d9488;
            color: #fff;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
        }
        .close-btn {
            background: transparent;
            color: #cbd5e1;
            border: 1px solid #475569;
            padding: 7px 14px;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
        }
        .plan-sheet {
            max-width: 8.5in;
            margin: 24px auto;
            background: #ffffff;
            padding: 0.55in;
            box-shadow: 0 10px 25px rgba(15, 23, 42, 0.1);
            border-radius: 8px;
        }
        .header-letterhead {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 3px solid ${headerColor};
            padding-bottom: 14px;
            margin-bottom: 18px;
        }
        .brand-title { font-size: 20pt; font-weight: 900; color: ${headerColor}; margin: 0; }
        .brand-subtitle { font-size: 9.5pt; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.6px; margin-top: 2px; }
        .scope-tag {
            display: inline-block;
            margin-top: 6px;
            background: ${badgeBg};
            color: ${headerColor};
            border: 1px solid ${badgeBorder};
            font-size: 8pt;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 4px;
            text-transform: uppercase;
        }
        .metrics-strip {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-bottom: 18px;
        }
        .metric-cell {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 10px;
            text-align: center;
        }
        .metric-num { font-size: 15pt; font-weight: 800; color: ${headerColor}; }
        .metric-lbl { font-size: 7.5pt; font-weight: 700; color: #64748b; text-transform: uppercase; margin-top: 2px; }
        .section-heading {
            background: #0f172a;
            color: #ffffff;
            padding: 7px 12px;
            font-size: 9.5pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            border-radius: 4px;
            margin: 18px 0 10px 0;
            display: flex;
            justify-content: space-between;
        }
        .box {
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 12px 14px;
            background: #ffffff;
            margin-bottom: 12px;
        }
        .step-item {
            display: flex;
            gap: 8px;
            align-items: flex-start;
            padding: 6px 0;
            border-bottom: 1px dashed #e2e8f0;
            font-size: 9.5pt;
        }
        .step-item:last-child { border-bottom: none; }
        .signature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 32px;
            margin-top: 28px;
            padding-top: 16px;
            border-top: 2px solid #cbd5e1;
        }
        .sig-line { border-bottom: 1px solid #0f172a; height: 28px; margin-bottom: 5px; }
        @media print {
            body { background: #fff; }
            .no-print { display: none !important; }
            .plan-sheet { box-shadow: none; margin: 0; padding: 0; max-width: 100%; }
        }
    </style>
</head>
<body>
    <div class="print-toolbar no-print">
        <div>
            <strong>Turn90 ${escapeHtml(evalContext.program)} Case Plan</strong>
            <span style="margin-left:10px;color:#94a3b8;">${escapeHtml(evalContext.name)} (#${escapeHtml(evalContext.recordId)}) &bull; ${escapeHtml(evalContext.location)}</span>
        </div>
        <div style="display:flex;gap:10px;">
            <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
            <button class="close-btn" onclick="window.close()">✕ Close</button>
        </div>
    </div>

    <div class="plan-sheet">
        <div class="header-letterhead">
            <div>
                <div class="brand-title">TURN90</div>
                <div class="brand-subtitle">${isReentryNav ? 'Reentry Navigation • Goals & Briefcase Gates Case Plan' : 'First Shift • CBT, Briefcase & Gates Case Plan'}</div>
                <span class="scope-tag">${isReentryNav ? 'Goals & Briefcase Gates 1–4 Only (No CBT)' : 'CBT Focus Areas + Briefcase Gates 1–4'}</span>
            </div>
            <div style="text-align:right;font-size:8.5pt;color:#334155;line-height:1.5;">
                <div><strong>Center:</strong> ${escapeHtml(evalContext.location)}</div>
                <div><strong>Apricot ID:</strong> #${escapeHtml(evalContext.recordId)}</div>
                <div><strong>Case Manager:</strong> ${escapeHtml(staffName)}</div>
                <div><strong>Generated:</strong> ${todayStr}</div>
            </div>
        </div>

        <div class="box" style="background:#f8fafc;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="font-size:13pt;">${escapeHtml(evalContext.name)}</strong>
                <span style="font-size:8.5pt;font-weight:700;padding:3px 8px;border-radius:999px;background:${badgeBg};color:${headerColor};border:1px solid ${badgeBorder};">
                    ${escapeHtml(evalContext.casePlanStatus || 'Case Plan Review')}
                </span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9pt;color:#334155;">
                <div><strong>Program:</strong> ${escapeHtml(evalContext.program)}</div>
                <div><strong>Center:</strong> ${escapeHtml(evalContext.location)}</div>
                <div><strong>Assigned Staff:</strong> ${escapeHtml(staffName)}</div>
                <div><strong>Last Contact:</strong> ${escapeHtml(evalContext.lastContactDate || 'On File')} (${escapeHtml(evalContext.lastContactActivity || 'Session')})</div>
            </div>
        </div>

        <div class="metrics-strip">
            <div class="metric-cell">
                <div class="metric-num">${g1}%</div>
                <div class="metric-lbl">Gate 1 (ID &amp; Meds)</div>
            </div>
            <div class="metric-cell">
                <div class="metric-num">${g2}%</div>
                <div class="metric-lbl">Gate 2 (Housing/DMV/Resume)</div>
            </div>
            <div class="metric-cell">
                <div class="metric-num">${g3}%</div>
                <div class="metric-lbl">Gate 3 (Health &amp; Banking)</div>
            </div>
            <div class="metric-cell">
                <div class="metric-num">${g4}%</div>
                <div class="metric-lbl">Gate 4 (Work Gear &amp; Transit)</div>
            </div>
        </div>

        ${isReentryNav ? `
        <div class="section-heading">
            <span>🎯 Reentry Navigation Stated Goals (Non-CBT)</span>
            <span>Goals &amp; Gates Scope</span>
        </div>
        <div class="box">
            <p style="margin:0;font-size:9.5pt;color:#1e293b;">
                ${evalContext.casePlanDetails?.goalsText ? escapeHtml(evalContext.casePlanDetails.goalsText) : '<em style="color:#b91c1c;">No formal Reentry Navigation Case Plan goal text entered in Apricot yet — complete intake goal setting with participant.</em>'}
            </p>
        </div>
        ` : `
        <div class="section-heading">
            <span>🧠 First Shift CBT Case Plan Focus Areas &amp; Risky Situations</span>
            <span>CBT + Briefcase Scope</span>
        </div>
        <div class="box">
            <div style="margin-bottom:10px;">
                <strong style="color:#1e3a8a;">Focus Area 1 (Social Skill / Thinking Pattern):</strong>
                <div style="margin-top:3px;">${evalContext.casePlanDetails?.focus1 ? escapeHtml(evalContext.casePlanDetails.focus1) : '<em style="color:#b91c1c;">Not yet entered in Apricot</em>'}</div>
                <div style="margin-top:4px;font-size:8.5pt;color:#475569;"><strong>Situations Where This Shows Up:</strong> ${evalContext.casePlanDetails?.situations1 ? escapeHtml(evalContext.casePlanDetails.situations1) : '<em>Blank — needs specific real-world triggers documented</em>'}</div>
            </div>
            <div style="border-top:1px solid #e2e8f0;padding-top:10px;">
                <strong style="color:#1e3a8a;">Focus Area 2 (Social Skill / Thinking Pattern):</strong>
                <div style="margin-top:3px;">${evalContext.casePlanDetails?.focus2 ? escapeHtml(evalContext.casePlanDetails.focus2) : '<em style="color:#b91c1c;">Not yet entered in Apricot</em>'}</div>
                <div style="margin-top:4px;font-size:8.5pt;color:#475569;"><strong>Situations Where This Shows Up:</strong> ${evalContext.casePlanDetails?.situations2 ? escapeHtml(evalContext.casePlanDetails.situations2) : '<em>Blank — needs specific real-world triggers documented</em>'}</div>
            </div>
        </div>
        `}

        <div class="section-heading">
            <span>📋 What to Work on Next in Case Management</span>
            <span>Grounded in Case Plan, Briefcase &amp; Gates 1–4</span>
        </div>
        <div class="box">
            ${nextSteps.length > 0 ? nextSteps.map(s => `
                <div class="step-item">
                    <span>☐</span>
                    <span>${escapeHtml(s)}</span>
                </div>
            `).join('') : '<div>Review Briefcase Gates 1–4 and active case plan goals.</div>'}
        </div>

        <div class="section-heading">
            <span>🔍 Case Plan &amp; Briefcase Operational Feedback</span>
            <span>Supervisor / PM Review</span>
        </div>
        <div class="box" style="font-size:9pt;color:#334155;">
            <div style="margin-bottom:8px;"><strong>Current Assessment:</strong> ${escapeHtml(evalContext.operationalFeedback || '')}</div>
            <div><strong>Case Note Summary:</strong> ${escapeHtml(evalContext.caseNoteAnalysis || '')}</div>
        </div>

        ${recentNotes.length > 0 ? `
        <div class="section-heading">
            <span>📜 Recent Deduplicated Case Notes (${recentNotes.length})</span>
            <span>Apricot Sync</span>
        </div>
        <div class="box" style="font-size:8.5pt;color:#475569;">
            ${recentNotes.slice(0, 3).map(n => `
                <div style="padding:5px 0;border-bottom:1px dashed #e2e8f0;">
                    <strong>${escapeHtml(n.contact_date || '')} &bull; ${escapeHtml(n.staff_name || '')} (${escapeHtml(n.activity || '')}):</strong>
                    <div>${escapeHtml((n.note_text || '').slice(0, 260))}${(n.note_text || '').length > 260 ? '...' : ''}</div>
                </div>
            `).join('')}
        </div>
        ` : ''}

        <div class="signature-grid">
            <div>
                <div class="sig-line"></div>
                <div style="font-size:8pt;font-weight:700;text-transform:uppercase;color:#475569;">Participant Signature (${escapeHtml(evalContext.name)})</div>
                <div style="font-size:8pt;color:#64748b;margin-top:6px;">Date: ________________________</div>
            </div>
            <div>
                <div class="sig-line"></div>
                <div style="font-size:8pt;font-weight:700;text-transform:uppercase;color:#475569;">Case Manager Signature (${escapeHtml(staffName)})</div>
                <div style="font-size:8pt;color:#64748b;margin-top:6px;">Date: ________________________</div>
            </div>
        </div>
    </div>
    ${autoprint ? `<script>window.onload=function(){setTimeout(function(){window.print();},400);};</script>` : ''}
</body>
</html>`;
}

module.exports = {
    generateCasePlanHtml,
    generateApricotCasePlanHtml,
    escapeHtml,
    DOMAIN_CONFIG,
    CATEGORY_LABELS
};
