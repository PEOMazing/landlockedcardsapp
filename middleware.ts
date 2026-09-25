import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /share/(.*) is the customer-facing stock list. It is deliberately open: the
// point is a link that works for someone who will never have an account. The
// page itself decides what is safe to show, which is why the wall is here and
// not on the data.
// /overlay/(.*) is the OBS card board. Open for the same reason /share is, and
// one more: OBS loads a Browser Source by URL and has nowhere to sign in. The
// random key in the path is the credential, and what it unlocks is card art
// and prices for one show - the same thing the audience is already watching.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/label/(.*)", "/share/(.*)", "/overlay/(.*)", "/api/public/(.*)", "/conditions", "/msrp", "/show"]);

export default clerkMiddleware((auth, req) => {
  if (!isPublic(req)) auth().protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*"],
};
