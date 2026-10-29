import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DockviewReact } from "dockview-react";
import type {
  AddPanelOptions,
  DockviewApi,
  DockviewReadyEvent,
} from "dockview-react";
import "dockview/dist/styles/dockview.css";
import "./tabs.css";

import PanelContent, { DockviewIdContext } from "./PanelContent";
import PanelTab from "./PanelTab";
import { EmitTabOutput, TabOutputContext } from "./tabOutput";
import { normalizeLayout, stripPanelParams, tabParamsOf } from "./tabParams";
import { buildThemeCss } from "./themeCss";
import {
  ActivePanelEvent,
  DEFAULT_THEME_NAME,
  PanelAddedEvent,
  PanelDef,
  PanelRemovedEvent,
  THEMES,
} from "./types";

type SerializedLayout = object;

type Props = {
  /**
   * Array of panel definitions. Each panel needs at minimum an 'id' and 'title'.
   * A panel can also set 'icon' (an image URL), 'badge' ({kind: 'none'},
   * {kind: 'ungrouped'}, or {kind: 'group', label}), and 'menu' (a list of
   * {id, label, icon}) for the menu that the badge opens. A change to these
   * fields repaints the tab in place.
   */
  panels?: PanelDef[];

  /**
   * Serialized layout state from Dockview's toJSON(). Sizes are fractions of
   * the parent, so the layout does not depend on the viewport. A layout with
   * pixel sizes also loads, and only the ratios between siblings count.
   */
  layout?: SerializedLayout;

  /**
   * Initial layout to load on first mount.
   */
  initialLayout?: SerializedLayout;

  /**
   * Debounce delay (ms) for layout change events. Default: 250
   */
  layoutDebounceMs?: number;

  /**
   * Width of the dockview container. Default: '100%'
   */
  width?: string | number;

  /**
   * Height of the dockview container. Default: '100vh'
   */
  height?: string | number;

  /**
   * Theme class name. Default: 'dockview-theme-abyss'
   */
  theme?: string;

  /**
   * Custom theme overrides as CSS variable key-value pairs.
   * Keys should be dockview CSS variable names (with or without '--dv-' prefix).
   * Example: { 'separator-border': 'red', '--dv-group-view-background-color': '#ffffff' }
   */
  themeOverrides?: Record<string, string>;

  /**
   * Disable floating groups. Default: false
   */
  disableFloatingGroups?: boolean;

  /**
   * Last panel added event (output prop).
   */
  lastPanelAdded?: object;

  /**
   * Last panel removed event (output prop).
   */
  lastPanelRemoved?: object;

  /**
   * Active panel changed event (output prop).
   */
  activePanel?: object;

  /**
   * List of currently open panel IDs (output prop)
   */
  openPanels?: string[];

  /**
   * Last badge menu item that the user chose (output prop). It has the shape
   * {panelId, itemId, at}. The component sends the item id back as given.
   */
  lastTabMenuAction?: object;

  /**
   * Unique ID to identify this component in Dash callbacks.
   */
  id?: string;

  /**
   * Dash-assigned callback that should be called to report property changes
   * to Dash, to make them available for callbacks.
   */
  setProps: (props: Partial<Props>) => void;
};

const COMPONENTS = { default: PanelContent };
// Stable defaults: a fresh [] or {} per render would re-run the effects below.
const NO_PANELS: PanelDef[] = [];
const NO_OVERRIDES: Record<string, string> = {};

const toCssSize = (size: string | number) =>
  typeof size === "number" ? `${size}px` : size;

function toAddPanelOptions(api: DockviewApi, def: PanelDef): AddPanelOptions {
  const options: AddPanelOptions = {
    id: def.id,
    title: def.title || def.id,
    component: "default",
    params: tabParamsOf(def),
  };
  const direction = def.position || "within";
  if (def.referencePanel) {
    const reference = api.getPanel(def.referencePanel);
    if (reference) {
      options.position = { referencePanel: reference.id, direction };
    }
  } else if (def.referenceGroup) {
    const reference = api.getGroup(def.referenceGroup);
    if (reference) {
      options.position = { referenceGroup: reference.id, direction };
    }
  }
  return options;
}

