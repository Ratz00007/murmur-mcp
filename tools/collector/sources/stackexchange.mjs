/**
 * Stack Exchange source — Stack Overflow via api.stackexchange.com 2.3.
 *
 * Flow: search/advanced?order=desc&sort=activity&q=&site=stackoverflow&filter=withbody
 * then /questions/<ids>/answers?filter=withbody (ids joined with ';', one
 * request covers the whole batch). Optional env STACKEXCHANGE_KEY raises the
 * daily quota. Bodies are HTML -> decoded to plain text.
 *
 * Pairing: the search response stashes question candidates; the answers
 * response emits one thread per question that has answers. Questions without
 * answers are emitted by collect() as single-post threads (the question
 * itself), never by parse() — so replay order does not change output.
 */
import { fetchJsonOrText } from "../http.mjs";
import { htmlToText, isoFrom, threadFrom } from "./_shared.mjs";

const id = "stackexchange";
const BASE = "https://api.stackexchange.com/2.3";
const SITE = "stackoverflow";

function authParams() {
  return process.env.STACKEXCHANGE_KEY ? `&key=${encodeURIComponent(process.env.STACKEXCHANGE_KEY)}` : "";
}

export function buildStackExchangeThread(question, answers, ctx) {
  if (!question?.question_id) return [];
  const rootId = `q${question.question_id}`;
  const posts = [
    {
      postId: rootId,
      author: question.owner?.display_name || "unknown",
      text: htmlToText(question.body || question.title || ""),
      timestamp: isoFrom(question.creation_date),
      score: Number(question.score) || 0,
    },
  ];
  for (const a of answers) {
    posts.push({
      postId: `a${a.answer_id}`,
      parentId: rootId,
      author: a.owner?.display_name || "unknown",
      text: htmlToText(a.body || ""),
      timestamp: isoFrom(a.creation_date),
      score: Number(a.score) || 0,
    });
  }
  return [
    threadFrom({
      platform: "stackexchange",
      via: "stackexchange",
      threadId: String(question.question_id),
      title: htmlToText(question.title) || "(untitled)",
      author: question.owner?.display_name || "unknown",
      url: question.link || "",
      timestamp: isoFrom(question.creation_date),
      metrics: {
        upvotes: Number(question.score) || 0,
        comments: Number(question.answer_count) || answers.length,
      },
      posts,
      ctx,
    }),
  ];
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  if (url.includes("/answers")) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    const byQuestion = new Map();
    for (const a of data?.items || []) {
      const qid = a.question_id;
      if (!qid) continue;
      if (!byQuestion.has(qid)) byQuestion.set(qid, []);
      byQuestion.get(qid).push(a);
    }
    const threads = [];
    for (const [qid, answers] of byQuestion) {
      const question = ctx.state.seCandidates?.get(String(qid));
      if (question) threads.push(...buildStackExchangeThread(question, answers, ctx));
    }
    return threads;
  }
  if (url.includes("/search/advanced")) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    ctx.state.seCandidates = ctx.state.seCandidates || new Map();
    for (const item of data?.items || []) {
      if (item?.question_id) ctx.state.seCandidates.set(String(item.question_id), item);
    }
    return [];
  }
  return [];
}

export async function collect({ query, limit = 10, state = {} } = {}) {
  const threads = [];
  if (!query) return threads;
  const searchUrl =
    `${BASE}/search/advanced?order=desc&sort=activity&q=${encodeURIComponent(query)}` +
    `&site=${SITE}&filter=withbody&pagesize=${limit}${authParams()}`;
  const searchRes = await fetchJsonOrText(searchUrl);
  const searchCtx = { url: searchUrl, retrievedAt: searchRes.retrievedAt, sha256: searchRes.sha256, query, limit, state, via: id };
  parse(searchRes.body, searchCtx);
  const candidates = [...(state.seCandidates?.values() || [])].filter((q) => (Number(q.answer_count) || 0) > 0);
  const ids = candidates.map((q) => q.question_id);
  if (ids.length) {
    const answersUrl =
      `${BASE}/questions/${ids.join(";")}/answers?order=desc&sort=votes&site=${SITE}` +
      `&filter=withbody&pagesize=100${authParams()}`;
    const res = await fetchJsonOrText(answersUrl);
    const answersCtx = { url: answersUrl, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    threads.push(...parse(res.body, answersCtx));
  }
  // Questions whose answers never arrived (none or fetch failure): emit the
  // question itself as a single-post thread so no live data is silently lost.
  const emitted = new Set(threads.map((t) => t.threadId));
  for (const q of candidates) {
    if (!emitted.has(String(q.question_id))) {
      threads.push(...buildStackExchangeThread(q, [], { ...searchCtx }));
    }
  }
  return threads;
}

export default { id, parse, collect };
