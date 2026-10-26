import type { PanelDef, TabParams } from "./types";

export const tabParamsOf = ({ icon, badge, menu }: PanelDef): TabParams => ({
  icon,
  badge,
  menu,
});

// Dockview writes panel params into the layout. The panels prop owns the tab
// fields, so they stay out of the layout that Dash stores. Otherwise a
// restored layout would bring back the badge from the day it was saved.
export function stripPanelParams<T extends { panels?: unknown }>(layout: T): T {
  const panels = layout.panels;
  if (panels && typeof panels === "object") {
    Object.values(panels).forEach((panel) => {
      if (panel && typeof panel === "object") {
        delete (panel as { params?: unknown }).params;
      }
    });
  }
  return layout;
}
