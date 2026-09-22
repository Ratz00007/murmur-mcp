/**
 * Workspace + world-directory layout. Everything Murmur writes lives under
 * `.murmur/` at the repository root, so a world is self-contained and portable.
 *
 *   .murmur/murmur.db                     — SQLite world store
 *   .murmur/{world-slug}/graph.mmd        — Mermaid graph export
 *   .murmur/{world-slug}/audit.jsonl      — JSONL audit trail of plan/submit exchanges
 *   .murmur/{world-slug}/interviews.jsonl — persona interview log
 *   .murmur/{world-slug}/qa.jsonl         — report_agent_ask log
 *   .murmur/{world-slug}/artifacts/       — oversized tool responses spilled here
 *   .murmur/reports/{world-slug}/report-N.md — versioned prediction reports
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function findWorkspaceRoot(startDir: string): string {
  const override = process.env.MURMUR_WORKSPACE;
  if (override) return path.resolve(override);
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".murmur")) || fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export class Workspace {
  readonly root: string;

  constructor(startDir: string) {
    this.root = findWorkspaceRoot(startDir);
  }

  get murmurDir(): string {
    return path.join(this.root, ".murmur");
  }

  get dbPath(): string {
    return path.join(this.murmurDir, "murmur.db");
  }

  ensure(): void {
    fs.mkdirSync(this.murmurDir, { recursive: true });
  }

  worldDir(slug: string): string {
    return path.join(this.murmurDir, slug);
  }

  ensureWorldDir(slug: string): string {
    const dir = this.worldDir(slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
    return dir;
  }

  auditPath(slug: string): string {
    return path.join(this.worldDir(slug), "audit.jsonl");
  }

  interviewsPath(slug: string): string {
    return path.join(this.worldDir(slug), "interviews.jsonl");
  }

  qaPath(slug: string): string {
    return path.join(this.worldDir(slug), "qa.jsonl");
  }

  graphPath(slug: string): string {
    return path.join(this.worldDir(slug), "graph.mmd");
  }

  reportPath(slug: string, version: number): string {
    return path.join(this.murmurDir, "reports", slug, `report-${version}.md`);
  }

  artifactPath(slug: string, name: string): string {
    return path.join(this.worldDir(slug), "artifacts", name);
  }

  /** Path relative to workspace root, for receipts. */
  rel(p: string): string {
    return path.relative(this.root, p) || ".";
  }

  appendJsonl(file: string, obj: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
  }

  writeAtomic(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp-" + process.pid + "-" + Math.floor(Math.random() * 1e9).toString(36);
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, file);
  }

  readIfExists(file: string): string | null {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
}
