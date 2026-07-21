import { readFile, writeFile } from "node:fs/promises";

const output = new URL("./discovered-sources.json", import.meta.url);
let existing = [];
try { existing = JSON.parse((await readFile(output, "utf8")).replace(/^\uFEFF/, "")); } catch {}
const definitions = [
  { type: "greenhouse", pattern: "boards.greenhouse.io/*", host: "boards.greenhouse.io" },
  { type: "greenhouse", pattern: "job-boards.greenhouse.io/*", host: "job-boards.greenhouse.io" },
  { type: "ashby", pattern: "jobs.ashbyhq.com/*", host: "jobs.ashbyhq.com" },
  { type: "lever", pattern: "jobs.lever.co/*", host: "jobs.lever.co" },
  { type: "smartrecruiters", pattern: "jobs.smartrecruiters.com/*", host: "jobs.smartrecruiters.com" },
  { type: "page", pattern: "*.icims.com/*", host: null },
  { type: "page", pattern: "apply.workable.com/*", host: null },
  { type: "page", pattern: "*.recruitee.com/*", host: null },
  { type: "page", pattern: "*.teamtailor.com/jobs/*", host: null }
];
function publicJobSeed(url) {
  const hostname = url.hostname.toLowerCase();
  const path = url.pathname;
  const accepted =
    (hostname !== "www.icims.com" && hostname.endsWith(".icims.com") && /^\/jobs\/\d+\/[^/]+\/job\/?$/i.test(path)) ||
    (hostname === "apply.workable.com" && /^\/[^/]+\/j\/[^/]+\/?$/i.test(path)) ||
    (hostname.endsWith(".recruitee.com") && /^\/o\/[^/]+\/?$/i.test(path)) ||
    (hostname.endsWith(".teamtailor.com") && /^\/jobs\/\d+(?:-[^/]+)?\/?$/i.test(path));
  if (!accepted) return null;
  url.protocol = "https:";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(source|ref|utm_)/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
const found = [];
try {
  const catalogs = await fetch("https://index.commoncrawl.org/collinfo.json").then(response => response.json());
  const endpoint = catalogs[0]["cdx-api"];
  for (const definition of definitions) {
    const query = new URL(endpoint);
    query.searchParams.set("url", definition.pattern);
    query.searchParams.set("output", "json");
    query.searchParams.append("filter", "status:200");
    query.searchParams.set("collapse", "urlkey");
    query.searchParams.set("pageSize", "1");
    query.searchParams.set("page", "0");
    const response = await fetch(query, { headers: { "user-agent": "JobCompassIndexer/1.0" } });
    if (!response.ok) continue;
    const rows = (await response.text()).split("\n").filter(Boolean);
    const slugs = new Set(); const pages = new Set();
    for (const row of rows) try {
      const value = JSON.parse(row); const url = new URL(value.url); const slug = url.pathname.split("/").filter(Boolean)[0];
      if (definition.type === "page") { const seed = publicJobSeed(url); if (seed) pages.add(seed); }
      else if (url.hostname === definition.host && slug && !/^(embed|search|api|assets|static|privacy|terms)$/i.test(slug)) slugs.add(slug);
      if (slugs.size + pages.size >= 250) break;
    } catch {}
    for (const slug of slugs) found.push({ type: definition.type, slug, name: slug });
    for (const url of pages) found.push({ type: "page", url, name: new URL(url).hostname });
  }
} catch (error) { console.warn(`Common Crawl discovery skipped: ${error.message}`); }
const merged = [...new Map([...existing, ...found].map(source => [`${source.type}:${source.slug || source.url}`, source])).values()].sort((a, b) => a.type.localeCompare(b.type) || (a.slug || a.url).localeCompare(b.slug || b.url));
await writeFile(output, JSON.stringify(merged, null, 2) + "\n");
console.log(`Source catalog contains ${merged.length} discovered ATS boards.`);