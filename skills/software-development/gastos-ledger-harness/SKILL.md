---
name: gastos-ledger-harness
description: Use when operating Nuestras Cuentitas ledger data through domain integration APIs from Hermes, including snapshot, reconciliation preview/apply, Excel readback, and drift diagnosis without exposing secrets or real payloads.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [nuestras-cuentitas, ledger, finance, reconciliation, excel, api-only]
    related_skills: []
---

# Gastos Ledger Harness

## Overview

This skill defines the Hermes operator contract for Nuestras Cuentitas ledger work. It lets Hermes inspect monthly financial state, preview reconciliations, apply explicitly confirmed missing items, and verify that `/excel` plus exported XLSX remain the monthly truth oracle.

The bundle is source-controlled under `skills/software-development/gastos-ledger-harness/` because this Hermes Desktop checkout did not contain an in-repo `skills/` tree. `software-development` is the closest Hermes skill category for an API-only domain operator harness. Runtime installation into `~/.hermes/skills` is a separate manual or packaging step; this skill never performs that installation by itself.

## When to Use

Use this skill when the user asks Hermes to:

- Answer "what did we spend this month?", "what is deferred?", "which payment method was used?", "what is projected?", "which card closes or expires?", or "what is missing?" from the Nuestras Cuentitas domain state.
- Reconcile structured rows, sanitized OCR, text summaries, or file references against existing ledger data.
- Create selected missing expenses or card-period updates after a preview has been reviewed and `confirm=true` is explicit.
- Prove that domain API state, `/excel`, and XLSX export agree for a month.
- Diagnose drift between integration APIs, the visible Excel page, and workbook readback.

Do not use this skill for:

- Direct database writes, migrations, SQL repair, admin console edits, or fixture seeding.
- Applying real financial data without explicit user confirmation in the current session.
- Printing secrets, cookies, tokens, raw OCR text, raw statement payloads, or full customer records into chat, logs, commits, or evidence.
- Screenshot-only validation when an API or XLSX readback is available.

## Non-Negotiable Safety Contract

All mutations go through domain integration APIs. The harness must never write directly to a database or teach a user to bypass domain validation, idempotency, authorization scopes, reconciliation review, or audit trails.

Required API surface:

| Capability | Method and path | Purpose |
| --- | --- | --- |
| Monthly state | `GET /api/integrations/ledger/snapshot` | Read payment methods, owners, closings, due dates, expenses, installments, income, debts, fixed expenses, OCR/reconciliation state, and monthly totals. |
| Reconciliation preview | `POST /api/integrations/ledger/reconciliation/preview` | Compare incoming rows, text, sanitized OCR, or file references against existing domain state without mutating. |
| Confirmed apply | `POST /api/integrations/ledger/reconciliation/apply` | Create only selected missing items or period updates when `confirm=true` and an idempotency key are present. |
| Domain readback | `GET /api/integrations/ledger/readback` | Confirm applied data is visible through the domain and ready for `/excel` plus XLSX validation. |

Every mutating request must include:

- `confirm: true`.
- A stable `idempotencyKey`.
- Explicit selected candidate ids, never "apply all" by default.
- A short audit reason such as `hermes-ledger-reconciliation`.
- A preflight result showing only secret names and presence, never values.
- A post-apply readback plan.

## Secret Preflight Names-Only

Before any API call, resolve configuration names without printing values. The operator may report only `present`, `missing`, or `not_applicable`.

Recommended names:

| Name | Required | Notes |
| --- | --- | --- |
| `GASTOS_LEDGER_BASE_URL` | yes | Base URL for the Nuestras Cuentitas deployment or local target. |
| `GASTOS_LEDGER_INTEGRATION_KEY` | yes | Integration credential with ledger scopes. |
| `GASTOS_LEDGER_PROFILE` | no | Optional target profile or environment label. |
| `GASTOS_LEDGER_EXPORT_DIR` | no | Optional local directory for synthetic XLSX readback artifacts. |

Preflight output shape:

```yaml
secret_preflight:
  GASTOS_LEDGER_BASE_URL: present
  GASTOS_LEDGER_INTEGRATION_KEY: present
  GASTOS_LEDGER_PROFILE: not_applicable
  printed_values: false
```

Never echo request headers, cookies, bearer tokens, API keys, raw `.env` lines, browser storage, database URLs, or raw customer statement text.

## Input Policy

The harness accepts only reviewed inputs:

