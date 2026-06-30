# Research Reach

Research Reach lets SPS detect local open-source source tools and use them to broaden My Assistant's coverage for research and learning.

It can help with:

- Web pages and RSS
- Public webpage extraction through optional Crawl4AI CLI setup
- GitHub repositories, issues, and profiles
- YouTube metadata and transcripts
- Reddit, Twitter/X, and other social sources when a working login-backed backend is configured

Research Reach is not a production scraping system. Platform access can break, rate-limit, or require login state. SPS always treats fetched web content as untrusted and refuses to save research briefs that do not include real sources.

## Sources Flow

Open the SPS RSS reader and use **Sources** for source intake.

- Find: public Substack discovery stays in Substack Radar.
- Add URL: public Substack and RSS URLs are resolved through feed discovery; other public HTTPS pages use Crawl4AI when it is installed and healthy.
- Review: extracted source text is previewed before it is saved to the Knowledge Base.
- Study sources: turn a saved source set into either a study summary or a Curated Brief.

## Curated Brief

Curated Brief is a review-first research mode for source sets, research prompts, and Content Studio ideas. It asks for multiple perspectives, source-guided questions, an evidence ledger, an outline, a cited brief, concept links, open questions, and sources.

SPS requires real source URLs before filing a Curated Brief into the Knowledge Base. Unsupported claims must remain visible as evidence gaps, so the brief can guide review and drafting without pretending to be publication-ready.

Curated Brief is available from:

- **Sources / Study**: generate from a source corpus, then save to the Knowledge Base, Content Studio, or Deck Studio.
- **Research**: choose Curated brief as a research mode and file or hand off the result.
- **Content Studio**: generate a brief from a captured idea, source URLs, audience, and angle before scoring or drafting.

Crawl4AI is optional. SPS does not bundle it, silently install it, start its Docker API server, import cookies, reuse a logged-in browser profile, configure proxies, or enable hooks. If Crawl4AI is unavailable, generic public URLs fall back to the existing safe link preview path.

## Setup

Open Settings -> Application Health -> Source Coverage.

Use:

- Check status: inspect available channels.
- Setup: see safe install commands.
- Preview setup: ask Agent-Reach what is needed without making system changes.
- Import skill: let My Assistant learn Agent-Reach routing commands after review.

The status labels are intentionally conservative:

- Ready: My Assistant may try this source during a research turn.
- Needs setup: the source needs user-managed login, auth, MCP, or backend setup before it should be relied on.
- Unavailable/error: the source must not be claimed in a saved brief unless a later tool call actually succeeds.

Ready does not make a brief publishable by itself. SPS still requires fetched source URLs before saving research into the Knowledge Base.

Optional Crawl4AI setup:

```bash
pipx install crawl4ai
crawl4ai-setup
crawl4ai-doctor
```

SPS does not silently import cookies, install global packages, or enable MCP servers.

## Attribution Note

Crawl4AI's license file includes Apache 2.0 terms plus an additional attribution requirement for distributions, publications, public uses, derivative works, websites, and command-line tools. Before bundling Crawl4AI or advertising it as an included dependency, add the required NOTICE/About/Credits attribution and run a legal/compliance review.
