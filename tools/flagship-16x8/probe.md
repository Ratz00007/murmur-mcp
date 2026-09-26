You are running inside Claude Code with the Murmur MCP server connected. Do exactly this and then stop:

Call the MCP tool `world_init` with:
- name: "flagship-16x8-launch"
- seed: "flagship-claude-16x8-01"

Then call the MCP tool `world_status` for that world.

Then reply with EXACTLY this format and nothing else:
STATUS=<ok|error>
TOOLS_SEEN=<comma-separated list of murmur tool names you can see>
WORLD=<world id or slug>
ERROR=<the error message if status was error, otherwise none>
