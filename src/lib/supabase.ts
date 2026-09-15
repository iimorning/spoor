/** Local-only edition: cloud auth is not part of this repository. */

export function isSupabaseConfigured(): boolean {
  return false;
}

/** Always null. Return type is `any` so leftover cloud helpers type-check. */
export function getSupabase(): any {
  return null;
}
