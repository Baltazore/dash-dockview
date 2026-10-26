import {
  DockviewTheme,
  themeAbyss,
  themeAbyssSpaced,
  themeDark,
  themeDracula,
  themeLight,
  themeLightSpaced,
  themeVisualStudio,
} from "dockview-react";

export type PanelPosition = "right" | "left" | "above" | "below" | "within";

/**
 * What a tab draws for the group state of its panel. The wrapper does not
 * know what a group is. Python decides which kind and which label to send.
 */
export type TabBadge =
  | { kind: "none" }
  | { kind: "ungrouped" }
  | { kind: "group"; label: string };

export type TabMenuIcon = "group" | "plus";

/** One row of the menu under the badge. The wrapper never reads `id`. */
export interface TabMenuItem {
  id: string;
  label: string;
  icon?: TabMenuIcon;
}

/** The tab fields of a panel. Dockview hands them to the tab as `params`. */
export interface TabParams {
  /** An image URL, drawn as a 16 px image before the title. */
  icon?: string;
  /** An absent badge means `{ kind: "none" }`. */
  badge?: TabBadge;
  menu?: TabMenuItem[];
}

export interface PanelDef extends TabParams {
  id: string;
  title?: string;
  position?: PanelPosition;
  referencePanel?: string;
  referenceGroup?: string;
}

export interface TabMenuAction {
  panelId: string;
  itemId: string;
  at: number;
}

export interface PanelAddedEvent {
  panelId: string;
  title: string;
  groupId: string;
}

export interface PanelRemovedEvent {
  panelId: string;
}

export interface ActivePanelEvent {
  panelId: string | null;
  groupId: string | null;
}

export const DEFAULT_THEME_NAME = "dockview-theme-abyss";

// Class-name strings and short aliases that Python passes as `theme`.
// dockview 8.6.1 ships no replit theme, so "replit" falls back to abyss.
export const THEMES: Readonly<Record<string, DockviewTheme>> = {
  "dockview-theme-abyss": themeAbyss,
  "dockview-theme-abyss-spaced": themeAbyssSpaced,
  "dockview-theme-light": themeLight,
  "dockview-theme-light-spaced": themeLightSpaced,
  "dockview-theme-dark": themeDark,
  "dockview-theme-dracula": themeDracula,
  "dockview-theme-vs": themeVisualStudio,
  abyss: themeAbyss,
  "abyss-spaced": themeAbyssSpaced,
  light: themeLight,
  "light-spaced": themeLightSpaced,
  dark: themeDark,
  dracula: themeDracula,
  vs: themeVisualStudio,
  "visual-studio": themeVisualStudio,
};
