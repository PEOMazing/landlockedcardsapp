import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/label/(.*)"]);

export default clerkMiddleware((auth, req) => {
  if (!isPublic(req)) auth().protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*"],
};
