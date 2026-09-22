/** Deep-interaction tools: interview_agent, report_agent_ask (F7). Two-phase: without `answer` they return a grounded pack for you to answer from; with `answer` they log the exchange. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildAskPack, buildInterviewPack, qaEntry } from "@murmur/engine";
import type { ServerContext } from "../session.js";

export function registerInteractTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "interview_agent",
    "Talk to any simulated persona after (or during) a run. Returns their grounded pack (card, own posts, episodic memory) — answer the question in " +
      "character, then call again with `answer` to log the dialogue into the world directory.",
    {
      persona: z.string().describe("Persona id or handle (e.g. p_3 or @ada)"),
      question: z.string().min(3).max(1000).describe("Your question"),
      answer: z.string().max(4000).optional().describe("Your in-character answer — provide to log the exchange"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ persona, question, answer, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        if (answer && answer.trim()) {
          const { persona: p } = buildInterviewPack(ctx.storage, w, persona, question);
          ctx.workspace.appendJsonl(ctx.workspace.interviewsPath(w.slug), qaEntry(question, answer.trim(), { persona: p.id, name: p.name }));
          ctx.audit(w, { op: "interview_log", persona: p.id });
          return ctx.reply(
            { ok: true, logged: true, persona: p.name, file: ctx.workspace.rel(ctx.workspace.interviewsPath(w.slug)), next: "ask another question (no answer → new pack), or report_agent_ask" },
            w
          );
        }
        const { persona: p, pack } = buildInterviewPack(ctx.storage, w, persona, question);
        ctx.audit(w, { op: "interview_pack", persona: p.id });
        return ctx.reply(
          {
            ok: true,
            logged: false,
            persona: p.name,
            how: "Answer the question AS this persona using only the pack (cite your own post ids; decline what you don't recall). Then call interview_agent again with persona + question + your answer to log it.",
            pack,
            next: "interview_agent(persona, question, answer)",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "report_agent_ask",
    "Interrogate the whole simulation: retrieves the posts and statistics behind a question. Answer with citations (po_ids), then call again with " +
      "`answer` to log the exchange. Use it to drill into any claim in the report ('show me the posts behind this risk').",
    {
      question: z.string().min(3).max(1000).describe("Your question about the run"),
      answer: z.string().max(6000).optional().describe("Your cited answer — provide to log the exchange"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ question, answer, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        if (answer && answer.trim()) {
          ctx.workspace.appendJsonl(ctx.workspace.qaPath(w.slug), qaEntry(question, answer.trim()));
          ctx.audit(w, { op: "ask_log" });
          return ctx.reply(
            { ok: true, logged: true, file: ctx.workspace.rel(ctx.workspace.qaPath(w.slug)), next: "ask another question, or wrap up" },
            w
          );
        }
        const pack = buildAskPack(ctx.storage, w, question);
        ctx.audit(w, { op: "ask_pack" });
        return ctx.reply(
          {
            ok: true,
            logged: false,
            how: "Answer using ONLY the evidence pack, citing post ids like (po_12). Distinguish strong from weak evidence. Then call report_agent_ask again with question + your answer to log it.",
            pack,
            next: "report_agent_ask(question, answer)",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}
