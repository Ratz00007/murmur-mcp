# FLAGSHIP DEMO — status: pending first real-LLM run

The flagship is the proof that Murmur is not a toy: **≥48 personas, ≥8 rounds,
both platforms**, one scenario, run end-to-end inside a real coding agent with
a real host LLM — published verbatim in `/gallery`, never with a mock.

Config for the run (also encoded in `flagship.config.json`):

- Scenario: Acme Cloud pricing change (launch pack worked example).
- Population: 48 personas (mix: free users, Pro users, indie devs, maintainers,
  press voices, rival fans, cautious observers).
- Rounds: 8, platforms: both, inject at round 4: "StackHaven announces a
  free-tier match plus a one-click importer".
- Ensemble runCount: 5 (default). Seed recorded verbatim.

Steps (once the repo is live; needs a client with MCP + the host LLM):

1. `npx -y murmur-mcp doctor` (green).
2. In the client: `murmur-mcp init --template launch --dir flagship-run`.
3. Follow the `murmur-predict` prompt playbook: seeds → ontology → personas
   (48) → 8 rounds of batches (submit generations each round) → interviews →
   report.
4. Save the verbatim transcript + `report-1.html` + `report-1.md` +
   `murmur.db` metadata into `gallery/flagship-<client>-<model>/`.
5. Fill the results table below and the Token cost section in the README.

Expected scale (chars/4 token estimator — see `murmur/tests` NFR):

- 48 personas × 8 rounds × up to 3 actions each ≈ 1,150 generation items
  (plus ontology, personas, report drafting). Measured figures go here after
  the first run — do NOT fill the table with estimates.

| client | model | personas | rounds | seed | tokens in/out (est.) | wall time | report link |
|---|---|---|---|---|---|---|---|
| _pending_ | _pending_ | 48 | 8 | — | — | — | — |

Rules for the flagship run: no cherry-picking seeds; if the report's verdict
looks wrong, publish it anyway with the "what we would change" note; the mock
demo (`murmur-demo/`) is NOT the flagship and must stay labeled mock-driven.
