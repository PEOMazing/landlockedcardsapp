import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /share/(.*) is the customer-facing stock list. It is deliberately open: the
// point is a link that works for someone who will never have an account. The
// page itself decides what is safe to show, which is why the wall is here and
// not on the data.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/label/(.*)", "/share/(.*)", "/api/public/(.*)", "/conditions", "/msrp", "/show"]);

export default clerkMiddleware((auth, req) => {
  if (!isPublic(req)) auth().protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*"],
};
