# Job Compass

Job Compass is an Indeed-style search workspace for public company career pages and applicant-tracking systems. Add source URLs, filter by titles and keywords, review normalized job details, add notes, and export the shortlist as CSV.

## What the first version supports

- Structured public feeds for Greenhouse, Ashby, Lever, and SmartRecruiters
- Best-effort JSON-LD and HTML reading for company career pages and iCIMS pages
- Title, body keyword, location, exclusion, and remote-only filters
- Normalized location, workplace type, pay range, source, posting date, and job URL
- Per-job notes, selection, in-page filtering, and CSV export
- Clear warnings for blocked or unsupported sources

LinkedIn search pages are intentionally not scraped. They usually require authentication and enforce bot protections. Use LinkedIn as a discovery/link source, or add an approved data provider later.

## Run locally

Requirements: Node.js 22.13 or newer and pnpm.

```text
pnpm install
pnpm dev
```

Open the local address shown in the terminal.

## Hosting

The interface can live on GitHub Pages, but the scanning endpoint cannot: GitHub Pages only hosts static files. For a public deployment, host the full app on a serverless platform such as Cloudflare Workers/Pages, or host the interface on GitHub Pages and point it to a separately hosted API.

## Wider-net roadmap

The next ingestion layer should follow this order:

1. Official ATS APIs and public feeds.
2. `sitemap.xml`, RSS/Atom feeds, and schema.org `JobPosting` JSON-LD.
3. A scored URL frontier that prioritizes likely job links before fetching full pages.
4. Conditional requests using ETags and `Last-Modified` for recurring scans.
5. A small database for scan history, deduplication, saved searches, and change alerts.

This gives broader coverage without brute-force crawling every page.
