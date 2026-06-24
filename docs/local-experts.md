# Local Experts

Local Experts are profile-local, source-backed specialist packs for SPS. A pack
installs curated markdown records into the user's vault, creates a review-first
Assistant Recipe, and creates the profile skill that My Assistant uses for the
workflow.

The default expert experience is guidance-only. Local Experts do not change
settings, install software, delete files, scrape webpages, or write to external
services. Optional local checks are a separate reviewed capability tier.

## Pack Shape

Pack definitions use `LocalExpertPack` from `src/shared/local-experts.ts`.
Built-in packs live in code. Imported packs live under
`<profileHome>/sps-agent/local-expert-packs/`.

Each pack includes:

- stable `id`, `domain`, `title`, `version`, and `description`
- allowed `sourceTiers`
- a recipe definition used to create the Assistant Recipe
- records with symptoms, steps, verification, risk, source URLs, tags, version
  scope, `lastVerified`, optional freshness policy, common questions, safety
  caveats, related records, and authority notes
- optional scenarios with a title, workflow prompt, linked records, required
  user-visible evidence, expected answer sections, and risk

Installed state is stored per profile at:

```text
<profileHome>/sps-agent/local-experts.json
```

Install state includes provenance: pack version, record count, source count,
overview path, records path, recipe ID, skill path, and pack hash.

Installed records are written to the profile vault:

```text
vault/expert-<packId>.md
vault/expert_<packId>/<recordId>.md
```

## Source Tiers

Use the narrowest reliable source tier for each record:

- `apple_official`: Apple user, deployment, security, or support docs
- `google_workspace_official`: Google Workspace, Drive, Docs, Sheets, Slides,
  or Google Help documentation
- `google_developer_official`: Google Developers documentation for Workspace
  automation surfaces such as Apps Script
- `microsoft_365_official`: Microsoft Support, Microsoft 365, SharePoint,
  OneDrive, Excel, and Office documentation
- `microsoft_developer_official`: Microsoft Learn documentation for Microsoft
  365 developer surfaces such as Excel VBA or Office automation APIs
- `developer_official`: Apple Developer documentation
- `standards_project`: structured compliance or baseline projects
- `mac_admin`: reputable admin-practice sources
- `community_reference`: useful secondary explainers, never sole authority for
  high-risk advice

All source URLs must be HTTPS. Do not paste webpages wholesale into records.
Summarize into deterministic records with source links and `lastVerified`.
Freshness is calculated locally from `lastVerified` and `freshnessDays`; SPS
flags records as current, stale, expired, or unknown without fetching or
rewriting sources.

## Mac Expert V1

The built-in Mac Expert pack uses id `macos`. It covers a starter set for:

- privacy permissions
- FileVault and Gatekeeper
- macOS updates and security releases
- login/background items
- storage pressure
- Finder default apps
- Wi-Fi, DNS, VPN triage
- Keychain and Passwords orientation
- developer signing, sandbox, entitlements, and notarization
- Time Machine backups

The generated recipe is review-first and workspace-grounded. It may guide the
user through steps and verification, but it must not claim a setting is enabled
unless the user or a cited record provides evidence.

## Google Docs Editors Expert V1

The built-in Google Docs Editors Expert pack uses id `google-docs-editors`. It
covers a starter set for Google Workspace office collaboration:

- Drive sharing with specific people, groups, and roles
- restricted vs broader link sharing risk
- stopping or limiting file sharing
- Docs comments, suggestions, and collaboration basics
- Sheets formulas, functions, sharing, and macros
- Slides deck creation, presentation, and sharing
- Apps Script planning, authorization awareness, and quota limits
- Workspace admin policy boundaries for external sharing, app authorization,
  Apps Script access, and Marketplace app allowlists

The generated recipe is review-first and guidance-only. It must not access
Gmail, Drive, Docs, Sheets, Slides, Apps Script, credentials, or Workspace admin
APIs; it may only explain source-backed steps and tell the user what evidence to
check or ask their Workspace admin to confirm. Scenario records should favor
real office questions, such as blocked client access, accidental broad sharing,
macro authorization, Apps Script quota failures, and review-only Slides access.

