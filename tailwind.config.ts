import type { Config } from "tailwindcss";

// Every colour resolves through a CSS variable holding raw RGB channels, so
// the same utility name is correct in both themes and no page needs editing to
// become theme-aware. The `<alpha-value>` placeholder is what preserves the
// opacity modifiers already used throughout the app (bg-foil/15, border-edge/60,
// bg-win/25); a plain hex here would break all of them silently.
//
// Palette values live in app/tokens.css. This file only wires names to them.
const c = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  // data-theme on <html>, set pre-paint by the inline script in app/layout.tsx
  darkMode: ["class", ':root[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: c("ink"),
        panel: c("panel"),
        edge: c("edge"),
        body: c("body"),
        dim: c("dim"),
        foil: c("foil"),
        win: c("win"),
        givvy: c("givvy"),
        // amber, for "this still works but check it" - distinct from bad,
        // which is reserved for something that has actually gone wrong
        warn: c("warn"),
        bad: c("bad"),
      },
      // The two radii from the blueprint, mapped onto the names the codebase
      // already uses so 90 existing `rounded-lg` call sites land on the scale
      // instead of needing a sweep.
      //
      // DEFAULT matters as much as the named steps and was the gap: a bare
      // `rounded` is Tailwind's 4px, and 35 places used it, so a third radius
      // was in the app the whole time the config claimed there were two. It
      // also covers the side-specific forms, since `rounded-t` reads DEFAULT.
      // `full` is the pill, which is a shape rather than a step.
      borderRadius: {
        DEFAULT: "var(--r-sm)",
        sm: "var(--r-sm)",
        md: "var(--r-sm)",
        lg: "var(--r-md)",
        xl: "var(--r-md)",
        full: "var(--r-pill)",
      },
      boxShadow: {
        lifted: "var(--shadow)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
      spacing: {
        s1: "var(--s-1)",
        s2: "var(--s-2)",
        s3: "var(--s-3)",
        s4: "var(--s-4)",
        s6: "var(--s-6)",
        s8: "var(--s-8)",
      },
    },
  },
  plugins: [],
};
export default config;
