/**
 * Deterministic RNG — the engine's only source of randomness.
 *
 * All engine behavior derives from seeded streams (world seed + stream key),
 * never from an unseeded source, so identical inputs replay byte-identically.
 * No unseeded randomness may appear anywhere in this package (enforced by test).
 */

/** FNV-1a 32-bit string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable 8-char hex of a string. */
export function hashHex(s: string): string {
  return (hashString(s) >>> 0).toString(16).padStart(8, "0");
}

/** mulberry32 PRNG factory — returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;

  constructor(seed: string | number) {
    this.next = mulberry32(typeof seed === "number" ? seed : hashString(String(seed)));
  }

  float(): number {
    return this.next();
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Fisher-Yates copy. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * Weighted sample without replacement (Efraimidis–Spirakis exponential keys).
   * Iterates in the given order, so results are deterministic for a given
   * seed + item order.
   */
  sampleWeighted<T>(items: readonly T[], weight: (t: T) => number, k: number): T[] {
    const keyed = items.map((item, i) => {
      const w = Math.max(weight(item), 1e-9);
      const u = this.next() + 1e-12; // avoid log(0)
      return { item, i, key: -Math.log(u) / w };
    });
    keyed.sort((a, b) => a.key - b.key || a.i - b.i);
    return keyed.slice(0, Math.min(k, items.length)).map((e) => e.item);
  }
}

/** Convenience: seeded RNG for a (world seed, stream key) pair. */
export function streamRng(worldSeed: string, key: string): Rng {
  return new Rng(`${worldSeed}:${key}`);
}
