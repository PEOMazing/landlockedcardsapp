"use client";
import { useEffect } from "react";
import { RELOAD_KEY, isOwnAssetUrl, isStaleBuildError, nextReloadState } from "@/lib/staleBuild";

// Mounted once in the root layout. Watches for the one failure mode that means
// "this tab is running against a build that is gone" and reloads the page.
//
// Two listeners, because the failure arrives by two different routes:
//
//  1. A <script> or <link> that 404s fires an error event on the element. That
//     event does not bubble, so it is only visible to a window listener in the
//     capture phase. This is the one that fires when a stale document asks for
//     chunk files the live deployment does not have.
//
//  2. A dynamic import that fails rejects a promise. Next.js loads route code
//     this way, so a client-side navigation to a page whose chunk is missing
//     surfaces as an unhandled rejection rather than a DOM event.
//
// Neither reaches a React error boundary, which is why the boundary in
// app/error.tsx is not enough on its own.

function recover(): void {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(RELOAD_KEY);
  } catch {
    // Private mode and locked-down browsers throw on sessionStorage. Without
    // it there is no loop protection, so do not reload at all: the error
    // screen with a button is a worse experience than a reload, and an
    // infinite reload is a worse experience than both.
    return;
  }
  const { reload, store } = nextReloadState(stored, Date.now());
  try {
    sessionStorage.setItem(RELOAD_KEY, store);
  } catch {
    return;
  }
  if (reload) window.location.reload();
}

export default function StaleBuildGuard() {
  useEffect(() => {
    const onAsset = (e: Event) => {
      const t = e.target as HTMLScriptElement & HTMLLinkElement;
      if (!t || !t.tagName) return;
      const tag = t.tagName.toLowerCase();
      if (tag !== "script" && tag !== "link") return;
      if (!isOwnAssetUrl(t.src || t.href)) return;
      recover();
    };

    const onError = (e: ErrorEvent) => {
      if (isStaleBuildError(e.error) || isStaleBuildError(e.message)) recover();
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      if (isStaleBuildError(e.reason)) recover();
    };

    // capture: true is load-bearing. Resource error events do not bubble.
    window.addEventListener("error", onAsset, true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onAsset, true);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
