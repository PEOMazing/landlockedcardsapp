"use client";
import { useCallback, useEffect, useState } from "react";
import { THEME_KEY, ThemePref, isThemePref, resolveTheme } from "@/lib/theme";

// Light / dark / system, with system as the default.
//
// Reads nothing on the server and renders the same markup either way, so there
// is no hydration mismatch: the actual theme is already on <html> from the
// pre-paint script before this component exists. All this does is let someone
// change it.

const OPTIONS: { pref: ThemePref; label: string; icon: string }[] = [
  { pref: "light", label: "Light", icon: "☀" },
  { pref: "dark", label: "Dark", icon: "◑" },
  { pref: "system", label: "System", icon: "▣" },
];

function apply(pref: ThemePref) {
  const root = document.documentElement;
  const dark =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  // Suppress transitions for one frame. Without this every colour transition
  // on the page fires simultaneously and the switch reads as a smear.
  root.setAttribute("data-theme-switching", "");
  root.setAttribute("data-theme", resolveTheme(pref, dark));
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
  });
}

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch {}
    if (isThemePref(stored)) setPref(stored);
  }, []);

  // Following the OS means following it live, not just at load. Someone whose
  // machine flips to dark at sunset should see the app follow without a reload.
  useEffect(() => {
    if (pref !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const pick = useCallback((next: ThemePref) => {
    setPref(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    apply(next);
  }, []);

  return (
    <div
      className={`inline-flex items-center rounded-lg border border-edge overflow-hidden ${compact ? "" : "w-full"}`}
      role="group"
      aria-label="Colour theme"
    >
      {OPTIONS.map((o) => {
        const on = pref === o.pref;
        return (
          <button
            key={o.pref}
            type="button"
            onClick={() => pick(o.pref)}
            aria-pressed={on}
            title={`${o.label} theme`}
            className={`flex-1 px-2 py-1.5 transition-colors ${
              on ? "bg-foil/15 text-foil font-semibold" : "text-dim hover:text-body"
            }`}
            style={{ fontSize: "var(--t-meta)" }}
          >
            <span aria-hidden="true" className="mr-1">{o.icon}</span>
            {compact ? "" : o.label}
          </button>
        );
      })}
    </div>
  );
}
