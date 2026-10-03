"use client";
import { useEffect, useState } from "react";
import { RELOAD_KEY, isStaleBuildError, nextReloadState } from "@/lib/staleBuild";

// The screen somebody sees when the app throws, and the recovery attached to it.
//
// What this replaces is Next.js's own production fallback, which reads
// "Application error: a client-side exception has occurred (see the browser
// console for more information)". On a phone, mid-show, that is a dead end:
// there is no console to see, and nothing on the screen to press.
//
// Everything here is inline styles rather than Tailwind classes on purpose. One
// of the things that lands people on this screen is the stylesheet itself
// failing to load, and an error screen that depends on the stylesheet is
// invisible exactly when it is needed.

const INK = "#0D0F14";
const PANEL = "#14171F";
const EDGE = "#262B38";
const BODY = "#F4F5F7";
const DIM = "#8B93A7";
const FOIL = "#7AA2FF";

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  const stale = isStaleBuildError(error);
  const [recovering, setRecovering] = useState(stale);

  useEffect(() => {
    if (!stale) return;
    // A stale build is not a fault anyone can act on, so do not make them read
    // about it. Reload and put them back where they were.
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(RELOAD_KEY);
    } catch {
      setRecovering(false);
      return;
    }
    const { reload, store } = nextReloadState(stored, Date.now());
    try {
      sessionStorage.setItem(RELOAD_KEY, store);
    } catch {
      setRecovering(false);
      return;
    }
    if (reload) window.location.reload();
    else setRecovering(false);
  }, [stale]);

  const wrap: React.CSSProperties = {
    minHeight: "60vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    background: INK,
    color: BODY,
    fontFamily: "var(--font-body, system-ui, sans-serif)",
  };

  if (recovering) {
    return (
      <div style={wrap}>
        <p style={{ color: DIM, fontSize: "14px" }}>Updating to the latest version...</p>
      </div>
    );
  }

  const btn: React.CSSProperties = {
    appearance: "none",
    border: `1px solid ${EDGE}`,
    background: "transparent",
    color: BODY,
    borderRadius: "8px",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <div style={wrap}>
      <div
        style={{
          maxWidth: "26rem",
          width: "100%",
          background: PANEL,
          border: `1px solid ${EDGE}`,
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h1 style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 8px" }}>
          This page hit a snag
        </h1>
        <p style={{ color: DIM, fontSize: "14px", lineHeight: 1.5, margin: "0 0 20px" }}>
          Nothing has been lost. Hits, sets and inventory are saved as you go, so reloading picks up
          exactly where you were.
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={() => window.location.reload()}>
            Reload
          </button>
          {reset && (
            <button type="button" style={btn} onClick={reset}>
              Try again
            </button>
          )}
          <a href="/" style={{ ...btn, color: FOIL, textDecoration: "none" }}>
            Go home
          </a>
        </div>
        {error?.digest && (
          <p style={{ color: DIM, fontSize: "11px", marginTop: "20px", marginBottom: 0 }}>
            Reference {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
