import { NextResponse } from "next/server";

type Workplace = "Remote" | "Hybrid" | "On-site" | "Unknown";
type Job = { id:string; title:string; company:string; location:string; workplace:Workplace; pay:string; source:string; url:string; posted:string; matched:string[]; description:string };
type Filters = { titles:string[]; keywords:string[]; locations:string[]; exclude:string[]; remoteOnly:boolean };

const splitTerms = (value: unknown) => String(value || "").split(",").map((term) => term.trim()).filter(Boolean);
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g," ").trim();
const cleanCompany = (value:string) => value.replace(/[-_|].*?(careers|jobs).*$/i,"").replace(/\b(careers|jobs)\b/gi,"").trim() || "Company";
const sourceName = (host:string) => host.includes("greenhouse") ? "Greenhouse" : host.includes("ashbyhq") ? "Ashby" : host.includes("lever.co") ? "Lever" : host.includes("smartrecruiters") ? "SmartRecruiters" : host.includes("icims") ? "iCIMS" : "Career page";
const workplace = (value:string):Workplace => /hybrid/i.test(value) ? "Hybrid" : /remote|work from home|distributed/i.test(value) ? "Remote" : /on[- ]?site|in office/i.test(value) ? "On-site" : "Unknown";
const dateLabel = (value?:string) => { if (!value) return "Date not listed"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); };
const payLabel = (min?:number|string,max?:number|string,currency="USD",unit="year") => min || max ? `${currency === "USD" ? "$" : `${currency} `}${Number(min || max).toLocaleString()}${max && max !== min ? `–$${Number(max).toLocaleString()}` : ""}/${unit.replace("HOUR","hr").replace("YEAR","yr").toLowerCase()}` : "Not listed";

function safeUrl(raw:string) {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:") throw new Error("Only secure public URLs are accepted.");
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error("Private network URLs are not accepted.");
  return url;
}

async function getJson(url:string) { const res = await fetch(url,{headers:{accept:"application/json","user-agent":"JobCompass/1.0 (+public-job-discovery)"},signal:AbortSignal.timeout(12000)}); if(!res.ok) throw new Error(`Source returned ${res.status}`); return res.json(); }
async function getHtml(url:string) { const res = await fetch(url,{headers:{accept:"text/html","user-agent":"JobCompass/1.0 (+public-job-discovery)"},redirect:"follow",signal:AbortSignal.timeout(12000)}); if(!res.ok) throw new Error(`Source returned ${res.status}`); const type=res.headers.get("content-type")||""; if(!type.includes("html")) throw new Error("Source did not return a web page"); return res.text(); }

function fromJsonLd(html:string,url:string,source:string):Job[] {
  const jobs:Job[]=[]; const blocks=[...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) try {
    const parsed=JSON.parse(block[1].replace(/<!--|-->/g,"")); const nodes=(Array.isArray(parsed)?parsed:parsed?.["@graph"]||[parsed]).flat();
    for(const node of nodes) if(node?.["@type"]==="JobPosting") {
      const loc=Array.isArray(node.jobLocation)?node.jobLocation[0]:node.jobLocation; const address=loc?.address||{}; const location=node.jobLocationType==="TELECOMMUTE"?"Remote":[address.addressLocality,address.addressRegion,address.addressCountry].filter(Boolean).join(", ")||"Not listed";
      const salary=node.baseSalary?.value||node.estimatedSalary?.value||{}; const description=text(node.description||"");
      jobs.push({id:String(node.identifier?.value||node.identifier||node.url||`${url}-${jobs.length}`),title:text(node.title||"Untitled role"),company:text(node.hiringOrganization?.name||cleanCompany(new URL(url).hostname.split(".")[0])),location,workplace:workplace(`${location} ${description.slice(0,1000)}`),pay:payLabel(salary.minValue,salary.maxValue,node.baseSalary?.currency||"USD",salary.unitText||"year"),source,url:node.url||url,posted:dateLabel(node.datePosted),matched:[],description});
    }
  } catch { /* malformed third-party JSON-LD is skipped */ }
  return jobs;
}

async function scanGreenhouse(url:URL):Promise<Job[]> { const parts=url.pathname.split("/").filter(Boolean); const board=parts[0]; if(!board) throw new Error("Greenhouse company slug is missing"); const data=await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`); return (data.jobs||[]).map((j:any)=>({id:String(j.id),title:j.title,company:cleanCompany(data.name||board),location:j.location?.name||"Not listed",workplace:workplace(`${j.location?.name||""} ${text(j.content||"").slice(0,1000)}`),pay:"Not listed",source:"Greenhouse",url:j.absolute_url,posted:dateLabel(j.updated_at),matched:[],description:text(j.content||"")})); }
async function scanLever(url:URL):Promise<Job[]> { const company=url.pathname.split("/").filter(Boolean)[0]; if(!company) throw new Error("Lever company slug is missing"); const data=await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`); return (data||[]).map((j:any)=>({id:String(j.id),title:j.text,company:cleanCompany(company),location:j.categories?.location||"Not listed",workplace:workplace(`${j.workplaceType||""} ${j.categories?.location||""}`),pay:j.salaryRange?payLabel(j.salaryRange.min,j.salaryRange.max,j.salaryRange.currency||"USD",j.salaryRange.interval||"year"):"Not listed",source:"Lever",url:j.hostedUrl||j.applyUrl,posted:"Date not listed",matched:[],description:text([j.descriptionPlain,j.additionalPlain,j.lists?.map((x:any)=>x.content).join(" ")].filter(Boolean).join(" "))})); }
async function scanAshby(url:URL):Promise<Job[]> { const company=url.pathname.split("/").filter(Boolean)[0]; if(!company) throw new Error("Ashby company slug is missing"); const data=await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}`); return (data.jobs||[]).map((j:any)=>({id:String(j.id||j.jobUrl),title:j.title,company:cleanCompany(data.organizationName||company),location:j.location||"Not listed",workplace:workplace(`${j.workplaceType||""} ${j.location||""}`),pay:j.compensation?.compensationTierSummary||"Not listed",source:"Ashby",url:j.jobUrl||j.applyUrl,posted:dateLabel(j.publishedAt),matched:[],description:text(j.descriptionHtml||j.descriptionPlain||"")})); }
async function scanSmartRecruiters(url:URL):Promise<Job[]> { const company=url.pathname.split("/").filter(Boolean)[0]; if(!company) throw new Error("SmartRecruiters company slug is missing"); const data=await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`); return (data.content||[]).map((j:any)=>({id:String(j.id),title:j.name,company:cleanCompany(j.company?.name||company),location:[j.location?.city,j.location?.region,j.location?.country].filter(Boolean).join(", ")||"Not listed",workplace:workplace(`${j.location?.remote?"remote":""} ${j.name}`),pay:"Not listed",source:"SmartRecruiters",url:j.ref||`https://jobs.smartrecruiters.com/${company}/${j.id}`,posted:dateLabel(j.releasedDate),matched:[],description:""})); }

