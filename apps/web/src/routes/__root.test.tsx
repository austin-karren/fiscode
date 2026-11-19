import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router-devtools", () => ({ TanStackRouterDevtools: () => null }));

import { ThemeProvider } from "@fiscode/ui/components/theme";

import { routeLabel } from "../lib/nav";
import { Route } from "./__root";

const RootLayout = Route.options.component!;

const PATHS = {
  "/": "Dashboard",
  "/income": "Income",
  "/expenses": "Expenses",
  "/mileage": "Mileage",
  "/time": "Time",
  "/clients": "Clients",
  "/vehicles": "Vehicles",
  "/home-office": "Home office",
  "/profile": "Profile",
  "/year-end": "Year-end",
  "/history": "History",
  "/tax-data": "Tax data",
  "/setup": "Setup",
} as const;

// The real layout around stand-in pages: the real pages need the database.
async function renderAt(path: string) {
  const root = createRootRoute({ component: RootLayout });
  const pages = Object.keys(PATHS).map((p) =>
    createRoute({
      getParentRoute: () => root,
      path: p,
      component: () => (
        <>
          <h1>Page {p}</h1>
          <button type="button">In the page</button>
        </>
      ),
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren(pages),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  // As in main.tsx: the sidebar's theme switcher needs the provider.
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  await screen.findByRole("heading", { name: `Page ${path}` });
  return router;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

beforeEach(() => {
  setViewportWidth(1440);
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(cleanup);

const headerLabel = () => screen.getByTestId("header-label");

describe("root layout", () => {
  it.each(Object.entries(PATHS))(
    "names the screen at %s as %s in the header",
    async (path, label) => {
      await renderAt(path);
      expect(headerLabel()).toHaveTextContent(new RegExp(`^${label}$`));
    },
  );

  it("names a screen by whole path segments", () => {
    expect(routeLabel("/income/")).toBe("Income");
    expect(routeLabel("/timeline")).toBe("fiscode");
  });

  it("has one main landmark, holding the page", async () => {
    await renderAt("/income");
    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(within(mains[0]!).getByRole("heading", { name: "Page /income" })).toBeInTheDocument();
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("labels the sidebar links as the main navigation", async () => {
    await renderAt("/income");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Tax data" })).toBeInTheDocument();
  });

  it("puts a skip link first in tab order that moves focus to the page", async () => {
    await renderAt("/income");
    const skip = screen.getByRole("link", { name: "Skip to content" });
    const tabbable = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(tabbable[0]).toBe(skip);

    fireEvent.click(skip);
    expect(screen.getByRole("main")).toHaveFocus();
  });

  describe("on a phone", () => {
    beforeEach(() => setViewportWidth(390));

    const openSheet = async () => {
      const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
      trigger.focus();
      fireEvent.click(trigger);
      return screen.findByRole("dialog");
    };

    it("closes the nav sheet and shows the new page when a destination is picked", async () => {
      const router = await renderAt("/income");
      const sheet = await openSheet();

      fireEvent.click(within(sheet).getByRole("link", { name: "Mileage" }));

      // The route change and the sheet's close transition can take over the
      // default second while the whole suite runs in parallel.
      const slow = { timeout: 5000 };
      await screen.findByRole("heading", { name: "Page /mileage" }, slow);
      expect(router.state.location.pathname).toBe("/mileage");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), slow);
      expect(headerLabel()).toHaveTextContent("Mileage");
      await waitFor(() => expect(screen.getByRole("main")).toHaveFocus(), slow);
    });

    it("keeps the sheet open when a theme is picked in it", async () => {
      await renderAt("/income");
      const sheet = await openSheet();

      fireEvent.click(within(sheet).getByRole("tab", { name: "Dark theme" }));

      expect(within(sheet).getByRole("tab", { name: "Dark theme" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(headerLabel()).toHaveTextContent("Income");
    });

    it("closes the sheet on Escape and gives focus back to the button that opened it", async () => {
      await renderAt("/income");
      const sheet = await openSheet();

      fireEvent.keyDown(sheet, { key: "Escape" });

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toHaveFocus(),
      );
    });
  });
});
