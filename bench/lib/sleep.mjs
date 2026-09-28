/** Polite pacing helpers shared by the bench scripts. */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
