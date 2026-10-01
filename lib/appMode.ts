// Which product this deployment is.
//
// One codebase, two front doors. landlockedcards.app runs the whole thing:
// singles, inventory, shows, the OBS board, payroll. cardquarters.com runs the
// half a card vendor needs and none of the streaming, because a vendor with a
// booth has no shows to pay anyone for, and a payroll page they cannot use
// reads as a half-finished product rather than a focused one.
//
// This is a build-time variable rather than a per-user setting, because the
// two deployments point at different Airtable bases: the mode is a property of
// the deployment, not of whoever signed in. NEXT_PUBLIC_ so the nav can read
// it in the browser without a round trip, and so the middleware sees it
// inlined at build rather than reaching for a secret at the edge.
//
// Default is "full", so the existing deployment keeps working without anyone
// adding a variable to it. New behaviour has to be opted into; that way a
// forgotten env var fails toward the app that already exists rather than
// quietly amputating half of it.
export type AppMode = "full" | "inventory";

export const APP_MODE: AppMode =
  process.env.NEXT_PUBLIC_APP_MODE === "inventory" ? "inventory" : "full";

/** Shows, the OBS board, payroll, the timeclock and the Whatnot tooling. */
export const streamsEnabled = (): boolean => APP_MODE === "full";

// Whose name is over the door. Also defaults to the original, for the same
// reason the mode does.
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "LandLocked Cards";

// Everything the streaming half owns, pages and API both.
//
// The nav reads this to hide links and the middleware reads it to make the
// same paths 404, which matters more than the nav does: a hidden link is a
// bookmark away from being visited, and a vendor who lands on another
// business's payroll page has been shown something that was never theirs.
//
// API routes are in here too. The pages are only the part you can see.
export const STREAM_PATHS = [
  "/dashboard",
  "/streams",
  "/overlay",
  "/vendor",
  "/admin/streams",
  "/admin/payroll",
  "/admin/analytics",
  "/admin/insights",
  "/admin/audit",
  "/api/streams",
  "/api/lines",
  "/api/payroll",
  "/api/time",
];

export function isStreamPath(pathname: string): boolean {
  const p = String(pathname || "");
  // The Pay page sits at the bare /admin, while /admin/inventory and
  // /admin/settings underneath it are both things a vendor still needs, so
  // this one has to match exactly rather than by prefix.
  if (p === "/admin") return true;
  return STREAM_PATHS.some((s) => p === s || p.startsWith(s + "/"));
}
