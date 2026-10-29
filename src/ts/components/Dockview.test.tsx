import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

const fake = vi.hoisted(() => {
  type Listener = (arg?: unknown) => void;

  class FakeApi {
    panels: {
      id: string;
      title: string;
      group: { id: string };
      params?: Record<string, unknown>;
      api: { close: () => void; updateParameters: Mock };
    }[] = [];
    listeners: Record<string, Listener[]> = {
      add: [],
      remove: [],
      active: [],
      layout: [],
    };
    groupCount = 0;

    on(kind: string) {
      return (listener: Listener) => {
        this.listeners[kind].push(listener);
        return { dispose: () => undefined };
      };
    }
    onDidAddPanel = this.on("add");
    onDidRemovePanel = this.on("remove");
    onDidActivePanelChange = this.on("active");
    onDidLayoutChange = this.on("layout");

    emit(kind: string, arg?: unknown) {
      this.listeners[kind].forEach((listener) => listener(arg));
    }

    insert(id: string, title = id, params?: Record<string, unknown>) {
      const panel = {
        id,
        title,
        params,
        group: { id: `group-${++this.groupCount}` },
        api: {
          close: vi.fn(() => this.removePanel(id)),
          // Dockview merges the new params and drops the undefined ones.
          updateParameters: vi.fn((next: Record<string, unknown>) => {
            const merged = { ...panel.params, ...next };
            Object.keys(next)
              .filter((key) => next[key] === undefined)
              .forEach((key) => delete merged[key]);
            panel.params = merged;
          }),
        },
      };
      this.panels.push(panel);
      this.emit("add", panel);
      this.emit("layout");
    }
    removePanel(id: string) {
      const panel = this.panels.find((candidate) => candidate.id === id);
      this.panels = this.panels.filter((candidate) => candidate.id !== id);
      this.emit("remove", panel);
      this.emit("layout");
    }

    addPanel = vi.fn(
      (options: {
        id: string;
        title?: string;
        params?: Record<string, unknown>;
      }) => this.insert(options.id, options.title, options.params),
    );
    getPanel = vi.fn((id: string) =>
      this.panels.find((candidate) => candidate.id === id),
    );
    getGroup = vi.fn(() => undefined);
    toJSON = vi.fn(() => ({ panels: this.panels.map((panel) => panel.id) }));
    // Dockview disposes every live panel, unless reuseExistingPanels keeps
    // the ones that the new layout still has. A kept panel takes the params
    // of the layout, and this layout has none.
    fromJSON = vi.fn(
      (
        layout: { panels: string[] },
        options?: { reuseExistingPanels: boolean },
      ) => {
        const kept = options?.reuseExistingPanels ? layout.panels : [];
        this.panels
          .filter((panel) => !kept.includes(panel.id))
          .forEach((panel) => this.removePanel(panel.id));
        this.panels.forEach((panel) => {
          panel.params = undefined;
        });
        layout.panels
          .filter((id) => !this.panels.some((panel) => panel.id === id))
          .forEach((id) => this.insert(id));
      },
    );
  }

  return {
    FakeApi,
    current: { api: null as InstanceType<typeof FakeApi> | null },
    // Props that the mocked DockviewReact hands to the tab.
    tab: { current: null as object | null },
  };
});

vi.mock("dockview-react", async () => {
  const react = await import("react");
  const theme = (name: string) => ({
    name,
    className: `dockview-theme-${name}`,
  });
  return {
    themeAbyss: theme("abyss"),
    themeAbyssSpaced: theme("abyss-spaced"),
    themeDark: theme("dark"),
    themeDracula: theme("dracula"),
    themeLight: theme("light"),
    themeLightSpaced: theme("light-spaced"),
    themeVisualStudio: theme("vs"),
    DockviewReact: ({
      onReady,
      defaultTabComponent: Tab,
    }: {
      onReady: (event: unknown) => void;
      defaultTabComponent?: React.ComponentType<object>;
    }) => {
      react.useEffect(() => {
        const api = new fake.FakeApi();
        fake.current.api = api;
        onReady({ api });
      }, []);
      return react.createElement(
        react.Fragment,
        null,
        Tab && fake.tab.current && react.createElement(Tab, fake.tab.current),
      );
    },
  };
});

