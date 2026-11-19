import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NavThemeSwitcher, useThemeCycle } from "@fiscode/ui/components/nav-theme-switcher";
import { ThemeProvider, useTheme } from "@fiscode/ui/components/theme";
import { THEME_COLORS, THEME_STORAGE_KEY, themeDetectorScript } from "@fiscode/ui/lib/theme-script";

// jsdom has no matchMedia. This one can flip the system preference and tells
// its listeners, like a browser does.
let systemDark = false;
let listeners: (() => void)[] = [];
const flipSystem = (dark: boolean) => {
  systemDark = dark;
  act(() => listeners.forEach((l) => l()));
};

const root = document.documentElement;
const themeColor = () =>
  document.querySelector('meta[name="theme-color"]')!.getAttribute("content");
const runInlineScript = () => new Function(themeDetectorScript)();

beforeEach(() => {
  systemDark = false;
  listeners = [];
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("dark") && systemDark;
    },
    addEventListener: (_: string, l: () => void) => listeners.push(l),
    removeEventListener: (_: string, l: () => void) => {
      listeners = listeners.filter((x) => x !== l);
    },
  })) as unknown as typeof window.matchMedia;
  // The test environment has no localStorage: a Map stands in for it.
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  root.className = "";
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
});

afterEach(cleanup);

describe("pre-paint theme script", () => {
  it.each([
    // stored, system dark, classes on <html>, theme-color
    [null, false, "light auto", THEME_COLORS.light],
    [null, true, "dark auto", THEME_COLORS.dark],
    ["auto", true, "dark auto", THEME_COLORS.dark],
    ["light", true, "light", THEME_COLORS.light],
    ["dark", false, "dark", THEME_COLORS.dark],
    ["nonsense", true, "dark auto", THEME_COLORS.dark],
  ])("stored %j, system dark %j → class %j", (stored, dark, classes, color) => {
    if (stored) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    systemDark = dark;
    runInlineScript();
    expect(root.className).toBe(classes);
    expect(themeColor()).toBe(color);
  });

  it("replaces a class left on <html> instead of adding to it", () => {
    root.className = "dark";
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    runInlineScript();
    expect(root.className).toBe("light");
  });

  it("falls back to the system theme when storage throws", () => {
    systemDark = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    runInlineScript();
    expect(root.className).toBe("dark auto");
  });

  it("uses the same storage key and colours as the provider", () => {
    expect(themeDetectorScript).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(themeDetectorScript).toContain(THEME_COLORS.light);
    expect(themeDetectorScript).toContain(THEME_COLORS.dark);
  });
});

function Probe() {
  const { themeMode, resolvedTheme } = useTheme();
  const { label, toggleMode } = useThemeCycle();
  return (
    <>
      <output data-testid="mode">{`${themeMode}/${resolvedTheme}`}</output>
      <button onClick={toggleMode}>{label}</button>
    </>
  );
}

const renderApp = () =>
  render(
    <ThemeProvider>
      <NavThemeSwitcher />
      <Probe />
    </ThemeProvider>,
  );

const mode = () => screen.getByTestId("mode").textContent;
const tab = (name: string) => screen.getByRole("tab", { name });

describe("theme provider and switcher", () => {
  it("starts from the class the inline script wrote, with no stored choice: System", () => {
    systemDark = true;
    runInlineScript();
    renderApp();
    expect(mode()).toBe("auto/dark");
    expect(tab("System theme")).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    ["Light theme", "light", "light", THEME_COLORS.light],
    ["Dark theme", "dark", "dark", THEME_COLORS.dark],
  ])("%s: sets the class, the theme-color and stores the choice", (name, stored, cls, color) => {
    runInlineScript();
    renderApp();
    fireEvent.click(tab(name));
    expect(root.className).toBe(cls);
    expect(themeColor()).toBe(color);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(stored);
    expect(tab(name)).toHaveAttribute("aria-selected", "true");
    expect(mode()).toBe(`${stored}/${cls}`);
  });

  it("System: follows the system and stores the choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    systemDark = true;
    runInlineScript();
    renderApp();
    expect(mode()).toBe("light/light");
    fireEvent.click(tab("System theme"));
    expect(root.className).toBe("dark auto");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("auto");
    expect(mode()).toBe("auto/dark");
  });

  it("follows a live system change while on System", () => {
    runInlineScript();
    renderApp();
    expect(mode()).toBe("auto/light");
    flipSystem(true);
    expect(root.className).toBe("dark auto");
    expect(themeColor()).toBe(THEME_COLORS.dark);
    expect(mode()).toBe("auto/dark");
    flipSystem(false);
    expect(root.className).toBe("light auto");
    expect(mode()).toBe("auto/light");
  });

  it("ignores a system change while Light or Dark is chosen", () => {
    runInlineScript();
    renderApp();
    fireEvent.click(tab("Light theme"));
    flipSystem(true);
    expect(root.className).toBe("light");
    expect(mode()).toBe("light/light");
  });

  it("keeps the choice across a reload", () => {
    runInlineScript();
    renderApp();
    fireEvent.click(tab("Dark theme"));
    cleanup();
    root.className = "";
    runInlineScript();
    renderApp();
    expect(mode()).toBe("dark/dark");
    expect(tab("Dark theme")).toHaveAttribute("aria-selected", "true");
  });

  it("follows a change made in another tab", () => {
    runInlineScript();
    renderApp();
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }),
      );
    });
    expect(root.className).toBe("dark");
    expect(mode()).toBe("dark/dark");
  });

  it("leaves no transition-disabling style behind after a switch", () => {
    runInlineScript();
    renderApp();
    fireEvent.click(tab("Dark theme"));
    expect(document.head.querySelectorAll("style")).toHaveLength(0);
  });

  it("the single cycling button goes through all three modes", () => {
    runInlineScript();
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "System theme" }));
    expect(mode()).toBe("dark/dark");
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(mode()).toBe("light/light");
    fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
    expect(mode()).toBe("auto/light");
  });
});
