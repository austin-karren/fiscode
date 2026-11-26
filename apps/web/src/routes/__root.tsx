import { Toaster } from "@fiscode/ui/components/sonner";
import { SidebarProvider, SidebarTrigger } from "@fiscode/ui/components/sidebar";
import { Separator } from "@fiscode/ui/components/separator";
import { TooltipProvider } from "@fiscode/ui/components/tooltip";
import { profileRepo } from "@fiscode/db";
import { Outlet, createRootRoute, useLoaderData, useLocation } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { AppSidebar } from "../components/app-sidebar";
import { ErrorEmpty } from "../components/empty-states/error";
import { NotFoundEmpty } from "../components/empty-states/not-found";
import { SetupRequiredEmpty } from "../components/empty-states/setup-required";
import { Page } from "../components/page";
import { VaultMigrationBanner } from "../components/vault-migration-banner";
import { VaultReconnectBanner } from "../components/vault-reconnect-banner";
import { MAIN_ID, routeLabel } from "../lib/nav";

export const Route = createRootRoute({
  // Read on every navigation, so finishing setup (or restoring a backup)
  // opens the app on the next screen without a reload.
  loader: async () => ({ hasProfile: (await profileRepo.get()) !== undefined }),
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

// Every screen but setup works on data that needs a profile (filing status,
// state, SE start). Until one exists they show the way to set up or restore.
const OPEN_BEFORE_SETUP = ["/setup"];

function RootLayout() {
  const { pathname } = useLocation();
  // Undefined while there is no root loader (a test's stand-in root).
  const root = useLoaderData({ from: "__root__" }) as { hasProfile: boolean } | undefined;
  const needsSetup =
    root?.hasProfile === false && !OPEN_BEFORE_SETUP.some((p) => pathname.startsWith(p));
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
          <header className="flex h-12 shrink-0 items-center gap-2 bg-background/80 px-3 backdrop-blur sticky top-0 z-10 print:hidden">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
            <span data-testid="header-label" className="text-sm text-muted-foreground">
              {routeLabel(pathname)}
            </span>
          </header>
          <Separator orientation="horizontal" className="w-full print:hidden" />
          <main
            id={MAIN_ID}
            tabIndex={-1}
            className="@container px-4 py-6 outline-none md:px-8 print:p-0"
          >
            <VaultMigrationBanner />
            <VaultReconnectBanner />
            {needsSetup ? (
              <Page title={routeLabel(pathname)}>
                <SetupRequiredEmpty />
              </Page>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
        <Toaster richColors />
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      </SidebarProvider>
    </TooltipProvider>
  );
}
