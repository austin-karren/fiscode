import { afterEach, describe, expect, it } from "vitest";

import { focusAfterRemoval } from "./focus-after-removal";
import { MAIN_ID } from "./nav";

afterEach(() => {
  document.body.innerHTML = "";
});

const page = (rows: string[]) => {
  document.body.innerHTML = `
    <main id="${MAIN_ID}" tabindex="-1">
      <table><tbody>${rows.map((r) => `<tr><td><button>Edit ${r}</button><button>Delete ${r}</button></td></tr>`).join("")}</tbody></table>
    </main>`;
  return (name: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === name)!;
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

describe("focusAfterRemoval", () => {
  it("moves to the next row's first control", async () => {
    const button = page(["a", "b"]);
    const refocus = focusAfterRemoval(button("Delete a"));
    button("Delete a").closest("tr")!.remove();
    refocus();
    await nextFrame();
    expect(document.activeElement).toBe(button("Edit b"));
  });

  it("moves to main when the only row's table is replaced by an empty state", async () => {
    const button = page(["only"]);
    const refocus = focusAfterRemoval(button("Delete only"));
    refocus();
    // The re-render lands after refocus is called: the table gives way to
    // an empty state.
    document.querySelector("table")!.replaceWith(document.createElement("p"));
    await nextFrame();
    expect(document.activeElement).toBe(document.getElementById(MAIN_ID));
  });
});

describe("focusAfterRemoval with a list", () => {
  it("stays on a list that keeps showing after its only item goes", async () => {
    document.body.innerHTML = `<main id="${MAIN_ID}" tabindex="-1"><ul><li><button>Delete only</button></li></ul></main>`;
    const refocus = focusAfterRemoval(document.querySelector("button")!);
    document.querySelector("li")!.remove();
    refocus();
    await nextFrame();
    expect(document.activeElement).toBe(document.querySelector("ul"));
  });
});
