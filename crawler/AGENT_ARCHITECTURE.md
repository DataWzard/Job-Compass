# Job Compass search agents

The hourly refresh uses specialized, deterministic agents so the public service can remain free:

- Source discovery agent: expands the known public ATS and career-page catalog.
- Greenhouse, Ashby, Lever, and SmartRecruiters agents: query each public ATS independently and concurrently.
- Career-page agent: reads public JobPosting metadata from iCIMS and company career pages.
- Verification and enrichment agent: rejects malformed/API-only links, removes tracking parameters, deduplicates postings, keeps the strongest metadata, and extracts compensation from structured fields or the full job-description body.
- Coordinator: merges every agent result into the static index consumed by GitHub Pages and Cloudflare.

These agents do not bypass login pages, CAPTCHA, robots restrictions, or access controls. They are source-specific workers rather than paid language-model calls.