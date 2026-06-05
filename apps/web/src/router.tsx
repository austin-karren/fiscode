import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

// Local-only SPA: no SSR, no Suspense skeletons. Reads from SQLocal are
// effectively synchronous from the user's perspective.
export const router = createRouter({
  routeTree,
  scrollRestoration: true,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultNotFoundComponent: () => <div className="p-6">Not Found</div>,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