- `period`: `year` and `month`.
- `source_kind`: `structured_rows`, `text_summary`, `sanitized_ocr`, `pdf_reference`, or `image_reference`.
- `source_ref`: a user-approved reference, stable artifact id, or local path label. Evidence must use a redacted label or hash, not the raw path if it contains private names.
- `rows`: structured entries with dates, descriptions, amounts, currency, payment method hints, installment hints, and statement metadata.
- `selection`: preview candidate ids chosen by the user for apply.
- `confirm`: boolean; apply is forbidden unless it is exactly `true`.

For real data, keep full payloads in memory only for the active operation. Evidence should store counts, totals by category when user-approved, hashes, candidate ids, and typed outcomes rather than raw merchant lines or statement pages.

## Command Recipes

These are operator recipes for Hermes. They describe the required sequence and request shape; the exact HTTP client can be the active Hermes tool, a typed integration client, or a test harness provided by the deployment.

### `estado` / Snapshot

Goal: answer the monthly financial state without mutation.

1. Run secret preflight names-only.
2. Call:

```http
GET {baseUrl}/api/integrations/ledger/snapshot?year=YYYY&month=MM
X-Integration-Key: <resolved in memory only>
```

3. Summarize the response by domain sections:

- Payment methods and owners.
- Closings and due dates.
- Expenses and installments.
- Income, debts, fixed expenses, and projected items.
- OCR or reconciliation queues.
- Monthly totals and known gaps.

4. For evidence, report only the period, request id, section counts, and pass/fail checks. Do not include raw merchant lines unless the user explicitly requests visible data in the live chat and confirms it is acceptable.

Expected result shape:

```yaml
estado_result:
  period: "YYYY-MM"
  api_path: "/api/integrations/ledger/snapshot"
  sections_seen:
    payment_methods: true
    card_periods: true
    expenses: true
    installments: true
    income: true
    debts: true
    fixed_expenses: true
    reconciliation: true
    monthly_summary: true
  evidence_redacted: true
```

### `preview` / Reconciliation Preview

Goal: compare candidate data against domain state without creating anything.

1. Normalize inputs into structured candidates.
2. Preserve the original source only as a user-approved reference or redacted artifact hash.
3. Call:

```http
POST {baseUrl}/api/integrations/ledger/reconciliation/preview
X-Integration-Key: <resolved in memory only>
Content-Type: application/json
```

Payload shape:

```json
{
  "period": { "year": 2026, "month": 7 },
  "sourceKind": "structured_rows",
  "sourceRef": "redacted-or-synthetic-ref",
  "candidates": [
    {
      "clientRowId": "row-001",
      "date": "YYYY-MM-DD",
      "description": "redacted description or synthetic label",
      "amount": 0,
      "currency": "ARS",
      "paymentMethodHint": "card-or-account-label",
      "installmentHint": "1/3"
    }
  ]
}
```

4. Present matches, probable duplicates, missing candidates, exclusions, typed warnings, and confidence. Ask for explicit selection before apply.

Preview must not mutate. If the API reports a mutation during preview, stop and mark the run failed.

### `apply` / Confirmed Reconciliation

Goal: create only selected missing items and allowed card-period updates after review.

Apply is valid only after a successful preview in the same task context or a persisted preview id that the user explicitly names.

Required checks:

- `confirm=true` is present.
- User selected specific preview candidate ids.
- `idempotencyKey` is stable for the preview plus selection.
- Scope allows ledger reconciliation apply.
- No direct database path is proposed.

Request shape:

```json
{
  "previewId": "preview-id-from-api",
  "confirm": true,
  "idempotencyKey": "stable-redacted-key",
  "auditReason": "hermes-ledger-reconciliation",
  "selectedCandidateIds": ["candidate-001"],
  "cardPeriodUpdates": [
    {
      "paymentMethodId": "method-id",
      "period": { "year": 2026, "month": 7 },
      "closingDate": "YYYY-MM-DD",
      "dueDate": "YYYY-MM-DD"
    }
  ]
}
```

After apply:

1. Call ledger readback.
2. Verify created ids or idempotent already-present ids.
3. Verify `/excel` and XLSX readback are scheduled or completed.
4. Record audit id, created counts, skipped duplicate counts, and readback status.

Never apply all preview candidates automatically. If the user asks for "apply everything", show the preview summary and ask them to confirm the selected ids or an explicit all-candidates confirmation in the live session.

### `readback` / Excel Truth Oracle

Goal: prove the domain and monthly truth surfaces agree.

1. Call:

```http
GET {baseUrl}/api/integrations/ledger/readback?year=YYYY&month=MM
X-Integration-Key: <resolved in memory only>
```

2. Open or request `/excel?year=YYYY&month=MM&source=ledger` in headed browser when production validation is in scope.
3. Export XLSX through the app-supported path.
4. Read workbook sheets expected by the goal:

