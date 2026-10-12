// Who gets the Opus vision review after generation (owner decision 2026-10-12,
// token cost): free-plan owners do NOT (one authoring pass only); paid owners
// and admins do. One predicate shared by the freeze bake (which skips the
// model call) and the regen worker (which waives the review's credit base), so
// what runs and what is charged can never disagree. Unknown owner fails open
// to the review.

export function ownerGetsVisionReview(
  user: { plan: string | null; role: string | null } | null | undefined,
): boolean {
  return !(user?.plan === "free" && user.role !== "admin");
}
