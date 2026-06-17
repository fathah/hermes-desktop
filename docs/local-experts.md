# Local Experts

Local Experts are profile-local, source-backed specialist packs for SPS. A pack
installs curated markdown records into the user's vault, creates a review-first
Assistant Recipe, and creates the profile skill that My Assistant uses for the
workflow.

V1 is guidance-only. Local Experts do not run diagnostics, change settings,
install software, delete files, scrape webpages, or write to external services.

## Pack Shape

Pack definitions live in code and use `LocalExpertPack` from
`src/shared/local-experts.ts`.

Each pack includes:

- stable `id`, `domain`, `title`, `version`, and `description`
- allowed `sourceTiers`
- a recipe definition used to create the Assistant Recipe
- records with symptoms, steps, verification, risk, source URLs, tags, version
  scope, and `lastVerified`

Installed state is stored per profile at:

```text
<profileHome>/sps-agent/local-experts.json
```

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

## Mac Expert V1

The built-in Mac Expert pack uses id `macos`. It covers a starter set for:

- privacy permissions
- FileVault and Gatekeeper
- macOS updates and security releases
- login/background items
- Finder default apps
- Wi-Fi, DNS, VPN triage
- developer signing, sandbox, entitlements, and notarization
- Time Machine backups

The generated recipe is review-first and workspace-grounded. It may guide the
user through steps and verification, but it must not claim a setting is enabled
unless the user or a cited record provides evidence.

## Adding Future Experts

Add future packs, such as Excel Expert, PowerPoint Expert, or Cooking Expert, by
creating another built-in `LocalExpertPack` and adding it to the pack registry in
`src/main/local-experts/index.ts`.

Do not add new product code for each expert unless the domain needs a new
capability tier. The default path is:

1. curate structured records
2. validate the pack
3. install records into the vault
4. create a review-first Assistant Recipe
5. rely on existing vault grounding

If a future expert needs local checks or remediation, add that as a separate
capability tier with explicit review and capability-risk handling.