- `Resumen mensual`
- `Medios de pago`
- `Detalle`
- `Cuotas futuras`
- `Deudas`
- `Conciliacion`

5. Compare API readback, visible `/excel`, and XLSX rows by stable ids, period, payment method, owner, card closing/due date, currency, installment plan, reconciliation state, and totals.

Evidence should show:

```yaml
excel_truth_readback:
  period: "YYYY-MM"
  api_readback: pass
  browser_excel: pass
  xlsx_readback: pass
  sheets_seen:
    - Resumen mensual
    - Medios de pago
    - Detalle
    - Cuotas futuras
    - Deudas
    - Conciliacion
  raw_payload_logged: false
```

### `drift` / Diagnosis

Goal: explain any difference between domain APIs, `/excel`, and XLSX without mutating.

Classify drift with stable codes:

| Code | Meaning |
| --- | --- |
| `api_missing` | Expected item appears in Excel/XLSX but not in ledger API readback. |
| `excel_missing` | Domain API has the item but `/excel` does not show it. |
| `xlsx_missing` | Domain API or `/excel` has the item but exported workbook does not. |
| `total_mismatch` | Totals differ after currency, period, and installment rules are normalized. |
| `period_metadata_mismatch` | Closing, due date, owner, or payment method metadata differs. |
| `reconciliation_state_mismatch` | Candidate/applied/reviewed state differs between sources. |

Report drift as counts, ids, periods, and redacted labels. Include exact raw values only in a private, user-approved live inspection context; never commit them.

## Installation and Packaging Notes

This checkout did not have an existing in-repo `skills/` bundle. The bundle is therefore added at:

```text
skills/software-development/gastos-ledger-harness/SKILL.md
```

Manual installation after review can copy this directory into a Hermes runtime skills directory, for example:

```text
~/.hermes/skills/software-development/gastos-ledger-harness/
```

That copy is a future/manual packaging action. Do not perform it during ordinary repo authoring, worker validation, or CI. Source of truth remains this repository until a release process publishes the skill.

## Validation Checklist

Before marking a run as PASS:

- [ ] `SKILL.md` starts with frontmatter at byte 0.
- [ ] Frontmatter has `name`, `description`, `version`, `author`, `license`, and `metadata.hermes.tags`.
- [ ] Description is 1024 characters or fewer.
- [ ] The file is below 100,000 characters.
- [ ] Recipes cover `estado`, `preview`, `apply`, `readback`, and `drift`.
- [ ] Apply recipe requires `confirm=true`, selection, idempotency, audit reason, and readback.
- [ ] Secret preflight prints names and presence only.
- [ ] No real statement payload, token, cookie, API key, DB URL, or raw OCR content is included.
- [ ] Any production validation uses headed browser plus API/XLSX readback when in scope.

## Common Pitfalls

1. Treating a screenshot as proof. Screenshots can support UX review, but the truth oracle requires API readback and XLSX checks.
2. Using a direct database shortcut. This bypasses domain rules and invalidates the harness result.
3. Logging full statements. Use sanitized rows, hashes, counts, and selected ids in evidence.
4. Applying from preview without selection. Preview output must be reviewed; selected candidate ids are part of the safety contract.
5. Hiding missing card metadata. Closing date, due date, owner, payment method, currency, and installment state are first-class readback fields.
6. Reporting a token value during preflight. Only names and presence may be printed.

## One-Shot Recipes

### Read the Month

```yaml
recipe: estado
steps:
  - secret_preflight_names_only
  - get_ledger_snapshot
  - summarize_monthly_state
  - mark_evidence_redacted
pass_when:
  - all_required_sections_seen
  - no_mutation_performed
```

### Preview a Statement

```yaml
recipe: preview
steps:
  - normalize_to_candidates
  - post_reconciliation_preview
  - present_matches_duplicates_missing
  - wait_for_user_selection
pass_when:
  - preview_has_no_mutation
  - candidate_ids_are_stable
  - raw_payload_logged_false
```

### Apply Selected Missing Items

```yaml
recipe: apply
steps:
  - verify_preview_context
  - verify_confirm_true
  - verify_selected_candidate_ids
  - post_reconciliation_apply
  - get_ledger_readback
  - schedule_excel_and_xlsx_readback
pass_when:
  - created_or_idempotent_counts_match_selection
  - audit_id_present
  - readback_ready_for_excel
```

### Diagnose Monthly Drift

```yaml
recipe: drift
steps:
  - get_ledger_readback
  - inspect_excel_visible_state
  - export_and_read_xlsx
  - compare_by_stable_ids_and_totals
  - classify_drift_codes
pass_when:
  - drift_report_has_codes_or_explicit_no_drift
  - evidence_redacted
  - no_mutation_performed
```