import Dockview from "./Dockview";
import PanelContent, { DockviewIdContext } from "./PanelContent";
import { normalizeThemeKey } from "./themeCss";

const api = () => fake.current.api!;

// Dash passes the same array until the prop changes, so tests reuse one.
const NO_PANELS: never[] = [];

const flushDebounce = (ms = 250) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  fake.current.api = null;
  fake.tab.current = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("panels reconciliation", () => {
  const first = { id: "a", title: "A" };
  const second = {
    id: "b",
    title: "B",
    position: "right" as const,
    referencePanel: "a",
  };

  it("adds the initial panels and positions them against their reference", () => {
    render(<Dockview panels={[first, second]} setProps={vi.fn()} />);

    expect(api().addPanel).toHaveBeenCalledTimes(2);
    expect(api().addPanel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "a", title: "A", component: "default" }),
    );
    expect(api().addPanel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "b",
        position: { referencePanel: "a", direction: "right" },
      }),
    );
  });

  it("adds new panels, closes dropped ones and leaves the rest alone", () => {
    const setProps = vi.fn();
    const { rerender } = render(
      <Dockview panels={[first, second]} setProps={setProps} />,
    );
    const droppedPanel = api().getPanel("a")!;

    rerender(
      <Dockview
        panels={[
          second,
          { id: "c", title: "C", position: "below", referencePanel: "b" },
        ]}
        setProps={setProps}
      />,
    );

    expect(droppedPanel.api.close).toHaveBeenCalledTimes(1);
    expect(api().panels.map((panel) => panel.id)).toEqual(["b", "c"]);
    expect(api().addPanel).toHaveBeenCalledTimes(3);
    expect(setProps).toHaveBeenCalledWith({
      lastPanelRemoved: { panelId: "a" },
    });
    expect(setProps).toHaveBeenCalledWith({
      lastPanelAdded: { panelId: "c", title: "C", groupId: "group-3" },
    });
  });

  it("does not re-add a panel for a new array with the same ids", () => {
    const setProps = vi.fn();
    const { rerender } = render(
      <Dockview panels={[first]} setProps={setProps} />,
    );

    rerender(<Dockview panels={[{ ...first }]} setProps={setProps} />);

    expect(api().addPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps a tab the user closed closed while the panels prop still lists it", () => {
    const setProps = vi.fn();
    const { rerender } = render(
      <Dockview panels={[first, second]} setProps={setProps} />,
    );

    act(() => api().removePanel("a"));
    rerender(
      <Dockview
        panels={[first, second, { id: "c", title: "C" }]}
        setProps={setProps}
      />,
    );

    expect(api().panels.map((panel) => panel.id)).toEqual(["b", "c"]);
  });
});

const MN = [{ id: "m" }, { id: "n" }];

