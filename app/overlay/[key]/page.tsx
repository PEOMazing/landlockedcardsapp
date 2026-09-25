import type { Metadata } from "next";
import OverlayClient from "./OverlayClient";

export const dynamic = "force-dynamic";

// Public by way of the key in the URL - see lib/overlay.ts and the middleware
// allowlist. Kept out of search results because a live show's board has no
// business being indexed.
export const metadata: Metadata = {
  title: "Card board",
  robots: { index: false, follow: false },
};

export default function OverlayPage({ params }: { params: { key: string } }) {
  return <OverlayClient apiKey={params.key} />;
}