Google scenarios are structured workflow prompts layered over records. They are
read-only in SPS: the UI shows the prompt, required evidence, risk, and linked
records, but does not open Google, run Apps Script, copy data, or call admin
APIs.

## Excel Expert V1

The built-in Excel Expert pack uses id `excel`. It covers a starter set for
Microsoft Excel and Microsoft 365 workbook work:

- coauthoring requirements for OneDrive, OneDrive for Business, and SharePoint
- SharePoint and OneDrive sharing policy boundaries
- formulas, functions, cell references, and external references
- tables and data validation for controlled entry
- CSV import, text import, Power Query, and data type preservation
- PivotTable source-data review
- chart creation and Office chart data embedded in Word or PowerPoint
- workbook recovery and repair-warning triage
- broken embedded chart and linked workbook triage
- gridline, formatting, print, and Freeze Panes readability cleanup
- worksheet order, sheet-tab, and Move/Copy Sheet cleanup
- file, workbook, and worksheet protection plus password risk
- macro security, Trust Center awareness, and managed-device boundaries
- recorded macro and VBA object model review

The generated recipe is review-first and guidance-only. It must not open Excel
files, inspect OneDrive or SharePoint, request credentials, call Microsoft
Graph, run Office Scripts, run VBA/macros, change sharing, or change
tenant/admin policy. It may only explain source-backed checks and tell the user
what evidence to inspect or ask a Microsoft 365 admin to confirm.

Excel scenarios are structured workflow prompts layered over records. They are
read-only in SPS: the UI shows the prompt, required evidence, risk, and linked
records, but does not open files, parse workbook contents, run automation, or
contact Microsoft services.
Workbook triage records are checklists only: they can point the user to
source-backed Excel recovery, chart, readability, and worksheet-order evidence,
but they do not repair files, recover data, execute macros, or verify workbook
contents.

## Evals

Run the deterministic local expert eval suite with:

```bash
node scripts/local-experts-eval.mjs
```

The offline suite checks required record coverage, required concepts, forbidden
unsafe phrases, expected risk framing, and conservative recipe safety language
for built-in packs. Google Docs Editors and Excel evals also include
deterministic answer-shape fixtures that require `What to check`, `Steps`,
`Verification`, `Risk`, and `Sources` sections without calling a live model.
The default runner also installs the Google Docs Editors Expert and Excel Expert
offline, verifies scenario records, and proves the assistant recipe prompt/run
path with mocked local services. Live model evals remain opt-in and are not part
of the default runner.

The quality report helper summarizes record count, unique source count, scenario
count, stale/expired record counts, broken scenario links, and validation error
count. It is deterministic and does not fetch sources.

## Import And Export

Experts can be exported as local JSON envelopes with `schemaVersion`, exported
time, pack hash, and pack payload. Imported packs are previewed and validated
before install. Built-in ID conflicts are rejected. There is no network
marketplace in this phase.

## Read-Only Mac Checks

Mac Expert can optionally enable a separate "Check my Mac" evidence tier. It
does not run on install. When enabled, SPS records a capability-risk report and
can run only fixed read-only commands through `execFile` with no shell, no sudo,
and timeouts:

- `/usr/bin/sw_vers -productVersion`
- `/usr/bin/fdesetup status`
- `/usr/sbin/spctl --status`
- `/usr/bin/defaults read /Library/Preferences/com.apple.alf globalstate`
- `/usr/bin/tmutil destinationinfo`

Results are evidence only. They do not remediate, modify settings, delete files,
install software, or prove a setting is enabled unless the check succeeded.

## Adding Future Experts

Add future packs, such as PowerPoint Expert, Word Expert, or Cooking Expert, by
creating another built-in `LocalExpertPack` and adding it to the pack registry
in `src/main/local-experts/index.ts`, or by importing a validated local JSON
pack.

Do not add new product code for each expert unless the domain needs a new
capability tier. The default path is:

1. curate structured records
2. validate the pack
3. add deterministic eval cases for core topics
4. install records into the vault
5. create a review-first Assistant Recipe
6. rely on existing vault grounding

If a future expert needs local checks or remediation, add that as a separate
capability tier with explicit review and capability-risk handling.
