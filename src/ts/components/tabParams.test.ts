import { describe, expect, it } from "vitest";

import { normalizeLayout } from "./tabParams";

const leaf = (id: string, size: number, visible?: boolean) => ({
  type: "leaf",
  data: { views: [id], activeView: id, id },
  size,
  ...(visible === undefined ? {} : { visible }),
});

const layoutOf = <R extends object>(root: R, width = 1200, height = 800) => ({
  grid: { root, width, height, orientation: "HORIZONTAL" },
  panels: { a: { id: "a" } },
  activeGroup: "1",
  floatingGroups: [{ data: { id: "f" }, position: { left: 10, width: 400 } }],
});

const twoLevels = () =>
  layoutOf({
    type: "branch",
    size: 800,
    data: [
      leaf("a", 300),
      {
        type: "branch",
        size: 900,
        data: [leaf("b", 100), leaf("c", 300)],
      },
    ],
  });

describe("normalizeLayout", () => {
  it("turns the pixel sizes of each branch into fractions of its children", () => {
    expect(normalizeLayout(twoLevels()).grid).toEqual({
      root: {
        type: "branch",
        size: 1,
        data: [
          leaf("a", 0.25),
          {
            type: "branch",
            size: 0.75,
            data: [leaf("b", 0.25), leaf("c", 0.75)],
          },
        ],
      },
      width: 1,
      height: 1,
      orientation: "HORIZONTAL",
    });
  });

  it("rounds a fraction to 4 decimals", () => {
    const root = {
      type: "branch",
      size: 800,
      data: [leaf("a", 100), leaf("b", 200)],
    };

    const [a, b] = normalizeLayout(layoutOf(root)).grid.root.data;

    expect([a.size, b.size]).toEqual([0.3333, 0.6667]);
  });

  it("leaves a hidden child out of the sum and gives it a share of that sum", () => {
    const root = {
      type: "branch",
      size: 800,
      data: [leaf("a", 600), leaf("b", 600), leaf("c", 300, false)],
    };

    const sizes = normalizeLayout(layoutOf(root)).grid.root.data.map(
      (node: { size: number }) => node.size,
    );

    expect(sizes).toEqual([0.5, 0.5, 0.25]);
  });

  it("leaves everything outside the grid sizes as it is", () => {
    const input = twoLevels();

    const output = normalizeLayout(input);

    expect(output.panels).toEqual(input.panels);
    expect(output.activeGroup).toEqual(input.activeGroup);
    expect(output.floatingGroups).toEqual(input.floatingGroups);
  });

  it("maps a normalized layout to itself", () => {
    const once = normalizeLayout(twoLevels());

    expect(normalizeLayout(once)).toEqual(once);
  });

  it("is idempotent when the rounded fractions do not sum to 1", () => {
    const root = {
      type: "branch",
      size: 800,
      data: [leaf("a", 100), leaf("b", 100), leaf("c", 500)],
    };
    const once = normalizeLayout(layoutOf(root));

    expect(normalizeLayout(once)).toEqual(once);
  });

  it("gives the same layout for two viewport sizes", () => {
    const wide = layoutOf(
      {
        type: "branch",
        size: 800,
        data: [leaf("a", 600), leaf("b", 600)],
      },
      1200,
      800,
    );
    const narrow = layoutOf(
      {
        type: "branch",
        size: 400,
        data: [leaf("a", 400), leaf("b", 400)],
      },
      800,
      400,
    );

    expect(normalizeLayout(wide)).toEqual(normalizeLayout(narrow));
  });

  it("does not change its input", () => {
    const input = twoLevels();
    const before = JSON.stringify(input);

    const output = normalizeLayout(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(output).not.toBe(input);
    expect(output.grid.root).not.toBe(input.grid.root);
  });

  it("returns an equal copy when the grid root is missing or a leaf", () => {
    const noRoot = { grid: { width: 1200, height: 800 }, panels: {} };
    const leafRoot = layoutOf(leaf("a", 500));

    expect(normalizeLayout(noRoot)).toEqual(noRoot);
    expect(normalizeLayout(leafRoot)).toEqual(leafRoot);
    expect(normalizeLayout({ panels: ["x"] })).toEqual({ panels: ["x"] });
  });
});
