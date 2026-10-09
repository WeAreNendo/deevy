/**
 * An invitation is a link, and the link is a bearer token in its path
 * (docs/plans/sign-in.md slice 8). Whoever clicks one is by definition not a
 * Member yet, so the SPA answers `/invite/<token>` before the router exists
 * (`App.tsx` renders it only for a Member) and holds the token across the
 * sign-in that follows.
 *
 * `sessionStorage`, not `localStorage`: the OAuth dance leaves the SPA and
 * comes back to the same tab, which is exactly as long as a link somebody was
 * sent should live on their machine. Every access is guarded, because a
 * browser that refuses storage should still be able to sign in.
 */
import { basePath } from "@/lib/base";

/**
 * One per deployment on an origin: two hosted Workspaces share
 * `app.deevy.dev`, and an invitation to one must not be spent signing in to the
 * other (lib/base.ts).
 */
function held(): string {
  const base = basePath();
  return base ? `deevy.invitation:${base}` : "deevy.invitation";
}

/**
 * The token in `/invite/<token>`, or null for any other path — and for a path
 * that is not one. The token is base64url, so it is matched as that rather than
 * decoded: `/invite/%` made `decodeURIComponent` throw inside a render with no
 * error boundary above it, and the Human got a blank page with no way to sign
 * in (docs/plans/sign-in.md).
 */
export function invitationInPath(pathname: string): string | null {
  return /^\/invite\/([A-Za-z0-9_-]{1,128})\/?$/.exec(pathname)?.[1] ?? null;
}

/** Keep it for the sign-in to come back to. */
export function holdInvitation(token: string): void {
  try {
    window.sessionStorage.setItem(held(), token);
  } catch {
    // A browser with storage turned off signs in the same way; it just cannot
    // carry the token past the redirect, and says so on the screen it lands on.
  }
}

/** The token this tab is holding, if any. */
export function heldInvitation(): string | null {
  try {
    return window.sessionStorage.getItem(held());
  } catch {
    return null;
  }
}

/** Spent, refused for good, or the Human is already in: stop holding it. */
export function dropInvitation(): void {
  try {
    window.sessionStorage.removeItem(held());
  } catch {
    // Nothing was held if nothing could be stored.
  }
}
