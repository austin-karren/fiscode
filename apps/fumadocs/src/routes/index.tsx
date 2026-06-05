import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Home,
  // keep this until we have a proper landing page
  beforeLoad: async () => {
    throw redirect({ to: "/docs/$", params: { _splat: "" } });
  },
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-col flex-1 justify-center px-4 py-8 text-center gap-4">
        <h1 className="font-semibold text-3xl">fiscode docs</h1>
        <p className="text-fd-muted-foreground max-w-xl mx-auto">
          A local-only PWA tax estimator + time tracker for 1099 / self-employed work. All data
          stays on-device; CSV is the lossless source of truth.
        </p>
        <Link
          to="/docs/$"
          params={{
            _splat: "",
          }}
          className="px-3 py-2 rounded-lg bg-fd-primary text-fd-primary-foreground font-medium text-sm mx-auto"
        >
          Open docs
        </Link>
      </div>
    </HomeLayout>
  );
}