describe("layout round trip", () => {
  it("restores a layout from the prop once and not again for an equal layout", () => {
    const setProps = vi.fn();
    const { rerender } = render(
      <Dockview
        panels={NO_PANELS}
        layout={{ panels: ["x", "y"] }}
        setProps={setProps}
      />,
    );

    expect(api().fromJSON).toHaveBeenCalledTimes(1);
    expect(api().panels.map((panel) => panel.id)).toEqual(["x", "y"]);

    rerender(
      <Dockview
        panels={NO_PANELS}
        layout={{ panels: ["x", "y"] }}
        setProps={setProps}
      />,
    );
    expect(api().fromJSON).toHaveBeenCalledTimes(1);
  });

  it("reports openPanels but does not echo a layout that came from the prop", () => {
    const setProps = vi.fn();
    render(
      <Dockview
        panels={NO_PANELS}
        layout={{ panels: ["x", "y"] }}
        setProps={setProps}
      />,
    );
    setProps.mockClear();

    flushDebounce();

    expect(setProps).toHaveBeenCalledTimes(1);
    expect(setProps).toHaveBeenCalledWith({ openPanels: ["x", "y"] });
  });

  it("reports a user change once and does not restore it when it comes back", () => {
    const setProps = vi.fn();
    const { rerender } = render(
      <Dockview
        panels={NO_PANELS}
        layout={{ panels: ["x"] }}
        setProps={setProps}
      />,
    );
    flushDebounce();
    setProps.mockClear();

    act(() => api().insert("z"));
    flushDebounce();

    const layoutReports = setProps.mock.calls.filter(
      ([update]) => "layout" in update,
    );
    expect(layoutReports).toEqual([
      [{ layout: { panels: ["x", "z"] }, openPanels: ["x", "z"] }],
    ]);

    rerender(
      <Dockview
        panels={NO_PANELS}
        layout={{ panels: ["x", "z"] }}
        setProps={setProps}
      />,
    );
    flushDebounce();

    expect(api().fromJSON).toHaveBeenCalledTimes(1);
    expect(
      setProps.mock.calls.filter(([update]) => "layout" in update),
    ).toHaveLength(1);
  });

  it("reports a restore that drops one panel and keeps another as openPanels only", () => {
    const setProps = vi.fn();
    const { rerender } = render(
      <Dockview
        panels={NO_PANELS}
        layout={{ panels: ["x", "y"] }}
        setProps={setProps}
      />,
    );
    flushDebounce();
    setProps.mockClear();

    rerender(
      <Dockview
        panels={NO_PANELS}
        layout={{ panels: ["y", "z"] }}
        setProps={setProps}
      />,
    );
    flushDebounce();

    expect(setProps.mock.calls).toEqual([[{ openPanels: ["y", "z"] }]]);

    act(() => api().removePanel("y"));

    expect(setProps).toHaveBeenCalledWith({
      lastPanelRemoved: { panelId: "y" },
    });
  });

  it("asks dockview to reuse the live panels when it restores a layout", () => {
    render(
      <Dockview
        panels={NO_PANELS}
        layout={{ panels: ["x", "y"] }}
        setProps={vi.fn()}
      />,
    );

    expect(api().fromJSON).toHaveBeenCalledWith(
      { panels: ["x", "y"] },
      { reuseExistingPanels: true },
    );
  });

  it("asks dockview to reuse the live panels when it loads initialLayout", () => {
    render(
      <Dockview
        panels={MN}
        initialLayout={{ panels: ["m", "n"] }}
        setProps={vi.fn()}
      />,
    );

    expect(api().fromJSON).toHaveBeenCalledWith(
      { panels: ["m", "n"] },
      { reuseExistingPanels: true },
    );
  });

  it("debounces several changes into one report", () => {
    const setProps = vi.fn();
    render(
      <Dockview
        panels={NO_PANELS}
        layoutDebounceMs={100}
        setProps={setProps}
      />,
    );

    act(() => {
      api().insert("p");
      api().insert("q");
    });
    setProps.mockClear();
    flushDebounce(99);
    expect(setProps).not.toHaveBeenCalled();
    flushDebounce(1);

    expect(setProps).toHaveBeenCalledTimes(1);
  });

  describe("a size-only layout change", () => {
    const withGrid = (root: string, width: number, height: number) =>
      ({
        panels: ["x"],
        grid: { root, width, height, orientation: "HORIZONTAL" },
      }) as never;
    const layoutReports = (setProps: Mock) =>
      setProps.mock.calls.filter(([update]) => "layout" in update);

    it("is not reported to Dash", () => {
      const setProps = vi.fn();
      render(<Dockview panels={NO_PANELS} setProps={setProps} />);
      api().toJSON.mockImplementation(() => withGrid("r1", 800, 600));
      act(() => api().emit("layout"));
      flushDebounce();
      setProps.mockClear();

      api().toJSON.mockImplementation(() => withGrid("r1", 1000, 700));
      act(() => api().emit("layout"));
      flushDebounce();

      expect(layoutReports(setProps)).toEqual([]);
    });

    it("does not hide a structural change, and the report keeps the grid size", () => {
      const setProps = vi.fn();
      render(<Dockview panels={NO_PANELS} setProps={setProps} />);
      api().toJSON.mockImplementation(() => withGrid("r1", 800, 600));
      act(() => api().emit("layout"));
      flushDebounce();
      setProps.mockClear();

      api().toJSON.mockImplementation(() => withGrid("r2", 1000, 700));
      act(() => api().emit("layout"));
      flushDebounce();

      expect(layoutReports(setProps)).toEqual([
        [{ layout: withGrid("r2", 1000, 700) }],
      ]);
    });

    it("is not reported after a restore", () => {
      const setProps = vi.fn();
      const { rerender } = render(
        <Dockview panels={NO_PANELS} setProps={setProps} />,
      );
      api().toJSON.mockImplementation(() => withGrid("r1", 800, 600));
      rerender(
        <Dockview
          panels={NO_PANELS}
          layout={withGrid("r2", 800, 600)}
          setProps={setProps}
        />,
      );
      expect(api().fromJSON).toHaveBeenCalledTimes(1);
      flushDebounce();
      setProps.mockClear();

      api().toJSON.mockImplementation(() => withGrid("r1", 1000, 700));
      act(() => api().emit("layout"));
      flushDebounce();

      expect(layoutReports(setProps)).toEqual([]);
    });

    it("does not restore a layout from the prop that differs only in size", () => {
      const { rerender } = render(
        <Dockview panels={NO_PANELS} setProps={vi.fn()} />,
      );
      api().toJSON.mockImplementation(() => withGrid("r1", 1000, 700));

      rerender(
        <Dockview
          panels={NO_PANELS}
          layout={withGrid("r1", 800, 600)}
          setProps={vi.fn()}
        />,
      );

      expect(api().fromJSON).not.toHaveBeenCalled();
    });
  });

  it("loads initialLayout once and ignores later changes to it", () => {
    const { rerender } = render(
      <Dockview
        panels={MN}
        initialLayout={{ panels: ["m", "n"] }}
        setProps={vi.fn()}
      />,
    );

    rerender(
      <Dockview
        panels={MN}
        initialLayout={{ panels: ["other"] }}
        setProps={vi.fn()}
      />,
    );

    expect(api().fromJSON).toHaveBeenCalledTimes(1);
    expect(api().addPanel).not.toHaveBeenCalled();
    expect(api().panels.map((panel) => panel.id)).toEqual(["m", "n"]);
  });
});

