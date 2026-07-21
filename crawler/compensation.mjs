export const PAY_NOT_LISTED = "Not listed";

const entities = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"], ["#39", "'"], ["nbsp", " "],
]);

export function decodeHtml(value = "") {
  let text = String(value);
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      const key = entity.toLowerCase();
      if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      return entities.get(key) ?? match;
    });
  }
  return text;
}

export function cleanHtml(value = "") {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const amountValue = value => {
  const compact = String(value).replace(/,/g, "").trim();
  const match = compact.match(/^(\d+(?:\.\d+)?)\s*([km])?$/i);
  if (!match) return null;
  const multiplier = match[2]?.toLowerCase() === "k" ? 1000 : match[2]?.toLowerCase() === "m" ? 1000000 : 1;
  return Number(match[1]) * multiplier;
};

const currencyCode = token => {
  const value = String(token || "$").toUpperCase().replace(/\s+/g, "");
  if (value === "£" || value === "GBP") return "GBP";
  if (value === "€" || value === "EUR") return "EUR";
  if (value === "CA$" || value === "C$" || value === "CAD") return "CAD";
  return "USD";
};

const currencyPrefix = currency => ({ USD: "$", CAD: "CA$", EUR: "€", GBP: "£" }[currency] || `${currency} `);

const normalizeUnit = value => {
  const unit = String(value || "").toLowerCase();
  if (/hour|hourly|\bhr\b/.test(unit)) return "hr";
  if (/day|daily/.test(unit)) return "day";
  if (/week|weekly/.test(unit)) return "wk";
  if (/month|monthly/.test(unit)) return "mo";
  if (/year|annual|annum|yearly|\byr\b/.test(unit)) return "yr";
  return "";
};

export function formatPay(min, max = min, currency = "USD", unit = "") {
  const low = Number(min);
  const high = Number(max ?? min);
  if (!Number.isFinite(low) || low <= 0) return PAY_NOT_LISTED;
  const prefix = currencyPrefix(currencyCode(currency));
  const money = number => {
    const digits = Number(number) % 1 ? 2 : 0;
    return `${prefix}${Number(number).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
  };
  const range = Number.isFinite(high) && high > 0 && high !== low ? `${money(low)}–${money(high)}` : money(low);
  const normalizedUnit = normalizeUnit(unit);
  return normalizedUnit ? `${range}/${normalizedUnit}` : range;
}

const currencyToken = String.raw`(?:USD\s*|US\$\s*|CAD\s*|CA\$\s*|C\$\s*|EUR\s*|GBP\s*|[$€£]\s*)`;
const amountToken = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?(?:\s*[kKmM])?)`;
const rangePattern = new RegExp(`(${currencyToken})${amountToken}\\s*(?:-|–|—|to|through|and)\\s*(${currencyToken})?${amountToken}`, "gi");
const singlePattern = new RegExp(String.raw`(?:base\s+salary|salary|pay\s+range|compensation|starting\s+(?:pay|salary)|hiring\s+range)[^$€£\d]{0,80}(${currencyToken})${amountToken}`, "gi");
const contextPattern = /salary|pay|compensation|base|wage|range|annual|annum|yearly|hourly|per\s+(?:year|hour|month|week|day)/i;
const bonusOnlyPattern = /(?:signing|annual|performance|target)\s+bonus/i;

function unitNear(text, start, end) {
  const afterRange = normalizeUnit(text.slice(end, Math.min(text.length, end + 120)));
  if (afterRange) return afterRange;
  return normalizeUnit(text.slice(Math.max(0, start - 80), start));
}

const salaryElementPattern = /<([a-z][\w:-]*)\b([^>]*(?:salary|compensation|pay|wage|remuneration)[^>]*)>([\s\S]*?)<\/\1>/gi;
const plainAmountPattern = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?(?:\s*[kKmM])?)/;

function pairedSalary(text) {
  const minimum = text.match(new RegExp(`salary\\s*(?:min|minimum)[^\\d$€£]{0,80}${plainAmountPattern.source}`, "i"));
  const maximum = text.match(new RegExp(`salary\\s*(?:max|maximum)[^\\d$€£]{0,80}${plainAmountPattern.source}`, "i"));
  if (!minimum || !maximum) return PAY_NOT_LISTED;
  const min = amountValue(minimum[1]);
  const max = amountValue(maximum[1]);
  if (!min || !max || max < min) return PAY_NOT_LISTED;
  const salaryContext = text.slice(minimum.index, Math.min(text.length, maximum.index + maximum[0].length + 160));
  const currency = currencyCode(salaryContext.match(/USD|US\$|CAD|CA\$|C\$|EUR|GBP|[$€£]/i)?.[0]);
  return formatPay(min, max, currency, salaryContext);
}

export function extractPayFromHtml(value = "") {
  const raw = decodeHtml(value);
  const visible = cleanHtml(raw);
  for (const match of raw.matchAll(salaryElementPattern)) {
    const candidate = `compensation ${match[2]} ${cleanHtml(match[3])}`;
    const pay = extractPay(candidate);
    if (pay !== PAY_NOT_LISTED) return pay;
  }
  const direct = extractPay(visible);
  if (direct !== PAY_NOT_LISTED) return direct;
  return pairedSalary(visible);
}
export function extractPay(value = "") {
  const text = cleanHtml(value);
  for (const match of text.matchAll(rangePattern)) {
    const context = text.slice(Math.max(0, match.index - 160), Math.min(text.length, match.index + match[0].length + 160));
    if (!contextPattern.test(context) || (bonusOnlyPattern.test(context) && !/salary|base\s+pay|pay\s+range/i.test(context))) continue;
    const min = amountValue(match[2]);
    const max = amountValue(match[4]);
    if (!min || !max || max < min) continue;
    return formatPay(min, max, currencyCode(match[1] || match[3]), unitNear(text, match.index, match.index + match[0].length));
  }
  for (const match of text.matchAll(singlePattern)) {
    const amount = amountValue(match[2]);
    if (!amount) continue;
    return formatPay(amount, amount, currencyCode(match[1]), unitNear(text, match.index, match.index + match[0].length));
  }
  return PAY_NOT_LISTED;
}

export function structuredPay(value, fallbackText = "") {
  if (!value) return extractPayFromHtml(fallbackText);
  const salary = value.value ?? value;
  const min = typeof salary === "number" ? salary : salary?.minValue ?? salary?.value;
  const max = typeof salary === "number" ? salary : salary?.maxValue ?? min;
  const formatted = formatPay(min, max, value.currency || salary?.currency || "USD", salary?.unitText || value.unitText || "");
  return formatted === PAY_NOT_LISTED ? extractPayFromHtml(fallbackText) : formatted;
}
