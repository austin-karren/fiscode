import {
  Briefcase,
  Car,
  Clock,
  CloudDownload,
  Coins,
  FileSpreadsheet,
  Gauge,
  History,
  Home,
  Receipt,
  UserCircle2,
} from "lucide-react";

/** Id of the page's one main landmark: the skip link and the nav sheet send focus there. */
export const MAIN_ID = "main-content";

// The one place a route gets its name: the sidebar and the header bar both
// read it from here.
export const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: Gauge, exact: true }],
  },
  {
    label: "Track",
    items: [
      { to: "/income", label: "Income", icon: Coins },
      { to: "/expenses", label: "Expenses", icon: Receipt },
      { to: "/mileage", label: "Mileage", icon: Car },
      { to: "/time", label: "Time", icon: Clock },
    ],
  },
  {
    label: "Configure",
    items: [
      { to: "/clients", label: "Clients", icon: Briefcase },
      { to: "/vehicles", label: "Vehicles", icon: Car },
      { to: "/home-office", label: "Home office", icon: Home },
      { to: "/profile", label: "Profile", icon: UserCircle2 },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/year-end", label: "Year-end", icon: FileSpreadsheet },
      { to: "/history", label: "History", icon: History },
    ],
  },
  {
    label: "Settings",
    items: [{ to: "/tax-data", label: "Tax data", icon: CloudDownload }],
  },
] as const;

type NavItem = (typeof NAV_GROUPS)[number]["items"][number];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return "exact" in item && item.exact ? pathname === item.to : pathname.startsWith(item.to);
}

// Screens that are reachable but not listed in the sidebar.
const UNLISTED_LABELS: Record<string, string> = { "/setup": "Setup" };

/** The name of the screen at `pathname`; never empty. */
export function routeLabel(pathname: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isNavItemActive(item, pathname)) return item.label;
    }
  }
  return UNLISTED_LABELS[pathname.replace(/\/$/, "")] ?? "fiscode";
}