describe("tab fields", () => {
  const menu = [
    { id: "create", label: "Create group", icon: "plus" as const },
    { id: "leave", label: "Leave group" },
  ];
  const ungrouped = {
    id: "a",
    title: "A",
    icon: "/assets/a.svg",
    badge: { kind: "ungrouped" as const },
    menu,
  };
  const ungroupedParams = {
    icon: "/assets/a.svg",
    badge: { kind: "ungrouped" },
    menu,
  };

  it("adds a panel with its icon, badge and menu as params", () => {
    render(<Dockview panels={[ungrouped]} setProps={vi.fn()} />);

    expect(api().addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", params: ungroupedParams }),
    );
  });

  it("updates the params of an existing panel when its badge changes, and adds nothing", () => {
    const setProps = vi.fn();
    const { rerender } = render(
      <Dockview panels={[ungrouped]} setProps={setProps} />,
    );
    const panel = api().getPanel("a")!;
    expect(panel.api.updateParameters).not.toHaveBeenCalled();
    setProps.mockClear();

    rerender(
      <Dockview
        panels={[{ ...ungrouped, badge: { kind: "group", label: "2" } }]}
        setProps={setProps}
      />,
    );

    expect(panel.api.updateParameters).toHaveBeenCalledWith({
      ...ungroupedParams,
      badge: { kind: "group", label: "2" },
    });
    expect(api().addPanel).toHaveBeenCalledTimes(1);
    expect(setProps).not.toHaveBeenCalled();
  });

  it("does not update a tab whose fields did not change", () => {
    const { rerender } = render(
      <Dockview panels={[ungrouped]} setProps={vi.fn()} />,
    );
    const panel = api().getPanel("a")!;

    rerender(<Dockview panels={[{ ...ungrouped }]} setProps={vi.fn()} />);

    expect(panel.api.updateParameters).not.toHaveBeenCalled();
  });

  it("sends undefined for a field that the new panel no longer has", () => {
    const { rerender } = render(
      <Dockview panels={[ungrouped]} setProps={vi.fn()} />,
    );
    const panel = api().getPanel("a")!;

    rerender(<Dockview panels={[{ id: "a", title: "A" }]} setProps={vi.fn()} />);

    // Dockview drops a param whose new value is undefined.
    expect(panel.api.updateParameters.mock.calls[0][0]).toStrictEqual({
      icon: undefined,
      badge: undefined,
      menu: undefined,
    });
  });

  it("gives a restored layout the current tab fields again", () => {
    render(
      <Dockview
        panels={[ungrouped]}
        layout={{ panels: ["a", "b"] }}
        setProps={vi.fn()}
      />,
    );

    expect(api().fromJSON).toHaveBeenCalledTimes(1);
    expect(api().getPanel("a")!.api.updateParameters).toHaveBeenCalledWith(
      ungroupedParams,
    );
    expect(api().getPanel("b")!.api.updateParameters).not.toHaveBeenCalled();
  });

  it("keeps the tab fields out of the layout that it reports", () => {
    const setProps = vi.fn();
    render(<Dockview panels={[ungrouped]} setProps={setProps} />);
    api().toJSON.mockImplementation(
      () =>
        ({
          panels: { a: { id: "a", title: "A", params: ungroupedParams } },
        }) as never,
    );
    setProps.mockClear();

    act(() => api().emit("layout"));
    flushDebounce();

    expect(setProps).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: { panels: { a: { id: "a", title: "A" } } },
      }),
    );
  });

  it("sends the chosen badge menu item to Dash with the panel id", () => {
    vi.setSystemTime(1_700_000_000_000);
    fake.tab.current = {
      api: {
        id: "p9",
        title: "Nine",
        isVisible: true,
        close: vi.fn(),
        onDidVisibilityChange: () => ({ dispose: () => undefined }),
        onDidTitleChange: () => ({ dispose: () => undefined }),
      },
      params: { badge: { kind: "ungrouped" }, menu },
    };
    const setProps = vi.fn();
    render(<Dockview setProps={setProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Tab menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create group" }));

    expect(setProps).toHaveBeenCalledWith({
      lastTabMenuAction: {
        panelId: "p9",
        itemId: "create",
        at: 1_700_000_000_000,
      },
    });
  });
});

