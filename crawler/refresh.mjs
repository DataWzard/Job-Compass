import { readFile, mkdir, writeFile } from "node:fs/promises";
import { retainStaleJobs, runSearchAgents, sourceKey, verifyAndEnrich } from "./agents.mjs";
import { cleanHtml, extractPayFromHtml, formatPay, structuredPay } from "./compensation.mjs";

const seedSources = JSON.parse((await readFile(new URL("./sources.json", import.meta.url), "utf8")).replace(/^\uFEFF/, ""));
let discoveredSources = [];
try { discoveredSources = JSON.parse((await readFile(new URL("./discovered-sources.json", import.meta.url), "utf8")).replace(/^\uFEFF/, "")); } catch {}
const allSources = [...new Map([...seedSources, ...discoveredSources].map(source => [`${source.type}:${source.slug || source.url}`, source])).values()];
const sourceTypes = ["greenhouse", "ashby", "lever", "smartrecruiters", "page"];
const buckets = Object.fromEntries(sourceTypes.map(type => [type, allSources.filter(source => source.type === type)]));
const sources = [];
for (let index = 0; sources.length < 1000 && sourceTypes.some(type => buckets[type][index]); index++) {
  for (const type of sourceTypes) if (buckets[type][index] && sources.length < 1000) sources.push(buckets[type][index]);
}
const timeout = 15000;
const clean = cleanHtml;
const workplace = (value = "") => /hybrid/i.test(value) ? "Hybrid" : /remote|work from home|distributed/i.test(value) ? "Remote" : /on[- ]?site|in office/i.test(value) ? "On-site" : "Unknown";
const dateLabel = (value) => { const date = new Date(value || ""); return Number.isNaN(date.valueOf()) ? "Date not listed" : date.toISOString().slice(0, 10); };
const payLabel = (min, max, currency = "USD", unit = "year") => formatPay(min || max, max || min, currency, unit);
async function json(url) { const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "JobCompassIndexer/1.0" }, signal: AbortSignal.timeout(timeout) }); if (!response.ok) throw new Error(`${response.status} ${url}`); return response.json(); }
async function mapLimit(items, limit, mapper) {
  const output = [];
  for (let start = 0; start < items.length; start += limit) output.push(...await Promise.all(items.slice(start, start + limit).map(mapper)));
  return output;
}
function sectionText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(sectionText).join(" ");
  if (typeof value === "object") return Object.values(value).map(sectionText).join(" ");
  return "";
}
async function greenhouse(source) { const data = await json(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.slug)}/jobs?content=true`); return (data.jobs || []).map(job => { const rawDescription = job.content || ""; const description = clean(rawDescription); const location = job.location?.name || "Not listed"; return { id: `greenhouse-${job.id}`, title: job.title, company: data.name || source.name, location, workplace: workplace(`${location} ${description.slice(0, 1000)}`), pay: extractPayFromHtml(rawDescription), paySource: "Job HTML", source: "Greenhouse", url: job.absolute_url, posted: dateLabel(job.updated_at), matched: [], description }; }); }
async function ashby(source) { const data = await json(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.slug)}?includeCompensation=true`); return (data.jobs || []).map(job => { const description = clean(job.descriptionHtml || job.descriptionPlain || ""); const location = job.location || "Not listed"; return { id: `ashby-${job.id || job.jobUrl}`, title: job.title, company: data.organizationName || source.name, location, workplace: workplace(`${job.workplaceType || ""} ${location}`), pay: job.compensation?.scrapeableCompensationSalarySummary || job.compensation?.compensationTierSummary || "Not listed", source: "Ashby", url: job.jobUrl || job.applyUrl, posted: dateLabel(job.publishedAt), matched: [], description }; }); }
async function lever(source) { const data = await json(`https://api.lever.co/v0/postings/${encodeURIComponent(source.slug)}?mode=json`); return data.map(job => { const description = clean([job.descriptionPlain, job.additionalPlain, job.lists?.map(item => item.content).join(" ")].filter(Boolean).join(" ")); const location = job.categories?.location || "Not listed"; return { id: `lever-${job.id}`, title: job.text, company: source.name, location, workplace: workplace(`${job.workplaceType || ""} ${location}`), pay: job.salaryRange ? payLabel(job.salaryRange.min, job.salaryRange.max, job.salaryRange.currency, job.salaryRange.interval) : "Not listed", source: "Lever", url: job.hostedUrl || job.applyUrl, posted: "Date not listed", matched: [], description }; }); }
async function smartrecruiters(source) {
  const companyId = encodeURIComponent(source.slug);
  const data = await json(`https://api.smartrecruiters.com/v1/companies/${companyId}/postings?limit=100`);
  const details = await mapLimit(data.content || [], 6, async summary => {
    try {
      return await json(`https://api.smartrecruiters.com/v1/companies/${companyId}/postings/${encodeURIComponent(summary.id)}`);
    } catch {
      return summary;
    }
  });
  return details.map(job => {
    const location = [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(", ") || "Not listed";
    const description = clean(sectionText(job));
    const slug = clean(job.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return { id: `smartrecruiters-${job.id}`, title: job.name, company: job.company?.name || source.name, location, workplace: workplace(`${job.location?.remote ? "remote" : ""} ${job.name} ${description.slice(0, 1000)}`), pay: "Not listed", source: "SmartRecruiters", url: `https://jobs.smartrecruiters.com/${source.slug}/${job.id}-${slug}`, posted: dateLabel(job.releasedDate), matched: [], description };
  });
}
function parseJobMarkup(markup, source, pageUrl) {
  const jobs = [];
  for (const match of markup.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) try {
    const parsed = JSON.parse(match[1].replace(/<!--|-->/g, "")); const nodes = (Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed]).flat();
    for (const item of nodes) if ((Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]]).includes("JobPosting")) {
      const place = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation; const address = place?.address || {};
      const location = item.jobLocationType === "TELECOMMUTE" ? "Remote" : [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(", ") || "Not listed";
      const salary = item.baseSalary || item.estimatedSalary; const rawDescription = String(item.description || ""); const description = clean(rawDescription); const company = clean(item.hiringOrganization?.name || source.name);
      jobs.push({ id: `page-${item.identifier?.value || item.identifier || item.url || jobs.length}`, title: clean(item.title || "Untitled role"), company, location, workplace: workplace(`${location} ${description.slice(0, 1000)}`), pay: structuredPay(salary, rawDescription), source: new URL(pageUrl).hostname.includes("icims") ? "iCIMS" : "Career page", url: item.url ? new URL(item.url, pageUrl).href : pageUrl, posted: dateLabel(item.datePosted), matched: [], description });
    }
  } catch {}
  return jobs;
}
async function page(source) {
  const fetchPage = async url => { const response = await fetch(url, { headers: { accept: "text/html", "user-agent": "JobCompassIndexer/1.0" }, redirect: "follow", signal: AbortSignal.timeout(timeout) }); if (!response.ok) throw new Error(`${response.status} ${url}`); return response.text(); };
  const markup = await fetchPage(source.url); const direct = parseJobMarkup(markup, source, source.url); if (direct.length) return direct;
  const links = new Set();
  for (const match of markup.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) try { const url = new URL(match[1], source.url); if (url.origin === new URL(source.url).origin && /job|career|opening|position|vacanc/i.test(url.pathname)) links.add(url.href); } catch {}
  const jobs = [];
  for (const url of [...links].slice(0, 12)) try { jobs.push(...parseJobMarkup(await fetchPage(url), source, url)); } catch {}
  return jobs;
}
const scanners = { greenhouse, ashby, lever, smartrecruiters, page };
const refreshedAt = new Date().toISOString();
let previousJobs = [];
try {
  const previous = JSON.parse((await readFile(new URL("../docs/data/jobs.json", import.meta.url), "utf8")).replace(/^\uFEFF/, ""));
  previousJobs = Array.isArray(previous.jobs) ? previous.jobs : [];
} catch {}
const agentRuns = await runSearchAgents(sources, async source => {
  const scanner = scanners[source.type];
  if (!scanner) throw new Error(`Unsupported source type ${source.type}`);
  const jobs = await scanner(source);
  return jobs.map(job => ({
    ...job,
    sourceKey: sourceKey(source),
    verifiedAt: refreshedAt,
    lastSeenAt: refreshedAt,
    stale: false,
  }));
});
const failures = agentRuns.flatMap(run => run.failures);
const failedSourceKeys = agentRuns.flatMap(run => run.failedSourceKeys);
const freshVerification = verifyAndEnrich(agentRuns.flatMap(run => run.jobs), { maxJobs: 12000, descriptionLimit: 1200 });
const retained = retainStaleJobs(previousJobs, failedSourceKeys, Date.parse(refreshedAt));
const mergedVerification = verifyAndEnrich([...freshVerification.jobs, ...retained], { maxJobs: 12000, descriptionLimit: 1200 });
const unique = mergedVerification.jobs;
const agents = agentRuns.map(({ jobs, failures: agentFailures, failedSourceKeys: agentFailedSourceKeys, ...stats }) => stats);
const salaryFoundCount = unique.filter(job => job.pay && job.pay !== "Not listed").length;
const verification = {
  ...freshVerification.stats,
  publishedCount: unique.length,
  retainedStaleCount: retained.length,
  salaryFoundCount,
  salaryFromDescriptionCount: unique.filter(job => job.paySource === "Job description").length,
  salaryCoveragePercent: unique.length ? Math.round((salaryFoundCount / unique.length) * 1000) / 10 : 0,
};
const payload = JSON.stringify({ updatedAt: refreshedAt, refreshCadence: "hourly", mode: "parallel-source-agents", sourceCount: sources.length, jobCount: unique.length, agents, verification, failures, jobs: unique }, null, 2) + "\n";
for (const directory of ["docs/data", "job-compass-cloudflare-ready/public/data"]) {
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/jobs.json`, payload);
}
console.log(`Indexed ${unique.length} jobs from ${sources.length} public ATS boards.`);
if (failures.length) console.warn(failures.join("\n"));
