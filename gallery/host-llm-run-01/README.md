# Run 01 — LLM-authored Acme Cloud pricing reaction

**What this is:** the first Murmur run whose persona voices and post text were
written by an actual language model instead of the bundled deterministic mock
brain. Same engine, same validators, same storage, same report renderer.

**What this is not:** a client-IDE session. It was driven headlessly by
`tools/host-llm-run/run.mjs`. See `../INDEX.md` for the full comparison table.

| | |
|---|---|
| Seed | `host-llm-flagship-01` |
| World | `acme-pricing-reaction` |
| Population | 12 personas (authored cards) |
| Rounds | 4 |
| Ontology | 15 entities |
| Posts | 20 (`po_1`..`po_20`) |
| Engagement | 12 total points |
| Authored content | 5 rounds of posts/replies/votes, all in `../../tools/host-llm-run/brain/` |
| Citation integrity | 19 distinct ids cited, 0 dangling — **100%** |

## Files
- `report.html` — self-contained dashboard (no network requests; open it directly)
- `report.md` — the same report as markdown
- `seed-brief.md` — the seed corpus the run was grounded in

## What the run actually found

The interesting result is that **the loudest failure was not the price**. The
highest-engagement post in the entire run (6 of 12 points) was a confused
student asking how to claim the amnesty form — not an attack on Acme Cloud. A
procurement persona independently identified the same structural gap: the
increase is *justified* with future work (the observability layer) while the
delivered work (doubled uptime) is a year old, so the 40% is publicly
undefended by about 20 points. An advocate conceded that frame as correct,
which is unusual and is the single most actionable signal in the run.

Faction split at the end: 1 supporter, 4 opponents, **7 undecided (58%)** — and
the undecided bloc held *more* engagement than supporters and opponents
combined. The crowd is not hostile; it is confused and undecided.

## Honesty notes (read before citing this run)
- **Content is LLM-authored, not human-observed.** It reflects a narrative arc a
  language model wrote from persona cards. It is not a sample of the real Acme
  Cloud developer community.
- **Engine determinism holds; content replay does not.** The seed reproduces
  every engine-side number, but the LLM's own non-determinism means the post
  *bytes* cannot be regenerated from the seed. Only the authored files in
  `tools/host-llm-run/brain/` reproduce this run exactly.
- **The projection produced no interval.** Both the linear projection and the
  P10–P90 ensemble band returned null, so the report makes no forward-looking
  numeric claim. The 4-round momentum figure is far too small a sample to
  distinguish from noise.
- **No organic or cascade engagement occurred** in this run, so the seeded
  diffusion model was exercised by authored reply behavior rather than by its
  own mechanics.
- **Scale is deliberately modest** (12×4) so the run is completable and
  auditable, not impressive. The flagship target is 16×8 in a real client
  session (`../../murmur-demo/FLAGSHIP-DEMO.md`).
