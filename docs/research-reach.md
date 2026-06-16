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

Crawl4AI is optional. SPS does not bundle it, silently install it, start its Docker API server, import cookies, reuse a logged-in browser profile, configure proxies, or enable hooks. If Crawl4AI is unavailable, generic public URLs fall back to the existing safe link preview path.

## Setup

Open Settings -> Application Health -> Research Reach.

Use:

- Check status: inspect available channels.
- Show setup: see safe install commands.
- Run safe setup: ask Agent-Reach what is needed without making system changes.
- Import skill: let My Assistant learn Agent-Reach routing commands after review.

Optional Crawl4AI setup:

```bash
pipx install crawl4ai
crawl4ai-setup
crawl4ai-doctor
```

SPS does not silently import cookies, install global packages, or enable MCP servers.

## Attribution Note

Crawl4AI's license file includes Apache 2.0 terms plus an additional attribution requirement for distributions, publications, public uses, derivative works, websites, and command-line tools. Before bundling Crawl4AI or advertising it as an included dependency, add the required NOTICE/About/Credits attribution and run a legal/compliance review.
