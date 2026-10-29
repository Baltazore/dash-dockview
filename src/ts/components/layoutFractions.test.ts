import { DockviewComponent } from "dockview-core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { normalizeLayout } from "./tabParams";

// jsdom has no ResizeObserver. The test sizes the component with layout().
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const WIDTH = 1200;
const HEIGHT = 800;

function makeComponent() {
  const component = new DockviewComponent(document.createElement("div"), {
    createComponent: () => ({
      element: document.createElement("div"),
      init() {},
      dispose() {},
    }),
  });
  component.layout(WIDTH, HEIGHT);
  return component;
}

const widthOf = (component: DockviewComponent, panelId: string) =>
  component.api.getPanel(panelId)!.group.api.width;

function leafSizes(layout: ReturnType<DockviewComponent["toJSON"]>) {
  const root = layout.grid.root as {
    data: { type: string; size: number }[];
  };
  return root.data.map((node) => node.size);
}

describe("layout sizes as fractions, against dockview-core", () => {
  let pixels: ReturnType<DockviewComponent["toJSON"]>;
  let fractions: ReturnType<DockviewComponent["toJSON"]>;

  beforeAll(() => {
    const component = makeComponent();
    component.api.addPanel({ id: "a", component: "x" });
    component.api.addPanel({
      id: "b",
      component: "x",
      position: { referencePanel: "a", direction: "right" },
    });
    component.api.getPanel("b")!.group.api.setSize({ width: 300 });
    pixels = component.toJSON();
    fractions = normalizeLayout(pixels);
  });

  it("stores a 900/300 split as 0.75 and 0.25 in a 1x1 box", () => {
    const [a, b] = leafSizes(fractions);
    expect(leafSizes(pixels)).toEqual([900, 300]);
    expect(a).toBeCloseTo(0.75, 3);
    expect(b).toBeCloseTo(0.25, 3);
    expect(fractions.grid.width).toBe(1);
    expect(fractions.grid.height).toBe(1);
  });

  it("restores the fractions to the live width and keeps them on a resize", () => {
    const component = makeComponent();
    component.fromJSON(fractions);

    expect([widthOf(component, "a"), widthOf(component, "b")]).toEqual([
      900, 300,
    ]);

    component.api.layout(600, 400);

    expect([widthOf(component, "a"), widthOf(component, "b")]).toEqual([
      450, 150,
    ]);
  });

  it("gives the same fractions for the pixel layout as for the fractions", () => {
    const component = makeComponent();
    component.fromJSON(pixels);

    expect(normalizeLayout(component.toJSON())).toEqual(fractions);
  });
});
