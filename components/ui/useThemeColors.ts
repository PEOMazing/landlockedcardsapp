"use client";
import { useEffect, useState } from "react";

// Concrete colour strings for things that cannot read CSS.
//
// Everything in this app themes by resolving rgb(var(--c-x)) in CSS, which
// costs nothing and needs no JavaScript. Charts are the exception: Recharts
// hands most colours straight to SVG presentation attributes (fill, stroke),
// and a presentation attribute is not a CSS declaration, so var() in one is
// simply an invalid value. The chart needs a real "rgb(34 39 56)".
//
// Before this, InsightsClient held a hardcoded map of nine hex values. Three of
// them were dark-mode surfaces: the gridlines, the tooltip background and the
// axis text. In the light theme that is pale grey text on a white card and a
// near-black tooltip, which is not a tweak, it is an unreadable chart. It was
// also quietly off-palette: the series colour named `foil` was #FFB94A, an
// orange, while the product's foil is blue.
//
// So the colours come from the same tokens as everything else, read once and
// re-read when the theme attribute changes.

const NAMES = ["ink", "panel", "edge", "body", "dim", "foil", "win", "givvy", "warn", "bad"] as const;
export type ColorName = (typeof NAMES)[number];
export type ThemeColors = Record<ColorName, string>;

// What the dark theme resolves to. Used for the very first render, before the
// effect has read the document, and on the server where there is no document
// at all. Dark rather than light because dark is this app's default, so the
// common case is correct on frame one and never visibly corrects itself.
const FALLBACK: ThemeColors = {
  ink: "rgb(9 9 11)",
  panel: "rgb(22 27 38)",
  edge: "rgb(38 43 56)",
  body: "rgb(244 245 247)",
  dim: "rgb(139 147 167)",
  foil: "rgb(122 162 255)",
  win: "rgb(62 207 142)",
  givvy: "rgb(192 132 252)",
  warn: "rgb(232 179 65)",
  bad: "rgb(240 98 93)",
};

function read(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as ThemeColors;
  for (const n of NAMES) {
    // The token is a channel triple, "38 43 56", so it composes with slash
    // opacity in CSS. Here it has to become a whole colour.
    const channels = cs.getPropertyValue(`--c-${n}`).trim();
    out[n] = /^\d+\s+\d+\s+\d+$/.test(channels) ? `rgb(${channels})` : FALLBACK[n];
  }
  return out;
}

export default function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(FALLBACK);

  useEffect(() => {
    setColors(read());
    // The theme toggle swaps one attribute on <html>. CSS picks that up for
    // free; a chart has to be told.
    const obs = new MutationObserver(() => setColors(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return colors;
}