const serializeLayout = (api: DockviewApi) =>
  normalizeLayout(stripPanelParams(api.toJSON()));

const layoutJsonOf = (layout: SerializedLayout) =>
  JSON.stringify(normalizeLayout(layout));

// A panel that is missing from the API was closed by the user. Skip it.
// An update repaints the tab, so a panel whose params already match gets none.
// JSON.stringify leaves out undefined, as dockview drops an undefined param.
function syncTabParams(api: DockviewApi, defs: PanelDef[]) {
  defs.forEach((def) => {
    const panel = api.getPanel(def.id);
    const next = tabParamsOf(def);
    if (panel && JSON.stringify(panel.params ?? {}) !== JSON.stringify(next)) {
      panel.api.updateParameters(next);
    }
  });
}

/**
 * Dockview - A Dash component wrapper for the Dockview layout manager.
 */
const Dockview = (props: Props) => {
  const {
    id = "dockview",
    panels = NO_PANELS,
    layout,
    initialLayout,
    layoutDebounceMs = 250,
    width = "100%",
    height = "100vh",
    theme = DEFAULT_THEME_NAME,
    themeOverrides = NO_OVERRIDES,
    disableFloatingGroups = false,
    setProps,
  } = props;

  const apiRef = useRef<DockviewApi | null>(null);
  const [ready, setReady] = useState(false);
  // Ids Dash has been told about. It can differ from the live panels when
  // the user closes a tab, and that is intended: a closed tab stays closed.
  const trackedIds = useRef<Set<string>>(new Set());
  const mounted = useRef(false);
  const restoring = useRef(false);
  // JSON of the last layout that Dash holds, set by a report or by a restore.
  // A change event that matches it carries nothing new, so it is not echoed.
  // Sizes are fractions of the parent, so a resize does not change it.
  const lastLayoutJson = useRef<string | null>(null);
  const lastOpenPanelsJson = useRef<string | null>(null);
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latest = useRef({ setProps, panels, initialLayout });
  latest.current = { setProps, panels, initialLayout };

  const emitTabOutput = useCallback<EmitTabOutput>(
    (outputs) => latest.current.setProps(outputs),
    [],
  );

  const reportLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api || restoring.current) {
      return;
    }
    const serialized = serializeLayout(api);
    const layoutJson = layoutJsonOf(serialized);
    const openPanels = api.panels.map((panel) => panel.id);
    const openPanelsJson = JSON.stringify(openPanels);

    const update: { layout?: SerializedLayout; openPanels?: string[] } = {};
    if (layoutJson !== lastLayoutJson.current) {
      update.layout = serialized;
      lastLayoutJson.current = layoutJson;
    }
    if (openPanelsJson !== lastOpenPanelsJson.current) {
      update.openPanels = openPanels;
      lastOpenPanelsJson.current = openPanelsJson;
    }
    if (update.layout || update.openPanels) {
      latest.current.setProps(update);
    }
  }, []);

  const scheduleReport = useCallback(() => {
    if (restoring.current) {
      return;
    }
    if (reportTimer.current) {
      clearTimeout(reportTimer.current);
    }
    reportTimer.current = setTimeout(reportLayout, layoutDebounceMs);
  }, [layoutDebounceMs, reportLayout]);

  const scheduleRef = useRef(scheduleReport);
  scheduleRef.current = scheduleReport;

  useEffect(
    () => () => {
      if (reportTimer.current) {
        clearTimeout(reportTimer.current);
      }
    },
    [],
  );

  const restoreLayout = useCallback((serialized: SerializedLayout) => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    restoring.current = true;
    try {
      api.fromJSON(serialized as Parameters<DockviewApi["fromJSON"]>[0], {
        reuseExistingPanels: true,
      });
      trackedIds.current = new Set(api.panels.map((panel) => panel.id));
      // The restored panels carry the params of the saved layout, not the
      // current ones.
      syncTabParams(api, latest.current.panels);
      lastLayoutJson.current = layoutJsonOf(serializeLayout(api));
    } finally {
      restoring.current = false;
    }
    // openPanels still needs to reach Dash after a restore.
    scheduleRef.current();
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;

    // A restore is one operation. Dash learns its result from openPanels, so
    // the panels that fromJSON adds or disposes are not reported one by one.
    api.onDidAddPanel((panel) => {
      if (restoring.current) {
        return;
      }
      const added: PanelAddedEvent = {
        panelId: panel.id,
        title: panel.title || panel.id,
        groupId: panel.group?.id || "",
      };
      latest.current.setProps({ lastPanelAdded: added });
      scheduleRef.current();
    });
    api.onDidRemovePanel((panel) => {
      if (restoring.current) {
        return;
      }
      const removed: PanelRemovedEvent = { panelId: panel.id };
      latest.current.setProps({ lastPanelRemoved: removed });
      scheduleRef.current();
    });
    // v8 wraps the panel in an event object; v4 passed the panel itself.
    api.onDidActivePanelChange(({ panel }) => {
      const active: ActivePanelEvent = {
        panelId: panel?.id || null,
        groupId: panel?.group?.id || null,
      };
      latest.current.setProps({ activePanel: active });
    });
    api.onDidLayoutChange(() => scheduleRef.current());

    const { initialLayout: first, panels: initialPanels } = latest.current;
    if (first && !mounted.current) {
      restoring.current = true;
      try {
        api.fromJSON(first as Parameters<DockviewApi["fromJSON"]>[0], {
          reuseExistingPanels: true,
        });
        api.panels.forEach((panel) => trackedIds.current.add(panel.id));
        syncTabParams(api, initialPanels);
      } finally {
        restoring.current = false;
      }
    } else if (initialPanels.length > 0 && !mounted.current) {
      initialPanels.forEach((def) => {
        api.addPanel(toAddPanelOptions(api, def));
        trackedIds.current.add(def.id);
      });
    }
    mounted.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !ready) {
      return;
    }
    const desired = new Set(panels.map((def) => def.id));
    const current = trackedIds.current;
    // A tab fed by updateParameters repaints in place. A re-add would fire
    // lastPanelAdded and lose the open badge menu.
    syncTabParams(
      api,
      panels.filter((def) => current.has(def.id)),
    );
    panels
      .filter((def) => !current.has(def.id))
      .forEach((def) => api.addPanel(toAddPanelOptions(api, def)));
    Array.from(current)
      .filter((panelId) => !desired.has(panelId))
      .forEach((panelId) => api.getPanel(panelId)?.api.close());
    trackedIds.current = desired;
  }, [panels, ready]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !layout || !ready || restoring.current) {
      return;
    }
    if (layoutJsonOf(serializeLayout(api)) !== layoutJsonOf(layout)) {
      restoreLayout(layout);
    }
  }, [layout, ready, restoreLayout]);

  const dockviewTheme = useMemo(
    () => THEMES[theme] ?? THEMES[DEFAULT_THEME_NAME],
    [theme],
  );
  const overrideCss = useMemo(
    () => buildThemeCss(id, themeOverrides),
    [themeOverrides, id],
  );

  return (
    <DockviewIdContext.Provider value={id}>
      <TabOutputContext.Provider value={emitTabOutput}>
        {overrideCss && <style>{overrideCss}</style>}
        <div
          id={id}
          style={{
            width: toCssSize(width),
            height: toCssSize(height),
            position: "relative",
          }}
        >
          <DockviewReact
            theme={dockviewTheme}
            onReady={onReady}
            components={COMPONENTS}
            defaultTabComponent={PanelTab}
            disableFloatingGroups={disableFloatingGroups}
          />
        </div>
      </TabOutputContext.Provider>
    </DockviewIdContext.Provider>
  );
};

export default Dockview;
