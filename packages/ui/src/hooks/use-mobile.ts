import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

const isMobileNow = () => window.innerWidth < MOBILE_BREAKPOINT;

export function useIsMobile() {
  // Read the viewport on each render, re-rendering when the query flips.
  return React.useSyncExternalStore(subscribe, isMobileNow, () => false);
}
