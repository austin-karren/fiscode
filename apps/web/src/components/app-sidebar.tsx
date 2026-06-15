import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@fiscode/ui/components/sidebar";
import { Link, useLocation } from "@tanstack/react-router";
import {
  BookOpen,
  Briefcase,
  Car,
  Clock,
  CloudDownload,
  Coins,
  FileSpreadsheet,
  Gauge,
  Github,
  History,
  Home,
  Receipt,
  UserCircle2,
} from "lucide-react";

const EXTERNAL_LINKS = [
  { href: "https://docs.fiscode.app", label: "Docs", icon: BookOpen },
  { href: "https://github.com/austin-karren/fiscode", label: "GitHub", icon: Github },
] as const;

const NAV_GROUPS = [
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

export function AppSidebar() {
  const { pathname } = useLocation();
  return (
    <Sidebar collapsible="icon">
      {/* Match the main app header (h-12) so the separator below this row
          aligns with the one beneath the main header. The wordmark + short
          mark are stacked — "fiscode" sits in normal flow and "fs" overlays
          absolutely as a centered short mark. Cross-fades are asymmetric so
          the visible glyph fades OUT quickly (before the rail starts moving
          much) and the OTHER glyph fades IN after the rail finishes its
          width transition. overflow-hidden on the header clips any in-flight
          overflow during the rail's resize. */}
      <SidebarHeader className="flex h-12 flex-row items-center overflow-hidden px-3 py-0">
        <div className="relative flex h-5 w-full items-center">
          {/* Fades OUT quickly when the rail collapses (so it doesn't
              overflow the shrinking width) and fades IN after the rail
              finishes expanding. delay-300 > the rail's 200ms width
              transition so it stays invisible until the rail reaches full
              width even on slower hardware. */}
          <span className="font-mono text-sm font-bold tracking-tight opacity-100 transition-opacity duration-150 delay-300 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:duration-75 group-data-[collapsible=icon]:delay-0">
            fiscode
          </span>
          {/* Mirrored timing on the short mark. */}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-sm font-bold tracking-tight opacity-0 transition-opacity duration-75 delay-0 group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:duration-150 group-data-[collapsible=icon]:delay-300">
            fs
          </span>
        </div>
      </SidebarHeader>
      <SidebarSeparator className="mx-0" />
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive =
                    "exact" in item && item.exact
                      ? pathname === item.to
                      : pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={
                          <Link to={item.to}>
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {/* Footer: external links group + tagline. Both collapse cleanly in
          icon mode — the links shrink to icon-only via SidebarMenuButton's
          collapsible behavior; the tagline fades out with the wordmark's
          asymmetric timing (out fast on collapse, in late on expand). */}
      <SidebarFooter className="gap-0">
        <SidebarGroup className="py-1">
          <SidebarGroupLabel>Reference</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {EXTERNAL_LINKS.map((link) => (
                <SidebarMenuItem key={link.href}>
                  <SidebarMenuButton
                    tooltip={link.label}
                    render={
                      <a href={link.href} target="_blank" rel="noopener noreferrer">
                        <link.icon />
                        <span>{link.label}</span>
                      </a>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <div className="overflow-hidden whitespace-nowrap transition-[max-height] duration-150 delay-300 max-h-8 group-data-[collapsible=icon]:max-h-0 group-data-[collapsible=icon]:duration-75 group-data-[collapsible=icon]:delay-0">
          <div className="px-2 py-1 text-xs text-muted-foreground opacity-100 transition-discrete duration-150 delay-300 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:duration-75 group-data-[collapsible=icon]:delay-0">
            local-only · CSV is source of truth
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
