import { Toaster } from "@fiscode/ui/components/sonner";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { AppHeader } from "../components/app-header";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="grid min-h-svh grid-rows-[auto_1fr] bg-background text-foreground">
      <AppHeader />
      <main className="@container px-4 py-6 md:px-8">
        <Outlet />
      </main>
      <Toaster richColors />
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </div>
  );
}
