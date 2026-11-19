/**
 * The part of the theme system that has no React in it, so that both the
 * build (apps/web/vite.config.ts inlines the script into index.html) and the
 * provider (components/theme.tsx) can import it.
 *
 * Read the file-level docs in components/theme.tsx before editing.
 */

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = Exclude<ThemeMode, "auto">;

/** localStorage key. A per-device UI preference; it is not app data. */
export const THEME_STORAGE_KEY = "fiscode-theme";

/**
 * `<meta name="theme-color">` per resolved theme: the browser and installed
 * PWA chrome. Matches `--background` (light #ffffff, dark oklch(0.145 0 0)).
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#0a0a0a",
};

export const isThemeMode = (value: unknown): value is ThemeMode =>
  value === "light" || value === "dark" || value === "auto";

/**
 * Inline-script source that runs synchronously in `<head>` before any paint.
 * Reads the stored mode, resolves "auto" via matchMedia, applies the class to
 * `<html>` and sets the theme-color meta.
 *
 * It is serialized with `toString()`, so `themeFn` must be self-contained:
 * it cannot use anything from this module's scope. The storage key and the
 * two colours are repeated inside it; apps/web/src/lib/theme.test.tsx checks they match
 * the constants above.
 */
export const themeDetectorScript = (function () {
  function themeFn() {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("fiscode-theme");
    } catch {
      // storage unavailable (private mode, blocked): fall back to "auto"
    }
    const mode = stored === "light" || stored === "dark" ? stored : "auto";
    const resolved =
      mode === "auto"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : mode;

    const root = document.documentElement;
    root.classList.remove("light", "dark", "auto");
    root.classList.add(resolved);
    if (mode === "auto") root.classList.add("auto");

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#0a0a0a" : "#ffffff");
  }
  return `(${themeFn.toString()})();`;
})();
