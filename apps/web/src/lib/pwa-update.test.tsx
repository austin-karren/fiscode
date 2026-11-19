import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerServiceWorker, type RegisterSW } from "./pwa-update";

afterEach(cleanup);

const setup = () => {
  const applyUpdate = vi.fn(async () => undefined);
  let options: Parameters<RegisterSW>[0] = {};
  registerServiceWorker((o) => {
    options = o;
    return applyUpdate;
  });
  render(<Toaster />);
  return { applyUpdate, options: () => options };
};

describe("service worker update", () => {
  it("does not reload on its own when a new version is waiting", async () => {
    const { applyUpdate, options } = setup();
    options().onNeedRefresh!();
    expect(await screen.findByText("Update available")).toBeInTheDocument();
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("applies the update and reloads when Reload is pressed", async () => {
    const { applyUpdate, options } = setup();
    options().onNeedRefresh!();
    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));
    expect(applyUpdate).toHaveBeenCalledWith(true);
  });

  it("warns that Reload reloads every open tab", async () => {
    const { options } = setup();
    options().onNeedRefresh!();
    expect(
      await screen.findByText(
        /This reloads every open fiscode tab, and unsaved form input is lost\./,
      ),
    ).toBeInTheDocument();
  });

  it("can be put off with Later, without applying the update", async () => {
    const { applyUpdate, options } = setup();
    options().onNeedRefresh!();
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByText("Update available")).not.toBeInTheDocument());
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("says once when the app is ready to work offline", async () => {
    const { options } = setup();
    options().onOfflineReady!();
    expect(await screen.findByText("Ready to work offline.")).toBeInTheDocument();
  });
});
