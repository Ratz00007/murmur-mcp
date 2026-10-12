/**
 * Stage 7 — interaction: two-phase grounded dialogue with the simulated world.
 *
 * `interview_agent` and `report_agent_ask` are the same protocol against two
 * evidence sources: without `answer` they return a grounded pack for you to
 * answer from, with `answer` they log the exchange. `target` picks the source
 * (one persona's own memory and posts, or the whole run's evidence pack).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildAskPack, buildInterviewPack, qaEntry } from "@murmur/engine";
import type { ServerContext } from "../session.js";
import { INTERACT_OUTPUT } from "./outputs.js";

export const INTERACT_TOOL_NAMES = ["interact"] as const;

export function registerInteractTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "interact",
    {
      title: "Interview a persona / interrogate the run",
      description:
        "Talk to the simulated world after (or during) a run. target:'persona' returns one persona's grounded pack — " +
        "their card, their own posts, their episodic memory — so you can answer in character and have them decline what " +
        "they never saw. target:'run' returns the evidence pack for the whole simulation, so you can drill into any claim " +
        "in the report. Both are two-phase: call without `answer` to get the pack, answer from it, then call again with " +
        "`answer` to log the exchange into the world directory.",
      inputSchema: {
        target: z.enum(["persona", "run"]).describe("Ask one persona, or the whole run"),
        persona: z.string().optional().describe("Persona id or handle (e.g. p_3 or @ada) — required for target:'persona'"),
        question: z.string().min(3).max(1000).describe("Your question"),
        answer: z.string().max(6000).optional().describe("Your answer — provide it to log the exchange"),
        world: z.string().optional().describe("World id/slug (default: active world)"),
      },
      outputSchema: INTERACT_OUTPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ target, persona, question, answer, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        if (target === "persona" && !persona) {
          // Ask the user which persona they mean instead of failing outright —
          // but only when the client supports elicitation. Most do not, and
          // the plain error below is the universal path.
          if (ctx.elicit) {
            const got = await ctx.elicit(
              "Which persona should answer in character?",
              { persona: { title: "Persona", description: "Persona id or handle (e.g. p_3 or @ada) — see personas({action:'plan'}) output for the population" } }
            );
            const named = typeof got?.persona === "string" ? got.persona.trim() : "";
            if (named) {
              persona = named;
            }
          }
          if (!persona) {
            throw new Error("target:'persona' needs persona (id or handle) — use target:'run' to ask the simulation as a whole");
          }
        }
        if (answer && answer.trim()) {
          if (target === "persona" && persona) {
            const { persona: p } = buildInterviewPack(ctx.storage, w, persona, question);
            const file = ctx.workspace.interviewsPath(w.slug);
            ctx.workspace.appendJsonl(file, qaEntry(question, answer.trim(), { persona: p.id, name: p.name }));
            ctx.audit(w, { op: "interview_log", persona: p.id });
            return ctx.reply(
              {
                ok: true,
                logged: true,
                persona: p.name,
                file: ctx.workspace.rel(file),
                next: "ask another question (omit `answer` for a fresh pack), or switch target to 'run'",
              },
              w,
              INTERACT_OUTPUT
            );
          }
          const file = ctx.workspace.qaPath(w.slug);
          ctx.workspace.appendJsonl(file, qaEntry(question, answer.trim()));
          ctx.audit(w, { op: "ask_log" });
          return ctx.reply(
            { ok: true, logged: true, file: ctx.workspace.rel(file), next: "ask another question, or wrap up" },
            w,
            INTERACT_OUTPUT
          );
        }
        if (target === "persona" && persona) {
          const { persona: p, pack } = buildInterviewPack(ctx.storage, w, persona, question);
          ctx.audit(w, { op: "interview_pack", persona: p.id });
          return ctx.reply(
            {
              ok: true,
              logged: false,
              persona: p.name,
              how: "Answer the question AS this persona using only the pack (cite their own post ids; decline what they don't recall). Then call interact again with target:'persona' + persona + question + your answer to log it.",
              pack,
              next: "interact({target:'persona', persona, question, answer})",
            },
            w,
            INTERACT_OUTPUT
          );
        }
        const pack = buildAskPack(ctx.storage, w, question);
        ctx.audit(w, { op: "ask_pack" });
        return ctx.reply(
          {
            ok: true,
            logged: false,
            how: "Answer using ONLY the evidence pack, citing post ids like (po_12). Distinguish strong from weak evidence. Then call interact again with target:'run' + question + your answer to log it.",
            pack,
            next: "interact({target:'run', question, answer})",
          },
          w,
          INTERACT_OUTPUT
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}
