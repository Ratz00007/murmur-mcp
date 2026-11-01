/**
 * robots.txt gate: group parsing, agent selection, longest-match-wins with
 * Allow preference on ties, wildcards and $ anchors; plus Retry-After math.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";

import { parseRobots, robotsAllows, retryAfterMs } from "../http.mjs";

const SAMPLE = `
# generic crawlers
User-agent: *
Disallow: /private
Disallow: /search
Allow: /search/open
Crawl-delay: 5

User-agent: ResearchBot
Disallow:
`;

test("parses groups, comments and blank-line breaks", () => {
  const groups = parseRobots(SAMPLE);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].agents, ["*"]);
  assert.equal(groups[0].rules.length, 3);
  assert.deepEqual(groups[1].agents, ["researchbot"]);
});

test("longest match wins; Allow wins ties; empty Disallow is a no-op", () => {
  const groups = parseRobots(SAMPLE);
  assert.ok(robotsAllows(groups, "murmur-collector", "/private/thing"), "deep path under /private");
  assert.ok(robotsAllows(groups, "murmur-collector", "/search?q=x"), "plain /search blocked");
  assert.equal(robotsAllows(groups, "murmur-collector", "/search/open/page"), null, "longer Allow beats Disallow");
  assert.equal(robotsAllows(groups, "murmur-collector", "/"), null, "unmatched paths are allowed");
  assert.equal(robotsAllows(groups, "ResearchBot", "/private/anything"), null, "empty Disallow group allows all");
});

test("wildcards and $ anchors behave like the robots spec", () => {
  const groups = parseRobots(`
User-agent: *
Disallow: /*.pdf$
Allow: /docs/*.pdf
`);
  assert.ok(robotsAllows(groups, "bot", "/x/y.pdf"), "wildcard + $ blocks pdfs outside /docs");
  assert.equal(robotsAllows(groups, "bot", "/docs/a.pdf"), null, "longer Allow wins");
  assert.equal(robotsAllows(groups, "bot", "/docs/a.pdf?download"), null, "$ anchor excludes query strings from the block");
  assert.equal(robotsAllows(groups, "bot", "/x/y.PDF"), null, "path matching is case-sensitive, so .PDF is not blocked");
});

test("agent token selection: exact group beats the * fallback", () => {
  const groups = parseRobots(`
User-agent: *
Disallow: /

User-agent: GoodBot
Disallow: /only-this
`);
  assert.ok(robotsAllows(groups, "OtherBot", "/anything"), "* group blocks everything for others");
  assert.equal(robotsAllows(groups, "GoodBot", "/elsewhere"), null, "exact group replaces the * group");
  assert.ok(robotsAllows(groups, "GoodBot", "/only-this/x"));
});

test("retryAfterMs honours seconds, HTTP dates and falls back to backoff", () => {
  const header = (v) => ({ get: () => v });
  assert.equal(retryAfterMs(header("3"), 0), 3000);
  const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
  const ms = retryAfterMs(header(inTenSeconds), 0);
  assert.ok(ms > 5_000 && ms <= 10_000, `date-based retry-after should be ~10000ms, got ${ms}`);
  const fallback = retryAfterMs(header(null), 2);
  assert.ok(fallback >= 4000, `default backoff 1s*2^2 >= 4s, got ${fallback}`);
  assert.ok(retryAfterMs(header("9999"), 0) <= 30_000, "Retry-After is capped");
});
