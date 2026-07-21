import test from "node:test";
import assert from "node:assert/strict";
import { retainStaleJobs, runSearchAgents, sourceKey, verifyAndEnrich } from "../agents.mjs";

const job = (overrides = {}) => ({
  id: "job-1",
  title: "Data Analyst",
  company: "Example",
  location: "San Francisco, CA",
  workplace: "Hybrid",
  pay: "Not listed",
  source: "Greenhouse",
  url: "https://example.com/jobs/1",
  posted: "2026-07-21",
  matched: [],
  description: "SQL and Tableau",
  ...overrides,
});

test("source agents scan independently and isolate failures", async () => {
  const sources = [
    { type: "greenhouse", slug: "good", name: "Good" },
    { type: "ashby", slug: "broken", name: "Broken" },
  ];
  const runs = await runSearchAgents(sources, async source => {
    if (source.slug === "broken") throw new Error("temporary failure");
    return [job()];
  });
  const greenhouse = runs.find(run => run.id === "greenhouse-agent");
  const ashby = runs.find(run => run.id === "ashby-agent");
  assert.equal(greenhouse.jobCount, 1);
  assert.equal(greenhouse.failureCount, 0);
  assert.equal(ashby.jobCount, 0);
  assert.equal(ashby.failureCount, 1);
  assert.match(ashby.failures[0], /temporary failure/);
  assert.deepEqual(ashby.failedSourceKeys, ["ashby:broken"]);
});

test("verification removes API-only records and merges tracked duplicates", () => {
  const result = verifyAndEnrich([
    job({ url: "https://example.com/jobs/1/?utm_source=test", description: "short" }),
    job({ url: "https://example.com/jobs/1", description: "a longer verified description", pay: "$80,000/yr" }),
    job({ id: "bad", source: "SmartRecruiters", url: "https://api.smartrecruiters.com/v1/companies/Test/postings/1" }),
  ]);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].url, "https://example.com/jobs/1");
  assert.equal(result.jobs[0].description, "a longer verified description");
  assert.equal(result.jobs[0].pay, "$80,000/yr");
  assert.equal(result.stats.duplicateCount, 1);
  assert.equal(result.stats.rejectedCount, 1);
});
test("malformed and unsupported sources are reported without cancelling good jobs", async () => {
  const sources = [
    { type: "greenhouse", slug: "good", name: "Good" },
    { type: "lever", slug: "malformed", name: "Malformed" },
    { type: "workday", url: "https://example.com/jobs", name: "Unsupported" },
  ];
  const runs = await runSearchAgents(sources, async source => source.slug === "malformed" ? undefined : [job()]);
  assert.equal(runs.find(run => run.id === "greenhouse-agent").jobCount, 1);
  assert.match(runs.find(run => run.id === "lever-agent").failures[0], /non-array/);
  assert.match(runs.find(run => run.id === "unsupported-agent").failures[0], /unsupported source type workday/);
});

test("verification preserves useful metadata and reports truncation", () => {
  const result = verifyAndEnrich([
    job({ location: "Seattle, WA", description: "short" }),
    job({ location: "Not listed", description: "a much longer description" }),
    job({ id: "job-2", title: "Z Business Analyst", url: "https://example.com/jobs/2" }),
  ], { maxJobs: 1 });
  assert.equal(result.jobs[0].location, "Seattle, WA");
  assert.equal(result.jobs[0].description, "a much longer description");
  assert.equal(result.stats.uniqueCount, 2);
  assert.equal(result.stats.publishedCount, 1);
  assert.equal(result.stats.truncatedCount, 1);
});

test("verification rejects ATS API endpoints", () => {
  const result = verifyAndEnrich([
    job({ url: "https://boards-api.greenhouse.io/v1/boards/test/jobs/1" }),
    job({ url: "https://api.ashbyhq.com/posting-api/job-board/test" }),
    job({ url: "https://api.lever.co/v0/postings/test" }),
  ]);
  assert.equal(result.jobs.length, 0);
  assert.equal(result.stats.rejectedCount, 3);
});

test("recent jobs from temporarily failed sources are retained as stale", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");
  const key = sourceKey({ type: "ashby", slug: "example" });
  const retained = retainStaleJobs([
    job({ sourceKey: key, verifiedAt: "2026-07-21T10:00:00.000Z" }),
    job({ id: "old", url: "https://example.com/jobs/old", sourceKey: key, verifiedAt: "2026-07-17T10:00:00.000Z" }),
    job({ id: "healthy", url: "https://example.com/jobs/healthy", sourceKey: "greenhouse:healthy", verifiedAt: "2026-07-21T10:00:00.000Z" }),
  ], [key], now);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].stale, true);
});
test("salary is extracted before long descriptions are shortened for the index", () => {
  const description = `${"background ".repeat(300)}The pay range for this role is $100,000 - $125,000 per year.`;
  const result = verifyAndEnrich([job({ pay: "Not listed", description })], { descriptionLimit: 1200 });
  assert.equal(result.jobs[0].pay, "$100,000–$125,000/yr");
  assert.equal(result.jobs[0].paySource, "Job description");
  assert.equal(result.jobs[0].description.length, 1200);
});