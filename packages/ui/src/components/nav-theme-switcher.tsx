import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { useTheme, type ThemeMode } from "./theme";

const THEME_LABELS: Record<ThemeMode, string> = {
  light: "Light theme",
  auto: "System theme",
  dark: "Dark theme",
};

/** Segmented light / system / dark control for a sidebar. */
export function NavThemeSwitcher({ className }: { className?: string }) {
  const { themeMode, setTheme } = useTheme();

  return (
    <Tabs value={themeMode} onValueChange={(v) => setTheme(v as ThemeMode)} className={className}>
      <TabsList className="w-full border border-border" variant="default" aria-label="Theme">
        <TabsTrigger value="light" aria-label={THEME_LABELS.light} title="Light">
          <SunIcon className="size-3" />
        </TabsTrigger>
        <TabsTrigger value="auto" aria-label={THEME_LABELS.auto} title="System">
          <MonitorIcon className="size-3" />
        </TabsTrigger>
        <TabsTrigger value="dark" aria-label={THEME_LABELS.dark} title="Dark">
          <MoonIcon className="size-3" />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

const THEME_ICONS = { light: SunIcon, auto: MonitorIcon, dark: MoonIcon };

/** What the single cycling button shows for the current mode. */
export function useThemeCycle() {
  const { themeMode, toggleMode } = useTheme();
  return { Icon: THEME_ICONS[themeMode], label: THEME_LABELS[themeMode], toggleMode };
}
