import { readFile, mkdir, writeFile } from "node:fs/promises";

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
const clean = (html = "") => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
const workplace = (value = "") => /hybrid/i.test(value) ? "Hybrid" : /remote|work from home|distributed/i.test(value) ? "Remote" : /on[- ]?site|in office/i.test(value) ? "On-site" : "Unknown";
const dateLabel = (value) => { const date = new Date(value || ""); return Number.isNaN(date.valueOf()) ? "Date not listed" : date.toISOString().slice(0, 10); };
const payLabel = (min, max, currency = "USD", unit = "year") => min || max ? `${currency === "USD" ? "$" : `${currency} `}${Number(min || max).toLocaleString()}${max && max !== min ? `-$${Number(max).toLocaleString()}` : ""}/${String(unit).replace("HOUR", "hr").replace("YEAR", "yr").toLowerCase()}` : "Not listed";
async function json(url) { const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "JobCompassIndexer/1.0" }, signal: AbortSignal.timeout(timeout) }); if (!response.ok) throw new Error(`${response.status} ${url}`); return response.json(); }
async function greenhouse(source) { const data = await json(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.slug)}/jobs?content=true`); return (data.jobs || []).map(job => { const description = clean(job.content || ""); const location = job.location?.name || "Not listed"; return { id: `greenhouse-${job.id}`, title: job.title, company: data.name || source.name, location, workplace: workplace(`${location} ${description.slice(0, 1000)}`), pay: "Not listed", source: "Greenhouse", url: job.absolute_url, posted: dateLabel(job.updated_at), matched: [], description }; }); }
async function ashby(source) { const data = await json(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.slug)}`); return (data.jobs || []).map(job => { const description = clean(job.descriptionHtml || job.descriptionPlain || ""); const location = job.location || "Not listed"; return { id: `ashby-${job.id || job.jobUrl}`, title: job.title, company: data.organizationName || source.name, location, workplace: workplace(`${job.workplaceType || ""} ${location}`), pay: job.compensation?.compensationTierSummary || "Not listed", source: "Ashby", url: job.jobUrl || job.applyUrl, posted: dateLabel(job.publishedAt), matched: [], description }; }); }
async function lever(source) { const data = await json(`https://api.lever.co/v0/postings/${encodeURIComponent(source.slug)}?mode=json`); return data.map(job => { const description = clean([job.descriptionPlain, job.additionalPlain, job.lists?.map(item => item.content).join(" ")].filter(Boolean).join(" ")); const location = job.categories?.location || "Not listed"; return { id: `lever-${job.id}`, title: job.text, company: source.name, location, workplace: workplace(`${job.workplaceType || ""} ${location}`), pay: job.salaryRange ? payLabel(job.salaryRange.min, job.salaryRange.max, job.salaryRange.currency, job.salaryRange.interval) : "Not listed", source: "Lever", url: job.hostedUrl || job.applyUrl, posted: "Date not listed", matched: [], description }; }); }
async function smartrecruiters(source) { const data = await json(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.slug)}/postings?limit=100`); return (data.content || []).map(job => { const location = [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(", ") || "Not listed"; return { id: `smartrecruiters-${job.id}`, title: job.name, company: job.company?.name || source.name, location, workplace: workplace(`${job.location?.remote ? "remote" : ""} ${job.name}`), pay: "Not listed", source: "SmartRecruiters", url: job.ref || `https://jobs.smartrecruiters.com/${source.slug}/${job.id}`, posted: dateLabel(job.releasedDate), matched: [], description: "" }; }); }
function parseJobMarkup(markup, source, pageUrl) {
  const jobs = [];
  for (const match of markup.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) try {
    const parsed = JSON.parse(match[1].replace(/<!--|-->/g, "")); const nodes = (Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed]).flat();
    for (const item of nodes) if (item?.["@type"] === "JobPosting") {
      const place = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation; const address = place?.address || {};
      const location = item.jobLocationType === "TELECOMMUTE" ? "Remote" : [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(", ") || "Not listed";
      const salary = item.baseSalary?.value || item.estimatedSalary?.value || {}; const description = clean(item.description || ""); const company = clean(item.hiringOrganization?.name || source.name);
      jobs.push({ id: `page-${item.identifier?.value || item.identifier || item.url || jobs.length}`, title: clean(item.title || "Untitled role"), company, location, workplace: workplace(`${location} ${description.slice(0, 1000)}`), pay: payLabel(salary.minValue, salary.maxValue, item.baseSalary?.currency || "USD", salary.unitText || "year"), source: new URL(pageUrl).hostname.includes("icims") ? "iCIMS" : "Career page", url: item.url || pageUrl, posted: dateLabel(item.datePosted), matched: [], description });
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
const jobs = [], failures = [];
const concurrency = 12;
for (let start = 0; start < sources.length; start += concurrency) {
  const batch = await Promise.all(sources.slice(start, start + concurrency).map(async source => {
    try {
      const scanner = scanners[source.type];
      if (!scanner) throw new Error(`Unsupported source type ${source.type}`);
      return await scanner(source);
    } catch (error) {
      failures.push(`${source.name}: ${error.message}`);
      return [];
    }
  }));
  for (const result of batch) jobs.push(...result);
}
const unique = [...new Map(jobs.filter(job => job.url).map(job => [job.url, { ...job, description: (job.description || "").slice(0, 1200) }])).values()].sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title)).slice(0, 12000);
const payload = JSON.stringify({ updatedAt: new Date().toISOString(), refreshCadence: "hourly", sourceCount: sources.length, jobCount: unique.length, failures, jobs: unique }, null, 2) + "\n";
for (const directory of ["docs/data", "job-compass-cloudflare-ready/public/data"]) { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/jobs.json`, payload); }
console.log(`Indexed ${unique.length} jobs from ${sources.length} public ATS boards.`);
if (failures.length) console.warn(failures.join("\n"));
