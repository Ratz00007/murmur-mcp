# Try Murmur in 2 minutes

You have Murmur installed for your coding agent (see the README install table). This folder is a ready-made scenario — the exact launch-reaction case from the product plan.

## Paste this into your agent

```
/murmur-predict How will r/programming and X/Twitter react to our new pricing?
Sources: examples/pricing-page.md, examples/FAQ.md, examples/CHANGELOG.md
```

Your agent will drive the whole pipeline (world → seeds → ontology → graph → 24 personas → 8 rounds → report) and write `.murmur/reports/pricing-reaction/report-1.md` into this repo.

## Then experiment

```
/murmur-simulate How will r/programming react to the pricing change? Rounds: 4
```

When it pauses after round 4, tell it:

```
Inject this event: "Nimbus Labs announces a one-click import tool that undercuts us by 30%" — then continue.
```

Then interrogate the result:

```
/murmur-interview Ask the most hostile persona why the migration guide reads as a paywall
```

```
/murmur-interview Ask the ReportAgent: what are the posts behind the biggest risk?
```

## What to look at afterwards

- `.murmur/reports/pricing-reaction/report-1.md` — the prediction report (Mermaid charts render on GitHub)
- `.murmur/pricing-reaction/graph.mmd` — the entity/tension graph
- `.murmur/pricing-reaction/audit.jsonl` — every plan/submit exchange
- Re-run with the same seed for a byte-identical world (determinism contract)
