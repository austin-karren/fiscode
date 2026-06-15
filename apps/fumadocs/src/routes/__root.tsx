import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import * as React from "react";

import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0a0a0a" },
      { title: "fiscode docs" },
      {
        name: "description",
        content:
          "Documentation for fiscode — a local-only tax estimator and time tracker for self-employed work. Not tax advice — use at your own risk.",
      },
      { property: "og:title", content: "fiscode docs" },
      {
        property: "og:description",
        content:
          "Documentation for fiscode — a local-only tax estimator and time tracker for self-employed work. Not tax advice — use at your own risk.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://docs.fiscode.app" },
      { property: "og:site_name", content: "fiscode docs" },
      { property: "og:image", content: "https://docs.fiscode.app/icon.svg" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "fiscode docs" },
      {
        name: "twitter:description",
        content:
          "Documentation for fiscode — a local-only tax estimator and time tracker for self-employed work. Not tax advice — use at your own risk.",
      },
      { name: "twitter:image", content: "https://docs.fiscode.app/icon.svg" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/icon.svg" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
