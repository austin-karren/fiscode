import { expect } from "vitest";

// What a stored value looks like when it leaks onto a screen: an ISO date
// ("2026-03-02"), or a snake_case enum key ("sole_prop", "software_subs").
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const SNAKE_KEY = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

/**
 * Fails when the visible text holds a stored key or an ISO date, or any of
 * `codes` (single-word keys the patterns cannot tell from words, such as
 * "consulting" or "simplified").
 */
export function expectNoRawValues(root: HTMLElement, codes: readonly string[] = []): void {
  const text = root.textContent ?? "";
  expect(text).not.toMatch(ISO_DATE);
  expect(text).not.toMatch(SNAKE_KEY);
  for (const code of codes) expect(text).not.toMatch(new RegExp(`\\b${code}\\b`));
}
