/* Decides what to do with a /api/state (or /api/ops) response once the server can
   answer callers without a valid session with an allow-listed PUBLIC snapshot
   ({..., public: true}) instead of the whole board (backend/publicState.js).

   - A normal full response: use it.
   - A public snapshot on a public route (/dpr/new, /forms/…): expected — use it.
   - A public snapshot anywhere else while this browser still holds a token: the
     session has expired. The reduced data must NEVER replace the board the user
     is looking at; the stale token is dropped so the sign-in screen appears.
     (If there is no board yet — first load — the snapshot is still used, since
     the sign-in screen needs some data to render.)
   - A public snapshot with no token on a non-public route: nobody is signed in;
     use it (it is what the sign-in screen shows). */
export interface StateVerdict {
  /** replace the in-memory board with this response? */
  use: boolean;
  /** the stored session is no longer valid: clear the token and show sign-in */
  sessionExpired: boolean;
}

/* After a successful sign-in: must the full board be fetched again before selecting the user?
   Only when the board held so far may be the reduced public snapshot. `lastWasPublic` = whether the most recent
   state response was a public snapshot: true -> fetch; false -> the full board is already in memory (no extra
   request, nothing to wait for); null = no state response seen yet -> fetch (the conservative choice). */
export function needsFullBoardAfterLogin(lastWasPublic: boolean | null): boolean {
  return lastWasPublic !== false;
}

export function judgeStateResponse(
  s: { public?: boolean } | null | undefined,
  ctx: { publicRoute: boolean; hasToken: boolean; haveBoard: boolean }
): StateVerdict {
  if (!s) return { use: false, sessionExpired: false };
  if (!s.public) return { use: true, sessionExpired: false };
  const sessionExpired = !ctx.publicRoute && ctx.hasToken;
  return { use: !(sessionExpired && ctx.haveBoard), sessionExpired };
}
