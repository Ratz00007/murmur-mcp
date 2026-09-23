# murmur-mcp

Social-simulation MCP server for coding agents — predict how communities react to your product, policy or story, powered by the coding subscription you already pay for.

**Zero API keys. Zero egress. All local.**

```bash
npx -y murmur-mcp          # run the server (stdio)
npx -y murmur-mcp doctor   # check Node + SQLite + workspace, print install snippets
```

Install for your agent (examples):

```bash
claude mcp add murmur -- npx -y murmur-mcp
codex  mcp add murmur -- npx -y murmur-mcp
gemini mcp add murmur -- npx -y murmur-mcp
```

Then use the one-command prompts in your agent: `/murmur-predict`, `/murmur-simulate`, `/murmur-interview`, `/murmur-resume`.

The engine is deterministic and LLM-free; your agent's LLM does all generation through batched plan/submit tool pairs. Reports land in your repo as versioned Markdown + Mermaid. Same seed + same submissions replay byte-identically.

Full documentation, the 29-tool catalog, the 10-client support matrix and the guarantees (no-egress release gate, client neutrality, resumability) live in the repository README: https://github.com/murmur-sim/murmur

License: Apache-2.0.
