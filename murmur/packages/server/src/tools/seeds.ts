/** Seed ingestion tools: seed_add_files, seed_add_url, seed_add_text, seeds_review. */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { coverageStats, extractPdfText, makeDigest, MAX_SEED_BYTES, type Seed } from "@murmur/engine";
import type { ServerContext } from "../session.js";

const TEXTUAL = new Set([".md", ".markdown", ".txt", ".text", ".csv", ".json", ".yml", ".yaml", ".log"]);

class WorkspacePathError extends Error {}

function assertInsideWorkspace(input: string, root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (rel && (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))) {
    throw new WorkspacePathError(`path "${input}" resolves outside workspace "${root}" (${candidate}); absolute paths outside the workspace are not allowed — use a workspace-relative path`);
  }
}

export function registerSeedTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "seed_add_files",
    "Attach source material from repository files (PDF, Markdown, TXT, CSV, JSON…). Byte-hashed dedupe: identical material never ingests twice. " +
      "For scanned PDFs with no text layer the receipt will tell you to read the file yourself and pass the text via seed_add_text.",
    {
      paths: z.array(z.string()).min(1).max(50).describe("Repo-relative (or absolute) file paths"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ paths, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const results: Record<string, unknown>[] = [];
        let totalBytes = 0;
        for (const p of paths) {
          const abs = path.isAbsolute(p) ? p : path.resolve(ctx.workspace.root, p);
          const rel = path.relative(ctx.workspace.root, abs);
          let text = "";
          let note = "";
          const ext = path.extname(abs).toLowerCase();
          try {
            const stat = fs.statSync(abs);
            if (stat.size > MAX_SEED_BYTES) throw new Error(`file too large (${Math.round(stat.size / 1024 / 1024)} MB > 50 MB envelope)`);
            if (ext === ".pdf") {
              const buf = fs.readFileSync(abs);
              const extracted = extractPdfText(buf);
              text = extracted.text;
              if (!extracted.ok) note = "PDF had no extractable text layer — read it yourself and pass the content via seed_add_text";
            } else if (TEXTUAL.has(ext) || ext === "") {
              text = fs.readFileSync(abs, "utf8");
            } else {
              text = fs.readFileSync(abs, "utf8");
              note = `unknown extension "${ext}" — read as UTF-8 text`;
            }
          } catch (e) {
            results.push({ path: rel, ok: false, error: e instanceof Error ? e.message : String(e) });
            continue;
          }
          totalBytes += Buffer.byteLength(text, "utf8");
          const { seed, duplicate } = ctx.storage.addSeed(w.id, {
            kind: "file",
            title: path.basename(abs),
            ref: rel,
            text,
            digest: makeDigest(text),
          });
          results.push({ path: rel, ok: true, seedId: seed.id, bytes: seed.bytes, duplicate, ...(note ? { note } : {}) });
        }
        const sizes = ctx.storage.listSeeds(w.id).map((s) => s.bytes);
        const coverage = coverageStats(sizes);
        if (sizes.length > 0) ctx.storage.setStage(w.id, "seeded");
        ctx.audit(w, { op: "seed_add_files", files: results.length });
        return ctx.reply({ ok: true, seeds: results, coverage, next: "seeds_review to check coverage, then ontology_plan" }, w);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "seed_add_url",
    "Attach material from a URL. The engine never fetches the network — YOU fetch the page (you have a browser/reader), then pass the extracted text here with the URL as provenance.",
    {
      url: z.string().min(4).max(2000).describe("Source URL (provenance only)"),
      text: z.string().min(1).describe("The page content you extracted — markdown or plain text"),
      title: z.string().max(200).optional().describe("Human title for the digest list"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ url, text, title, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const { seed, duplicate } = ctx.storage.addSeed(w.id, {
          kind: "url",
          title: title ?? url.slice(0, 120),
          ref: url,
          text,
          digest: makeDigest(text),
        });
        ctx.storage.setStage(w.id, "seeded");
        ctx.audit(w, { op: "seed_add_url", url });
        return ctx.reply({ ok: true, seed: seedRow(seed), duplicate, next: "add more seeds or call ontology_plan" }, w);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "seed_add_text",
    "Attach pasted material — notes, briefs, transcripts, email threads. This is also the fallback path for PDFs with no text layer.",
    {
      title: z.string().min(1).max(200).describe("Short title for this material"),
      text: z.string().min(1).describe("The material itself"),
      world: z.string().optional().describe("World id/slug (default: active world)"),
    },
    async ({ title, text, world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const { seed, duplicate } = ctx.storage.addSeed(w.id, {
          kind: "text",
          title,
          ref: title,
          text,
          digest: makeDigest(text),
        });
        ctx.storage.setStage(w.id, "seeded");
        ctx.audit(w, { op: "seed_add_text", title });
        return ctx.reply({ ok: true, seed: seedRow(seed), duplicate, next: "add more seeds or call ontology_plan" }, w);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "seeds_review",
    "Pre-flight check before ontology: list every seed with its digest and coverage notes. Show this to the user before proceeding.",
    { world: z.string().optional().describe("World id/slug (default: active world)") },
    async ({ world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const seeds = ctx.storage.listSeeds(w.id);
        return ctx.reply(
          {
            ok: true,
            seeds: seeds.map(seedRow),
            coverage: coverageStats(seeds.map((s) => s.bytes)),
            next: seeds.length ? "ontology_plan to turn this material into entities, motives and anchors" : "attach material first (seed_add_files / seed_add_url / seed_add_text)",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}

function seedRow(s: Seed): Record<string, unknown> {
  return { id: s.id, kind: s.kind, title: s.title, ref: s.ref, bytes: s.bytes, digest: s.digest };
}
