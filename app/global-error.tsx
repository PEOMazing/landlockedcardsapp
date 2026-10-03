"use client";
import ErrorScreen from "@/components/ErrorScreen";

// The last line of defence: an error in the root layout, which means no nav, no
// Clerk provider and no stylesheet. Next.js requires this file to render its own
// <html> and <body> because the ones in the layout are what failed.
//
// This is the file that stands between a streamer and the bare
// "Application error: a client-side exception has occurred" screen.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0D0F14" }}>
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
