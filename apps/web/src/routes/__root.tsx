import { Toaster } from "@fiscode/ui/components/sonner";
import { SidebarProvider, SidebarTrigger } from "@fiscode/ui/components/sidebar";
import { Separator } from "@fiscode/ui/components/separator";
import { TooltipProvider } from "@fiscode/ui/components/tooltip";
import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { AppSidebar } from "../components/app-sidebar";
import { ErrorEmpty } from "../components/empty-states/error";
import { NotFoundEmpty } from "../components/empty-states/not-found";
import { MAIN_ID, routeLabel } from "../lib/nav";

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
  return (
    <TooltipProvider delay={200}>
      {/* First in tab order, so a keyboard user can pass the sidebar. Focus is
          moved by hand: a hash link would be taken as a route change. */}
      <a
        href={`#${MAIN_ID}`}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById(MAIN_ID)?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <SidebarProvider>
        <AppSidebar />
        {/* SidebarInset's markup, as a div: it renders a <main>, and the page
            content below is the one main landmark. */}
        <div className="relative flex w-full flex-1 flex-col bg-background">
          <header className="flex h-12 shrink-0 items-center gap-2 bg-background/80 px-3 backdrop-blur sticky top-0 z-10">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
            <span data-testid="header-label" className="text-sm text-muted-foreground">
              {routeLabel(pathname)}
            </span>
          </header>
          <Separator orientation="horizontal" className="w-full" />
          <main id={MAIN_ID} tabIndex={-1} className="@container px-4 py-6 outline-none md:px-8">
            <Outlet />
          </main>
        </div>
        <Toaster richColors />
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      </SidebarProvider>
    </TooltipProvider>
  );
}
