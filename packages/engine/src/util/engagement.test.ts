/** Unit tests for the canonical engagement formula. */
import { describe, expect, it } from "vitest";
import { engagementScore } from "./engagement.js";

describe("engagementScore", () => {
  it("weights likes + 2×reposts + upvotes − downvotes", () => {
    expect(engagementScore({ likes: 3, reposts: 2, upvotes: 5, downvotes: 1 })).toBe(3 + 4 + 5 - 1);
  });
  it("is zero for an untouched post", () => {
    expect(engagementScore({ likes: 0, reposts: 0, upvotes: 0, downvotes: 0 })).toBe(0);
  });
  it("downvotes reduce engagement — controversy never boosts the score", () => {
    expect(engagementScore({ likes: 0, reposts: 0, upvotes: 0, downvotes: 4 })).toBe(-4);
    expect(engagementScore({ likes: 4, reposts: 0, upvotes: 0, downvotes: 4 })).toBe(0);
  });
  it("reposts outweigh plain likes", () => {
    expect(engagementScore({ likes: 1, reposts: 1, upvotes: 0, downvotes: 0 })).toBeGreaterThan(
      engagementScore({ likes: 2, reposts: 0, upvotes: 0, downvotes: 0 })
    );
  });
  it("accepts the Post metrics shape", () => {
    expect(engagementScore({ likes: 1, reposts: 1, upvotes: 1, downvotes: 1 })).toBe(3);
  });
});