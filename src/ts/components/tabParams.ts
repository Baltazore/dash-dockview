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

type GridNode = {
  type?: unknown;
  data?: unknown;
  size?: unknown;
  visible?: unknown;
};

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

// Rounding to 4 decimals leaves a sum of fractions up to 0.00005 per child
// away from 1. A sum inside this bound is already normalized. Dividing it
// again could move a fraction by 0.0001 and break idempotency.
const NORMALIZED_SUM_TOLERANCE = 1e-3;

function normalizeBranch(node: GridNode) {
  if (node.type !== "branch" || !Array.isArray(node.data)) {
    return;
  }
  const children = node.data as GridNode[];
  const visibleSum = children
    .filter((child) => child.visible !== false)
    .reduce((sum, child) => sum + Number(child.size), 0);
  const normalized = Math.abs(visibleSum - 1) <= NORMALIZED_SUM_TOLERANCE;
  children.forEach((child) => {
    if (!normalized && visibleSum > 0) {
      child.size = round4(Number(child.size) / visibleSum);
    }
    normalizeBranch(child);
  });
}

// Dockview writes node sizes in pixels, and the container size into
// grid.width and grid.height. A resize changes all of them. The layout that
// Dash stores holds sizes as fractions instead, so it does not depend on the
// viewport. Each child gets its share of the visible siblings. A hidden child
// is outside the sum and keeps a share of it for when it shows again. The
// root and the grid box become 1. fromJSON accepts these sizes, because it
// uses them only as ratios and then lays out to the live container.
export function normalizeLayout<T extends object>(serialized: T): T {
  const copy = JSON.parse(JSON.stringify(serialized)) as T;
  const grid = (copy as { grid?: { root?: GridNode } }).grid;
  const root = grid?.root;
  if (!grid || !root || root.type !== "branch") {
    return copy;
  }
  normalizeBranch(root);
  root.size = 1;
  Object.assign(grid, { width: 1, height: 1 });
  return copy;
}
