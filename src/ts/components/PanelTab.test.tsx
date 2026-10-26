import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PanelTab from "./PanelTab";
import { TabOutputContext } from "./tabOutput";
import type { TabBadge, TabMenuItem, TabParams } from "./types";

const MENU: TabMenuItem[] = [
  { id: "create", label: "Create group", icon: "plus" },
  { id: "join:1:group", label: "Join group 1", icon: "group" },
  { id: "leave", label: "Leave group" },
];

type Listener<T> = (event: T) => void;

// The part of the panel API that the tab reads, with the events dockview fires.
function fakePanelApi({ isVisible = true } = {}) {
  const visibility: Listener<{ isVisible: boolean }>[] = [];
  const titles: Listener<{ title: string }>[] = [];
  const subscribe =
    <T,>(listeners: Listener<T>[]) =>
    (listener: Listener<T>) => {
      listeners.push(listener);
      return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
    };
  const api = {
    id: "p1",
    title: "Line chart",
    isVisible,
    close: vi.fn(),
    onDidVisibilityChange: subscribe(visibility),
    onDidTitleChange: subscribe(titles),
  };
  return {
    api,
    setVisible: (next: boolean) => {
      api.isVisible = next;
      visibility.forEach((listener) => listener({ isVisible: next }));
    },
  };
}

function renderTab(
  params: TabParams | undefined,
  { visible = true, onPointerDown = vi.fn() } = {},
) {
  const panel = fakePanelApi({ isVisible: visible });
  const emit = vi.fn();
  const tree = (next: TabParams | undefined) => (
    <TabOutputContext.Provider value={emit}>
      {/* Stands in for the handlers that dockview puts on the tab element. */}
      <div onPointerDown={onPointerDown}>
        <PanelTab
          {...({
            api: panel.api,
            containerApi: {},
            params: next,
            tabLocation: "header",
          } as unknown as React.ComponentProps<typeof PanelTab>)}
        />
      </div>
    </TabOutputContext.Provider>
  );
  const view = render(tree(params));
  // Dockview hands new params to the same tab, which renders again in place.
  const update = (next: TabParams) => view.rerender(tree(next));
  return { ...view, ...panel, emit, onPointerDown, update };
}

const badgeButton = () => screen.queryByRole("button", { name: "Tab menu" });
const closeButton = () => screen.queryByRole("button", { name: "Close tab" });
const openMenu = () => fireEvent.click(badgeButton()!);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("badge", () => {
  it.each<[string, TabBadge | undefined]>([
    ["is absent", undefined],
    ["is none", { kind: "none" }],
    ["has a kind the tab does not know", { kind: "other" } as never],
  ])("draws nothing when the badge %s", (_label, badge) => {
    renderTab({ badge, menu: MENU });

    expect(badgeButton()).toBeNull();
  });

  it("draws an empty dotted square for an ungrouped panel", () => {
    renderTab({ badge: { kind: "ungrouped" }, menu: MENU });

    const badge = badgeButton()!;
    expect(badge.className).toContain("ddv-badge--ungrouped");
    expect(badge.textContent).toBe("");
  });

  it("draws a filled square with the label for a group", () => {
    renderTab({ badge: { kind: "group", label: "2" }, menu: MENU });

    const badge = badgeButton()!;
    expect(badge.className).toContain("ddv-badge--group");
    expect(badge.textContent).toBe("2");
  });

  it("repaints when the panel gets a new badge", () => {
    const { update } = renderTab({ badge: { kind: "ungrouped" }, menu: MENU });
    const before = badgeButton()!;

    update({ badge: { kind: "group", label: "3" }, menu: MENU });

    expect(badgeButton()).toBe(before);
    expect(before.className).toContain("ddv-badge--group");
    expect(before.textContent).toBe("3");
  });

  it("does not open a menu when the panel has no menu items", () => {
    renderTab({ badge: { kind: "ungrouped" } });

    openMenu();

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the pointer down on the badge away from the tab handlers", () => {
    const { onPointerDown } = renderTab({
      badge: { kind: "ungrouped" },
      menu: MENU,
    });

    fireEvent.pointerDown(badgeButton()!);
    expect(onPointerDown).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText("Line chart"));
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});

describe("icon and title", () => {
  it("draws the icon as a 16 px image before the title", () => {
    const { container } = renderTab({ icon: "/assets/chart-line.svg" });

    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/assets/chart-line.svg");
    expect(image.getAttribute("width")).toBe("16");
    expect(image.getAttribute("height")).toBe("16");
    expect(image.getAttribute("alt")).toBe("");
    expect(
      image.compareDocumentPosition(screen.getByText("Line chart")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws no image without an icon", () => {
    const { container } = renderTab({});

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Line chart")).toBeTruthy();
  });
});

describe("close button", () => {
  it("shows on the active tab and closes the panel", () => {
    const { api } = renderTab({}, { visible: true });

    fireEvent.click(closeButton()!);

    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it("does not show on an inactive tab", () => {
    renderTab({}, { visible: false });

    expect(closeButton()).toBeNull();
  });

  it("follows the active state of the panel", () => {
    const { setVisible } = renderTab({}, { visible: false });

    act(() => setVisible(true));
    expect(closeButton()).not.toBeNull();

    act(() => setVisible(false));
    expect(closeButton()).toBeNull();
  });
});

describe("badge menu", () => {
  const params: TabParams = { badge: { kind: "ungrouped" }, menu: MENU };

  it("lists the menu items under the badge", () => {
    renderTab(params);

    openMenu();

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Create group", "Join group 1", "Leave group"]);
  });

  it("sends the chosen item with the panel id and closes", () => {
    const { emit } = renderTab(params);
    openMenu();

    const item = screen.getByRole("menuitem", { name: "Join group 1" });
    fireEvent.pointerDown(item);
    fireEvent.click(item);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      lastTabMenuAction: {
        panelId: "p1",
        itemId: "join:1:group",
        at: 1_700_000_000_000,
      },
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a pointer down outside and sends nothing", () => {
    const { emit } = renderTab(params);
    openMenu();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it("closes on Escape and sends nothing", () => {
    const { emit } = renderTab(params);
    openMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it("closes on a second click on the badge", () => {
    renderTab(params);
    openMenu();

    fireEvent.pointerDown(badgeButton()!);
    openMenu();

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when the tab stops being the active tab and sends nothing", () => {
    const { emit, setVisible } = renderTab(params);
    openMenu();

    act(() => setVisible(false));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });
});
