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

// Dockview writes the container size in pixels into grid.width and
// grid.height. A resize alone must not look like a new layout, so the
// comparison key leaves both out. The layout that Dash stores keeps them,
// because fromJSON uses them as the initial root size.
export function layoutKey(serialized: object): string {
  const { grid } = serialized as { grid?: unknown };
  if (!grid || typeof grid !== "object") {
    return JSON.stringify(serialized);
  }
  const { width: _width, height: _height, ...structure } = grid as {
    width?: unknown;
    height?: unknown;
  };
  return JSON.stringify({ ...serialized, grid: structure });
}
