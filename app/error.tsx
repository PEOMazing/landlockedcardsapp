"use client";
import ErrorScreen from "@/components/ErrorScreen";

// Catches anything thrown while rendering a page. The nav and the layout stay
// up, so this reads as one page having a problem rather than the app being
// down. Errors in the root layout itself fall through to app/global-error.tsx.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} />;
}
