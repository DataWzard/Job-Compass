import test from "node:test";
import assert from "node:assert/strict";
import { cleanHtml, extractPay, extractPayFromHtml, formatPay, structuredPay } from "../compensation.mjs";

test("extracts the annual range shown in the 2K Greenhouse description", () => {
  const body = `The pay range for this position in California at the start of employment is expected to be between
    $100,000 - $125,000 per Year. However, base pay offered is based on market location.`;
  assert.equal(extractPay(body), "$100,000–$125,000/yr");
});

test("extracts encoded HTML, hourly ranges, and single annual salaries", () => {
  assert.equal(extractPay("&lt;p&gt;The salary range is $42.50–$58.75 per hour.&lt;/p&gt;"), "$42.50–$58.75/hr");
  assert.equal(extractPay("<p>The base salary is $95,000 annually.</p>"), "$95,000/yr");
  assert.equal(cleanHtml("&lt;strong&gt;Pay&lt;/strong&gt; &amp; benefits"), "Pay & benefits");
});

test("supports structured salary data and non-US currency", () => {
  assert.equal(structuredPay({ currency: "CAD", value: { minValue: 90000, maxValue: 110000, unitText: "YEAR" } }), "CA$90,000–CA$110,000/yr");
  assert.equal(formatPay(35, 45, "USD", "HOUR"), "$35–$45/hr");
});

test("does not mistake dates or a signing bonus for base pay", () => {
  assert.equal(extractPay("Founded in 2005. This role includes a $5,000 signing bonus and strong benefits."), "Not listed");
});
test("extracts compensation from ATS-specific HTML elements and classes", () => {
  assert.equal(
    extractPayFromHtml('<span class="compensationTierSummary_5yu8i_330">Base $80K - $110K · Offers Equity · Offers Bonus</span>'),
    "$80,000–$110,000",
  );
  assert.equal(
    extractPayFromHtml('<span class="compensationTierSummary_5yu8i_330">To be discussed $104K - $184K</span>'),
    "$104,000–$184,000",
  );
});

test("extracts an em pay paragraph and paired salary labels", () => {
  assert.equal(
    extractPayFromHtml('<em>The pay range for this position is expected to be between $100,000 - $125,000 per Year.</em>'),
    "$100,000–$125,000/yr",
  );
  const abbvie = '<li>Salary Min: <span class="salary-value" data-value="78500">78,500</span></li><li>Salary Max: <span class="salary-value" data-value="141000">141,000</span></li><li>Compensation: USD 78,500 - USD 141,000 - yearly</li>';
  assert.equal(extractPayFromHtml(abbvie), "$78,500–$141,000/yr");
});