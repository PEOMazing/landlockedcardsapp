// Theme resolution, shared by the pre-paint script and the toggle so the two
// can never disagree about what "system" means.

export type ThemePref = "light" | "dark" | "system";
export const THEME_KEY = "llc-theme";

export function isThemePref(v: unknown): v is ThemePref {
  return v === "light" || v === "dark" || v === "system";
}

/** What a preference actually renders as. Only ever "light" or "dark": the
 *  stylesheet has no third state, so "system" has to be resolved before it
 *  reaches the DOM. */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return systemPrefersDark ? "dark" : "light";
}

// The script that runs before first paint.
//
// This has to be inline and synchronous in <head>. Anything deferred - a
// module, an effect, even a tiny fetch - paints the default theme first and
// then corrects it, which is exactly the flash the blueprint calls out. It is
// written as a string because it must not wait for React to hydrate.
//
// Wrapped in try/catch because localStorage throws outright in a locked-down
// or private context, and a theme preference is never worth a blank page.
export const THEME_SCRIPT = `
(function(){
  try {
    var k = ${JSON.stringify(THEME_KEY)};
    var p = null;
    try { p = localStorage.getItem(k); } catch (e) {}
    if (p !== "light" && p !== "dark" && p !== "system") p = "system";
    var dark = p === "dark" || (p === "system" &&
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;
