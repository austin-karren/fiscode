import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({
  state: "prompt" as "opfs" | "granted" | "prompt" | "denied",
  request: vi.fn(),
}));
vi.mock("@fiscode/db", () => ({
  onVaultChange: () => () => {},
  vaultPermissionState: async () => vault.state,
  requestVaultPermission: vault.request,
}));

import { VaultReconnectBanner } from "./vault-reconnect-banner";

beforeEach(() => {
  vault.state = "prompt";
  vault.request.mockReset();
});
afterEach(() => cleanup());

describe("VaultReconnectBanner (ADR 0001 § 11.1)", () => {
  it("shows the reconnect line when the folder is not granted", async () => {
    render(<VaultReconnectBanner />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Reconnect to see your files");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("stays hidden for OPFS and when granted", async () => {
    vault.state = "opfs";
    render(<VaultReconnectBanner />);
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("goes away once the permission is granted", async () => {
    vault.request.mockResolvedValue("granted");
    render(<VaultReconnectBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    await act(async () => {});
    expect(vault.request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
