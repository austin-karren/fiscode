/**
 * # Theme system: read this before editing
 *
 * Light, dark and "auto" (follow the system). The pieces look simple in
 * isolation but only work when their timings line up. If you change one,
 * audit the others.
 *
 * ## The three moving parts
 *
 * 1. **localStorage** key `fiscode-theme`: `"light" | "dark" | "auto"`
 *    (missing or anything else is treated as `"auto"`). A per-device UI
 *    preference. It is not app data and is not part of the CSV.
 *
 * 2. **`themeDetectorScript`** (lib/theme-script.ts): inlined into
 *    `<head>` of the app's index.html at build time. Runs synchronously
 *    before first paint, reads localStorage and applies the resolved class
 *    (`light` or `dark`, plus `auto` when following the system) to
 *    `<html>`, and sets `<meta name="theme-color">`. This is what keeps
 *    the CSS variables correct on the very first frame.
 *
 * 3. **`ThemeProvider`**: owns the mode after load. Its state is seeded
 *    once, synchronously, from the class the inline script already wrote.
 *
 * ## Initial-state contract: do NOT add a useEffect to "sync" this
 *
 * Because the inline script runs in `<head>` before React starts, the
 * `<html>` class is authoritative by the time `useState`'s lazy
 * initializer fires. No mount effect calls `setThemeMode` or
 * `updateThemeClass`; that pattern shows one frame of the wrong theme to
 * every `useTheme()` consumer (the Toaster, the switcher).
 *
 * ## Don't
 *
 * - Don't change the storage key or its values without changing the
 *   inline script too (it inlines its own reader).
 * - Don't replace the synchronous `getComputedStyle` reflow in
 *   `updateThemeClass` with `requestAnimationFrame`. The reflow is a
 *   deliberate paint barrier, so transitions cannot flash between the
 *   class swap and the removal of the transition-disabling style.
 * - Don't put a CSS transition on colour for the whole page to "smooth"
 *   the switch: it brings back the flicker this file removes.
 */

import * as React from "react";

import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  isThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "../lib/theme-script";

export type { ResolvedTheme, ThemeMode };

const setStoredThemeMode = (theme: ThemeMode) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the choice still holds for this page.
  }
};

const getSystemTheme = (): ResolvedTheme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const updateThemeClass = (themeMode: ThemeMode) => {
  const root = document.documentElement;

  // Disable transitions while we swap the class so colors don't animate.
  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode("*, *::before, *::after { transition-duration: 0s !important; }"),
  );
  document.head.appendChild(css);

  root.classList.remove("light", "dark", "auto");
  const newTheme = themeMode === "auto" ? getSystemTheme() : themeMode;
  root.classList.add(newTheme);

  if (themeMode === "auto") {
    root.classList.add("auto");
  }

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[newTheme]);

  // Force a synchronous reflow with the transition-disable style applied,
  // then immediately remove it. This is the paint barrier: replacing it
  // with `requestAnimationFrame` lets the browser repaint between the
  // class swap and the style removal, briefly showing a transition flash.
  // Don't change.
  window.getComputedStyle(root).getPropertyValue("color");
  document.head.removeChild(css);
};

const setupPreferredListener = (onchange: () => void) => {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    updateThemeClass("auto");
    onchange();
  };
  mediaQuery.addEventListener("change", handler);
  return () => mediaQuery.removeEventListener("change", handler);
};

const getNextTheme = (current: ThemeMode): ThemeMode => {
  const themes: ThemeMode[] =
    getSystemTheme() === "dark" ? ["auto", "light", "dark"] : ["auto", "dark", "light"];
  return themes[(themes.indexOf(current) + 1) % themes.length]!;
};

/**
 * Pure function backing `ThemeProvider`'s `useState` lazy initializer:
 * reads the class the inline script already wrote to `<html>`.
 */
export function computeInitialThemeMode(classList: {
  contains: (cls: string) => boolean;
}): ThemeMode {
  if (classList.contains("auto")) return "auto";
  if (classList.contains("dark")) return "dark";
  if (classList.contains("light")) return "light";
  return "auto";
}

interface ThemeContextProps {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
  toggleMode: () => void;
}
const ThemeContext = React.createContext<ThemeContextProps | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // See the file-level docs above for why this is a lazy initializer
  // rather than a useEffect-driven sync.
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() =>
    computeInitialThemeMode(document.documentElement.classList),
  );
  // Bumped when the system preference flips while in "auto", so that
  // `resolvedTheme` is computed again.
  const [, setSystemFlips] = React.useState(0);

  React.useEffect(() => {
    if (themeMode !== "auto") return;
    return setupPreferredListener(() => setSystemFlips((n) => n + 1));
  }, [themeMode]);

  // Another tab of the app changed the theme: follow it.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = isThemeMode(event.newValue) ? event.newValue : "auto";
      setThemeMode(next);
      updateThemeClass(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const resolvedTheme = themeMode === "auto" ? getSystemTheme() : themeMode;

  const setTheme = React.useCallback((newTheme: ThemeMode) => {
    setThemeMode(newTheme);
    setStoredThemeMode(newTheme);
    updateThemeClass(newTheme);
  }, []);

  const toggleMode = React.useCallback(() => {
    setThemeMode((current) => {
      const next = getNextTheme(current);
      setStoredThemeMode(next);
      updateThemeClass(next);
      return next;
    });
  }, []);

  const memoVal = React.useMemo(
    () => ({ themeMode, resolvedTheme, setTheme, toggleMode }),
    [themeMode, resolvedTheme, setTheme, toggleMode],
  );

  return <ThemeContext value={memoVal}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = React.use(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
