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
  useSidebar,
} from "@fiscode/ui/components/sidebar";
import { Link, useLocation } from "@tanstack/react-router";
import { BookOpen, Github } from "lucide-react";

import { useRef } from "react";

import { MAIN_ID, NAV_GROUPS, isNavItemActive } from "../lib/nav";

const EXTERNAL_LINKS = [
  { href: "https://docs.fiscode.app", label: "Docs", icon: BookOpen },
  { href: "https://github.com/austin-karren/fiscode", label: "GitHub", icon: Github },
] as const;

export function AppSidebar() {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  // On a phone the nav is a sheet over the page: picking a destination closes
  // it, otherwise the new page stays hidden behind it. Focus then goes to the
  // new page instead of back to the button that opened the sheet.
  const pickedDestination = useRef(false);
  const closeSheet = isMobile
    ? () => {
        pickedDestination.current = true;
        setOpenMobile(false);
      }
    : undefined;
  const focusAfterSheet = () => {
    if (!pickedDestination.current) return true;
    pickedDestination.current = false;
    // Focused by hand: handed an element that is not tabbable itself, the
    // dialog would focus the first control inside it instead.
    document.getElementById(MAIN_ID)?.focus();
    return false;
  };
  return (
    <Sidebar collapsible="icon" mobileFinalFocus={focusAfterSheet}>
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
      {/* The groups scroll when the window is short, in the icon rail too, and
          show a thin scrollbar so the pinned footer does not read as covering
          them. */}
      <SidebarContent
        role="navigation"
        aria-label="Main"
        className="[scrollbar-width:thin]! group-data-[collapsible=icon]:overflow-x-hidden group-data-[collapsible=icon]:overflow-y-auto"
      >
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            {/* Collapsed, the label is invisible but still lies over the last
                item of the group above; it must not take that item's clicks. */}
            <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = isNavItemActive(item, pathname);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={
                          <Link to={item.to} onClick={closeSheet}>
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
      <SidebarFooter className="gap-0 border-t border-sidebar-border">
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">
            Reference
          </SidebarGroupLabel>
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