describe("themeOverrides", () => {
  it("scopes bare, dv- and --dv- keys to the component as --dv- variables", () => {
    const { container } = render(
      <Dockview
        id="my-dv"
        themeOverrides={{
          "separator-border": "red",
          "dv-sash-color": "blue",
          "--dv-active-sash-color": "green",
        }}
        setProps={vi.fn()}
      />,
    );

    expect(container.querySelector("style")!.textContent).toBe(
      "#my-dv .dv-dockview { --dv-separator-border: red; --dv-sash-color: blue; --dv-active-sash-color: green; }",
    );
  });

  it("renders no style element without overrides", () => {
    const { container } = render(<Dockview setProps={vi.fn()} />);

    expect(container.querySelector("style")).toBeNull();
  });

  it("normalises every accepted key spelling to one variable name", () => {
    expect(["x", "dv-x", "--dv-x"].map(normalizeThemeKey)).toEqual([
      "--dv-x",
      "--dv-x",
      "--dv-x",
    ]);
  });
});

describe("panel content adoption", () => {
  const panelProps = { api: { id: "p1" } };
  const mountPanel = (content: HTMLElement | null) => {
    if (content) document.body.appendChild(content);
    return render(
      <DockviewIdContext.Provider value="dv">
        <PanelContent
          {...(panelProps as React.ComponentProps<typeof PanelContent>)}
        />
      </DockviewIdContext.Provider>,
    );
  };

  const makeContent = (withChild: boolean) => {
    const content = document.createElement("div");
    content.id = "__dv_content_dv_p1";
    content.style.display = "none";
    if (withChild) content.appendChild(document.createElement("span"));
    return content;
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moves the Dash content div into the panel and shows it", () => {
    const content = makeContent(true);
    const { container } = mountPanel(content);

    expect(container.contains(content)).toBe(true);
    expect(content.style.display).toBe("block");
  });

  it("waits until the content div has children", async () => {
    const content = makeContent(false);
    const { container } = mountPanel(content);
    expect(container.contains(content)).toBe(false);

    await act(async () => {
      content.appendChild(document.createElement("span"));
    });

    expect(container.contains(content)).toBe(true);
  });

  it("adopts a content div that Dash renders 2 seconds after the panel mounted", async () => {
    const { container } = mountPanel(null);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const content = makeContent(true);

    await act(async () => {
      document.body.appendChild(content);
    });

    expect(container.contains(content)).toBe(true);
    expect(content.style.display).toBe("block");
  });
});
