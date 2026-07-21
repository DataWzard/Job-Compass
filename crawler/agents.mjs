export const SEARCH_AGENTS = [
  { id: "greenhouse-agent", label: "Greenhouse", types: ["greenhouse"], concurrency: 12 },
  { id: "ashby-agent", label: "Ashby", types: ["ashby"], concurrency: 12 },
  { id: "lever-agent", label: "Lever", types: ["lever"], concurrency: 10 },
  { id: "smartrecruiters-agent", label: "SmartRecruiters", types: ["smartrecruiters"], concurrency: 10 },
  { id: "career-page-agent", label: "Career pages and iCIMS", types: ["page"], concurrency: 6 },
];

export const sourceKey = source => `${source.type}:${source.slug || source.url || ""}`.toLowerCase();

export function retainStaleJobs(previousJobs, failedSourceKeys, now = Date.now(), maxAgeMs = 72 * 60 * 60 * 1000) {
  const failed = new Set(failedSourceKeys);
  return previousJobs.filter(job => {
    if (!job.sourceKey || !failed.has(job.sourceKey)) return false;
    const verifiedAt = new Date(job.verifiedAt || 0).valueOf();
    return Number.isFinite(verifiedAt) && now - verifiedAt <= maxAgeMs;
  }).map(job => ({ ...job, stale: true }));
}
export async function runSearchAgents(sources, scanSource) {
  const runs = await Promise.all(SEARCH_AGENTS.map(async agent => {
    const assigned = sources.filter(source => agent.types.includes(source.type));
    const jobs = [];
    const failures = [];
    const failedSourceKeys = [];
    const startedAt = Date.now();
    for (let start = 0; start < assigned.length; start += agent.concurrency) {
      const batch = await Promise.all(assigned.slice(start, start + agent.concurrency).map(async source => {
        try {
          const result = await scanSource(source);
          if (!Array.isArray(result)) throw new Error("scanner returned a non-array result");
          return result;
        } catch (error) {
          failures.push(`${source.name || source.slug || source.url}: ${error.message}`);
          failedSourceKeys.push(sourceKey(source));
          return [];
        }
      }));
      for (const result of batch) jobs.push(...result);
    }
    return {
      id: agent.id,
      label: agent.label,
      sourceCount: assigned.length,
      jobCount: jobs.length,
      failureCount: failures.length,
      durationMs: Date.now() - startedAt,
      jobs,
      failures,
      failedSourceKeys,
    };
  }));
  const activeRuns = runs.filter(run => run.sourceCount > 0);
  const supportedTypes = new Set(SEARCH_AGENTS.flatMap(agent => agent.types));
  const unsupported = sources.filter(source => !supportedTypes.has(source.type));
  if (unsupported.length) activeRuns.push({
    id: "unsupported-agent",
    label: "Unsupported sources",
    sourceCount: unsupported.length,
    jobCount: 0,
    failureCount: unsupported.length,
    durationMs: 0,
    jobs: [],
    failures: unsupported.map(source => `${source.name || source.slug || source.url || source.type}: unsupported source type ${source.type}`),
    failedSourceKeys: unsupported.map(sourceKey),
  });
  return activeRuns;
}

const trackingParameters = new Set(["gh_jid", "gh_src", "lever-source", "source", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term"]);

function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = "";
  for (const parameter of [...url.searchParams.keys()]) if (trackingParameters.has(parameter.toLowerCase())) url.searchParams.delete(parameter);
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

const meaningful = value => value && !["Not listed", "Date not listed", "Unknown"].includes(value);

function prefer(current, incoming) {
  const description = (incoming.description || "").length > (current.description || "").length ? incoming.description : current.description;
  return {
    ...current,
    ...incoming,
    description,
    location: meaningful(current.location) ? current.location : incoming.location,
    pay: meaningful(current.pay) ? current.pay : incoming.pay,
    posted: meaningful(current.posted) ? current.posted : incoming.posted,
    workplace: meaningful(current.workplace) ? current.workplace : incoming.workplace,
    matched: [...new Set([...(current.matched || []), ...(incoming.matched || [])])],
  };
}

export function verifyAndEnrich(jobs, { maxJobs = 12000, descriptionLimit = 1200 } = {}) {
  const verified = new Map();
  let rejectedCount = 0;
  let duplicateCount = 0;
  const apiHosts = new Set(["api.smartrecruiters.com", "boards-api.greenhouse.io", "api.ashbyhq.com", "api.lever.co"]);
  for (const input of jobs) {
    try {
      const title = String(input.title || "").trim();
      const company = String(input.company || "").trim();
      const url = canonicalUrl(String(input.url || ""));
      const parsed = new URL(url);
      if (!title || !company || !["http:", "https:"].includes(parsed.protocol) || apiHosts.has(parsed.hostname)) throw new Error("invalid public job record");
      const job = {
        ...input,
        title,
        company,
        url,
        location: String(input.location || "Not listed").trim() || "Not listed",
        description: String(input.description || "").slice(0, descriptionLimit),
      };
      if (verified.has(url)) {
        duplicateCount += 1;
        verified.set(url, prefer(verified.get(url), job));
      } else verified.set(url, job);
    } catch {
      rejectedCount += 1;
    }
  }
  const unique = [...verified.values()].sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  const output = unique.slice(0, maxJobs);
  return { jobs: output, stats: { inputCount: jobs.length, uniqueCount: unique.length, publishedCount: output.length, verifiedCount: output.length, truncatedCount: unique.length - output.length, duplicateCount, rejectedCount } };
}