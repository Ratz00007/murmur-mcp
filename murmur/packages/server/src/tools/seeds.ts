/**
 * Seed ingestion: seed_add (files | url | text) and seeds_review.
 *
 * The three adders were one tool wearing three names. The engine never
 * fetches anything, so `seed_add_url` was `seed_add_text` with a URL in the
 * provenance slot, and `seed_add_files` was the filesystem reader in front of
 * the same `addSeed` call. They differ only in where the bytes come from, which
 * is a `source` discriminator, not a tool.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  coverageStats,
  extractPdfText,
  makeDigest,
  MAX_SEED_BYTES,
  getHistoricalCase,
  listHistoricalCases,
  getDiscourseAdapter,
  validateDiscourseThread,
  type DiscourseThread,
  type Seed,
} from "@murmur/engine";
import type { ServerContext } from "../session.js";
import { SEEDS_REVIEW_OUTPUT, SEED_ADD_OUTPUT } from "./outputs.js";

export const SEED_TOOL_NAMES = ["seed_add", "seeds_review"] as const;

const TEXTUAL = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".csv",
  ".json",
  ".yml",
  ".yaml",
  ".log",
]);

class WorkspacePathError extends Error {}

/**
 * Containment check. Two levels, because string containment alone is not
 * enough: a symlink *inside* the workspace can point outside it, so the real
 * path of the nearest existing ancestor is checked as well.
 *
 * The nearest *existing* ancestor is used because the target may not exist
 * yet, and `realpathSync` throws ENOENT in that case. Walking up to the first
 * existing segment still catches a symlinked parent directory, which is the
 * escape that matters.
 */
function assertInsideWorkspace(
  input: string,
  root: string,
  candidate: string,
): void {
  const rel = path.relative(root, candidate);
  if (
    rel &&
    (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
  ) {
    throw new WorkspacePathError(
      `path "${input}" resolves outside workspace "${root}" (${candidate}); absolute paths outside the workspace are not allowed — use a workspace-relative path`,
    );
  }
}

function realpathOfNearestExisting(target: string): string {
  const tail: string[] = [];
  let current = target;
  for (let i = 0; i < 64; i++) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0
        ? real
        : path.join(real, ...tail.slice().reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.push(path.basename(current));
      current = parent;
    }
  }
  return target;
}

