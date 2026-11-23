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

// SQLite over OPFS does not exist in jsdom: the profile store is a variable.
// Saving setup writes it, as the real repo would.
const { store } = vi.hoisted(() => ({ store: { profile: undefined as object | undefined } }));

vi.mock("@fiscode/db", () => ({
  // The vault migration is done: every write is on (vault PR 9).
  getVaultMigrationState: (
    (done) => () =>
      done
  )({ phase: "done" }),
  onVaultMigrationState: () => () => {},

  profileRepo: {
    get: async () => store.profile,
    exists: async () => store.profile !== undefined,
    upsert: async (p: object) => {
      store.profile = p;
    },
  },
  entityRepo: { list: async () => [], create: async () => {} },
  buildBundle: vi.fn(),
  importBundle: vi.fn(),
}));

import { ThemeProvider } from "@fiscode/ui/components/theme";

import { Route as RootRoute } from "./__root";
import { Route as SetupRoute } from "./setup";

// The real root (its loader and layout) and the real setup screen; the other
// screens are stand-ins, since they need the database.
function renderApp(path: string) {
  const root = createRootRoute({
    component: RootRoute.options.component,
    loader: RootRoute.options.loader,
  });
  const setup = createRoute({
    getParentRoute: () => root,
    path: "/setup",
    component: SetupRoute.options.component,
  });
  const stand = (p: string) =>
    createRoute({
      getParentRoute: () => root,
      path: p,
      component: () => <h1>Page {p}</h1>,
    });
  const router = createRouter({
    routeTree: root.addChildren([setup, stand("/"), stand("/income")]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

const pickOption = async (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
};

const fillSetup = async () => {
  await pickOption("Filing status", "Single");
  const state = screen.getByLabelText("State of residence");
  fireEvent.change(state, { target: { value: "Utah" } });
  fireEvent.keyDown(state, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: /Utah/ }));
  fireEvent.click(screen.getByLabelText("Self-employment start date"));
  const grid = await screen.findByRole("grid");
  fireEvent.click(
    within(grid)
      .getAllByRole("button")
      .find((b) => !(b as HTMLButtonElement).disabled)!,
  );
  await pickOption("Entity type", "Sole proprietor");
};

beforeEach(() => {
  store.profile = undefined;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(cleanup);

describe("finishing setup under the real root", () => {
  it("opens the app on the next screen, without a reload", { timeout: 15000 }, async () => {
    const router = renderApp("/income");
    await screen.findByText("Set up fiscode first");

    fireEvent.click(screen.getByRole("link", { name: "Run setup" }));
    await screen.findByRole("button", { name: "Save and continue" });
    await fillSetup();
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    await screen.findByRole("heading", { name: "Page /" }, { timeout: 5000 });
    expect(screen.queryByText("Set up fiscode first")).not.toBeInTheDocument();

    await router.navigate({ to: "/income" });
    await screen.findByRole("heading", { name: "Page /income" });
    expect(screen.queryByText("Set up fiscode first")).not.toBeInTheDocument();
  });
});
