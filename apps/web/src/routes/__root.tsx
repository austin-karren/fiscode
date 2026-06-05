import { Toaster } from "@fiscode/ui/components/sonner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@fiscode/ui/components/sidebar";
import { Separator } from "@fiscode/ui/components/separator";
import { TooltipProvider } from "@fiscode/ui/components/tooltip";
import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { AppSidebar } from "../components/app-sidebar";
import { ErrorEmpty } from "../components/empty-states/error";
import { NotFoundEmpty } from "../components/empty-states/not-found";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error, reset }) => (
    <FullPageWrap>
      <ErrorEmpty error={error} reset={reset} />
    </FullPageWrap>
  ),
  notFoundComponent: () => (
    <FullPageWrap>
      <NotFoundEmptyWrapper />
    </FullPageWrap>
  ),
});

function NotFoundEmptyWrapper() {
  const { pathname } = useLocation();
  return <NotFoundEmpty pathname={pathname} />;
}

function FullPageWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-2xl items-center justify-center p-6">
      {children}
    </div>
  );
}

function RootLayout() {
  const { pathname } = useLocation();
  // format pathname to remove slashes and upper case first letter
  const formattedPathname = pathname.replace(/^\/|\/$/g, "").replace(/^./, (m) => m.toUpperCase());
  return (
    <TooltipProvider delay={200}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 bg-background/80 px-3 backdrop-blur sticky top-0 z-10">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
            <span className="font-mono text-sm font-medium tracking-tight">
              {formattedPathname}
            </span>
          </header>
          <Separator orientation="horizontal" className="w-full" />
          <main className="@container px-4 py-6 md:px-8">
            <Outlet />
          </main>
        </SidebarInset>
        <Toaster richColors />
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      </SidebarProvider>
    </TooltipProvider>
  );
}