export function registerSeedTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "seed_add",
    {
      title: "Attach source material",
      description:
        "Attach source material to the world, byte-hashed so identical material never ingests twice. " +
        "source:'files' reads repository files (PDF, Markdown, TXT, CSV, JSON…) from inside the workspace — paths that " +
        "resolve outside it are refused, and so are symlinks pointing out. source:'url' and source:'text' take material " +
        "YOU already have: the engine never touches the network, so fetch the page yourself and pass the extracted text " +
        "with the URL as provenance. For scanned PDFs with no text layer the receipt tells you to read it yourself and " +
        "re-send it as source:'text'.",
      inputSchema: {
        source: z
          .enum(["files", "url", "text", "corpus", "discourse"])
          .describe("Where the material comes from"),
        paths: z
          .array(z.string())
          .min(1)
          .max(50)
          .optional()
          .describe(
            "Workspace-relative (or absolute) file paths — source:'files' only",
          ),
        url: z
          .string()
          .min(4)
          .max(2000)
          .optional()
          .describe("Source URL, provenance only — source:'url' only"),
        title: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Short title for the digest list — source:'text' only"),
        text: z
          .string()
          .min(1)
          .optional()
          .describe(
            "The material itself — source:'url' and source:'text' only",
          ),
        caseId: z
          .string()
          .optional()
          .describe(
            "Canonical case study ID (e.g. 'unity-runtime-fee-2023', 'docker-hub-free-team-2023', 'redis-licensing-pivot-2024', 'hashicorp-bsl-2023') — source:'corpus' only",
          ),
        platform: z
          .enum([
            "reddit",
            "hackernews",
            "twitter",
            "github",
            "lobsters",
            "stackexchange",
            "mastodon",
            "bluesky",
            "discourse",
            "devto",
            "rss",
          ])
          .optional()
          .describe(
            "Discourse platform — source:'discourse' only. The first four have live adapters; the rest come from tools/collector as pre-structured threads",
          ),
        threadId: z
          .string()
          .optional()
          .describe("Thread ID or thread URL — source:'discourse' only"),
        thread: z
          .custom<unknown>()
          .optional()
          .describe("Pre-structured DiscourseThread object or JSON string — source:'discourse' only"),
        world: z
          .string()
          .optional()
          .describe("World id/slug (default: active world)"),
      },
      outputSchema: SEED_ADD_OUTPUT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ source, paths, url, title, text, caseId, platform, threadId, thread, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        if (source === "files") {
          if (!paths?.length)
            throw new Error("source:'files' needs paths: [...]");
          const results: Record<string, unknown>[] = [];
          for (const p of paths) {
            const abs = path.isAbsolute(p)
              ? p
              : path.resolve(ctx.workspace.root, p);
            const rel = path.relative(ctx.workspace.root, abs);
            let body = "";
            let note = "";
            const ext = path.extname(abs).toLowerCase();
            try {
              // Containment, before any filesystem read: literal resolution
              // catches `../` and absolute escapes, and the real path catches
              // a symlink inside the workspace pointing outside it.
              assertInsideWorkspace(p, ctx.workspace.root, abs);
              assertInsideWorkspace(
                p,
                ctx.workspace.root,
                realpathOfNearestExisting(abs),
              );
              const stat = fs.statSync(abs);
              if (stat.size > MAX_SEED_BYTES)
                throw new Error(
                  `file too large (${Math.round(stat.size / 1024 / 1024)} MB > 50 MB envelope)`,
                );
              if (ext === ".pdf") {
                const extracted = extractPdfText(fs.readFileSync(abs));
                body = extracted.text;
                if (!extracted.ok)
                  note =
                    "PDF had no extractable text layer — read it yourself and pass the content as source:'text'";
              } else if (TEXTUAL.has(ext) || ext === "") {
                body = fs.readFileSync(abs, "utf8");
              } else {
                body = fs.readFileSync(abs, "utf8");
                note = `unknown extension "${ext}" — read as UTF-8 text`;
              }
            } catch (e) {
              results.push({
                path: rel,
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              });
              continue;
            }
            const { seed, duplicate } = ctx.storage.addSeed(w.id, {
              kind: "file",
              title: path.basename(abs),
              ref: rel,
              text: body,
              digest: makeDigest(body),
            });
            results.push({
              path: rel,
              ok: true,
              seedId: seed.id,
              bytes: seed.bytes,
              duplicate,
              ...(note ? { note } : {}),
            });
          }
          const sizes = ctx.storage.listSeeds(w.id).map((s) => s.bytes);
          const coverage = coverageStats(sizes);
          if (sizes.length > 0) ctx.storage.setStage(w.id, "seeded");
          ctx.audit(w, { op: "seed_add", source, files: results.length });
          return ctx.reply(
            {
              ok: true,
              seeds: results,
              coverage,
              next: "seeds_review to check coverage, then ontology",
            },
            w,
            SEED_ADD_OUTPUT,
          );
        }

        if (source === "corpus") {
          const cid = caseId || title || text;
          if (!cid) {
            throw new Error(
              "source:'corpus' requires caseId (e.g. 'unity-runtime-fee-2023', 'docker-hub-free-team-2023', 'redis-licensing-pivot-2024', 'hashicorp-bsl-2023')",
            );
          }
          const c = getHistoricalCase(cid);
          if (!c) {
            const validIds = listHistoricalCases()
              .map((x) => x.id)
              .join(", ");
            throw new Error(
              `unknown corpus case '${cid}' — available cases: ${validIds}`,
            );
          }
          const payload = JSON.stringify(c);
          const { seed, duplicate } = ctx.storage.addSeed(w.id, {
            kind: "text",
            title: c.title,
            ref: `corpus://${c.id}`,
            text: payload,
            digest: c.policySummary,
          });
          ctx.storage.setStage(w.id, "seeded");
          ctx.audit(w, { op: "seed_add", source, caseId: c.id, ref: seed.ref });
          return ctx.reply(
            {
              ok: true,
              seed: seedRow(seed),
              duplicate,
              next: "add more material, call seeds_review, or move to ontology",
            },
            w,
            SEED_ADD_OUTPUT,
          );
        }

        if (source === "discourse") {
          let discourseThread: DiscourseThread | null = null;
          if (thread) {
            const raw = typeof thread === "string" ? JSON.parse(thread) : thread;
            discourseThread = validateDiscourseThread(raw);
          } else if (platform) {
            const adapter = getDiscourseAdapter(platform);
            discourseThread = await adapter.fetchThread(
              threadId || url || "default",
            );
          } else if (text) {
            const raw = JSON.parse(text);
            discourseThread = validateDiscourseThread(raw);
          } else {
            throw new Error(
              "source:'discourse' requires platform + threadId, or a structured thread object/JSON",
            );
          }

          const threadPayload = JSON.stringify(discourseThread);
          const threadDigest = makeDigest(
            discourseThread.posts.map((p) => p.text).join("\n\n") ||
              discourseThread.title,
          );
          const { seed, duplicate } = ctx.storage.addSeed(w.id, {
            kind: "text",
            title: discourseThread.title,
            ref:
              discourseThread.url ||
              `discourse://${discourseThread.platform}/${discourseThread.threadId}`,
            text: threadPayload,
            digest: threadDigest,
          });
          ctx.storage.setStage(w.id, "seeded");
          ctx.audit(w, {
            op: "seed_add",
            source,
            platform: discourseThread.platform,
            ref: seed.ref,
          });
          return ctx.reply(
            {
              ok: true,
              seed: seedRow(seed),
              duplicate,
              next: "add more material, call seeds_review, or move to ontology",
            },
            w,
            SEED_ADD_OUTPUT,
          );
        }

        if (!text?.trim())
          throw new Error(
            `source:'${source}' needs the material itself as text`,
          );
        const { seed, duplicate } = ctx.storage.addSeed(w.id, {
          kind: source === "url" ? "url" : "text",
          title:
            source === "url"
              ? (title ?? String(url).slice(0, 120))
              : (title ?? "untitled"),
          ref: source === "url" ? String(url) : (title ?? "untitled"),
          text,
          digest: makeDigest(text),
        });
        ctx.storage.setStage(w.id, "seeded");
        ctx.audit(w, { op: "seed_add", source, ref: seed.ref });
        return ctx.reply(
          {
            ok: true,
            seed: seedRow(seed),
            duplicate,
            next: "add more material, call seeds_review, or move to ontology",
          },
          w,
          SEED_ADD_OUTPUT,
        );
      } catch (e) {
        return ctx.fail(e);
      }
    },
  );

  server.registerTool(
    "seeds_review",
    {
      title: "Review ingested material",
      description:
        "Pre-flight check before ontology: list every seed with its digest and the coverage notes. Show this to the user before proceeding.",
      inputSchema: {
        world: z
          .string()
          .optional()
          .describe("World id/slug (default: active world)"),
      },
      outputSchema: SEEDS_REVIEW_OUTPUT,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const seeds = ctx.storage.listSeeds(w.id);
        return ctx.reply(
          {
            ok: true,
            seeds: seeds.map(seedRow),
            coverage: coverageStats(seeds.map((s) => s.bytes)),
            next: seeds.length
              ? 'ontology({action:"plan"}) to turn this material into entities, motives and anchors'
              : 'attach material first: seed_add({source:"files"|"url"|"text"})',
          },
          w,
          SEEDS_REVIEW_OUTPUT,
        );
      } catch (e) {
        return ctx.fail(e);
      }
    },
  );
}

function seedRow(s: Seed): Record<string, unknown> {
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    ref: s.ref,
    bytes: s.bytes,
    digest: s.digest,
  };
}
