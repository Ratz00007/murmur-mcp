// probe-models.mjs — ask the client which models actually work, 1 turn each.
// The flagship run needs a model that can fill MCP tool arguments; the free
// tier model cannot. This finds out which free models are selectable at all.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const CANDIDATES = process.env.CLAUDE_BIN ?? "claude";
const candidates = process.argv.slice(2);
for (const m of candidates) {
  const t0 = Date.now();
  try {
    // .cmd shim: on Windows execFile cannot spawn a .cmd without a shell.
    const { stdout } = await run("cmd.exe", ["/c", CANDIDATES, "-p", "--model", m, "--max-turns", "1", "Reply with exactly: OK"], {
      cwd: process.cwd(), timeout: 120_000, maxBuffer: 1 << 20, windowsHide: true,
    });
    const out = (stdout || "").trim();
    const bad = /unrecognized_model|402|balance|not available|invalid model|free limit|429/i.test(out);
    console.log(`${bad ? "FAIL" : "OK  "}  ${m.padEnd(34)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ${out.slice(0, 90).replace(/\s+/g, " ")}`);
  } catch (e) {
    const msg = ((e.stdout || "") + (e.stderr || "") + (e.message || "")).trim();
    console.log(`FAIL  ${m.padEnd(34)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ${msg.slice(0, 90).replace(/\s+/g, " ")}`);
  }
}