async function scanGeneric(url:URL):Promise<Job[]> {
  const html=await getHtml(url.href); const direct=fromJsonLd(html,url.href,sourceName(url.hostname)); if(direct.length) return direct;
  const title=text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||""); const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m)=>({href:m[1],label:text(m[2])}));
  const candidates:URL[]=[]; for(const link of links) try { const next=new URL(link.href,url); if(next.origin===url.origin && /job|career|opening|position|vacanc/i.test(`${next.pathname} ${link.label}`) && next.href!==url.href && !candidates.some(x=>x.href===next.href)) candidates.push(next); } catch {}
  const jobs:Job[]=[]; for(const candidate of candidates.slice(0,12)) try { const page=await getHtml(candidate.href); const parsed=fromJsonLd(page,candidate.href,sourceName(url.hostname)); if(parsed.length) jobs.push(...parsed); else { const h1=text(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||""); const body=text(page); if(h1 && /apply|responsibilit|qualification|job description/i.test(body)) jobs.push({id:candidate.href,title:h1,company:cleanCompany(title||url.hostname.split(".")[0]),location:"Not listed",workplace:workplace(body.slice(0,4000)),pay:"Not listed",source:sourceName(url.hostname),url:candidate.href,posted:"Date not listed",matched:[],description:body}); } } catch {}
  return jobs;
}

function filterJobs(jobs:Job[],f:Filters) { return jobs.map((job)=>{ const hay=`${job.title} ${job.description} ${job.location} ${job.url}`.toLowerCase(); const titleHit=!f.titles.length||f.titles.some(t=>job.title.toLowerCase().includes(t.toLowerCase())); const matched=[...f.titles,...f.keywords].filter((term,index,all)=>hay.includes(term.toLowerCase())&&all.indexOf(term)===index); return {...job,matched}; }).filter((job)=>{ const hay=`${job.title} ${job.description} ${job.location}`.toLowerCase(); return (!f.titles.length||f.titles.some(t=>job.title.toLowerCase().includes(t.toLowerCase()))) && (!f.keywords.length||f.keywords.some(k=>hay.includes(k.toLowerCase()))) && (!f.locations.length||f.locations.some(l=>job.location.toLowerCase().includes(l.toLowerCase())||(l.toLowerCase()==="remote"&&job.workplace==="Remote"))) && !f.exclude.some(e=>hay.includes(e.toLowerCase())) && (!f.remoteOnly||job.workplace==="Remote"); }); }

export async function POST(request:Request) {
  try {
    const body=await request.json(); const rawSources=String(body.sources||"").split(/\r?\n/).map((s)=>s.trim()).filter(Boolean).slice(0,10); if(!rawSources.length) return NextResponse.json({error:"Add at least one public career page URL."},{status:400});
    const filters:Filters={titles:splitTerms(body.titles),keywords:splitTerms(body.keywords),locations:splitTerms(body.locations),exclude:splitTerms(body.exclude),remoteOnly:Boolean(body.remoteOnly)}; const all:Job[]=[]; const warnings:string[]=[];
    for(const raw of rawSources) try { const url=safeUrl(raw); if(url.hostname.includes("linkedin.com")) { warnings.push("LinkedIn search pages require an approved data source or manual links and were skipped."); continue; } const jobs=url.hostname.includes("greenhouse.io")?await scanGreenhouse(url):url.hostname.includes("lever.co")?await scanLever(url):url.hostname.includes("ashbyhq.com")?await scanAshby(url):url.hostname.includes("smartrecruiters.com")?await scanSmartRecruiters(url):await scanGeneric(url); all.push(...jobs); } catch(error) { warnings.push(`${raw}: ${error instanceof Error?error.message:"Could not read source"}`); }
    const deduped=[...new Map(all.map(j=>[j.url,j])).values()]; const jobs=filterJobs(deduped,filters).slice(0,250); const note=warnings.length?` ${warnings.length} source${warnings.length===1?"":"s"} returned a warning.`:""; return NextResponse.json({jobs,message:`Found ${jobs.length} matching job${jobs.length===1?"":"s"} across ${rawSources.length} source${rawSources.length===1?"":"s"}.${note}`,warnings});
  } catch { return NextResponse.json({error:"The request could not be read."},{status:400}); }
}
