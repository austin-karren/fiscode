import { Link } from "@tanstack/react-router";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/income", label: "Income" },
  { to: "/expenses", label: "Expenses" },
  { to: "/mileage", label: "Mileage" },
  { to: "/clients", label: "Clients" },
  { to: "/time", label: "Time" },
  { to: "/year-end", label: "Year-end" },
  { to: "/data", label: "Data" },
  { to: "/profile", label: "Profile" },
] as const;

export function AppHeader() {
  return (
    <header className="border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
      <div className="flex items-center gap-6 px-4 py-3 md:px-8">
        <Link to="/" className="font-mono text-lg font-bold tracking-tight text-foreground">
          fiscode
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
