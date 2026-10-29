/**
 * Canonical engagement formula — the single source of truth for every
 * engagement score in the engine (reports, feeds, activation heat, virality).
 *
 * Likes count once, reposts amplify (×2), upvotes count once and downvotes
 * subtract, so controversy never boosts a post's engagement on its own.
 */
export function engagementScore(post: {
  likes: number;
  reposts: number;
  upvotes: number;
  downvotes: number;
}): number {
  return post.likes + 2 * post.reposts + post.upvotes - post.downvotes;
}

/** Engagement of a whole post (metrics wrapper) — the one Post-level helper. */
export function engagementOf(post: {
  metrics: {
    likes: number;
    reposts: number;
    upvotes: number;
    downvotes: number;
  };
}): number {
  return engagementScore(post.metrics);
}
