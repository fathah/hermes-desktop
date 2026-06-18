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

## Evals

Run the deterministic Mac Expert eval suite with:

```bash
node scripts/local-experts-eval.mjs
```

The offline suite checks required record coverage, required concepts, forbidden
unsafe phrases, expected risk framing, and conservative recipe safety language.
Live model evals remain opt-in and are not part of the default runner.

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

Add future packs, such as Excel Expert, PowerPoint Expert, or Cooking Expert, by
creating another built-in `LocalExpertPack` and adding it to the pack registry in
`src/main/local-experts/index.ts`, or by importing a validated local JSON pack.

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
