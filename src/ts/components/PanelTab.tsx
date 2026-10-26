import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  DockviewPanelApi,
  IDockviewPanelHeaderProps,
} from "dockview-react";

import { CrossGlyph } from "./glyphs";
import TabMenu from "./TabMenu";
import { TabOutputContext } from "./tabOutput";
import type { TabMenuItem, TabParams } from "./types";

const NO_MENU: TabMenuItem[] = [];

// api.isActive is true only for the active panel of the one active group, so
// the tabs of the other groups would lose their close button. isVisible is true
// for the active panel of every group.
function useIsActiveInGroup(api: DockviewPanelApi): boolean {
  const [active, setActive] = useState(api.isVisible);
  useEffect(() => {
    setActive(api.isVisible);
    const subscription = api.onDidVisibilityChange((event) =>
      setActive(event.isVisible),
    );
    return () => subscription.dispose();
  }, [api]);
  return active;
}

function useTitle(api: DockviewPanelApi): string {
  const [title, setTitle] = useState(api.title ?? api.id);
  useEffect(() => {
    setTitle(api.title ?? api.id);
    const subscription = api.onDidTitleChange((event) =>
      setTitle(event.title),
    );
    return () => subscription.dispose();
  }, [api]);
  return title;
}

const PanelTab = ({ api, params }: IDockviewPanelHeaderProps<TabParams>) => {
  const emit = useContext(TabOutputContext);
  const active = useIsActiveInGroup(api);
  const title = useTitle(api);
  const { icon, badge, menu = NO_MENU } = params ?? {};

  const badgeButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!active) {
      closeMenu();
    }
  }, [active, closeMenu]);

  const selectItem = (itemId: string) => {
    closeMenu();
    emit({ lastTabMenuAction: { panelId: api.id, itemId, at: Date.now() } });
  };

  // An unknown kind from Python draws no badge, as "none" does.
  const shownBadge =
    badge?.kind === "ungrouped" || badge?.kind === "group" ? badge : null;

  return (
    <div className={active ? "ddv-tab ddv-tab--active" : "ddv-tab"}>
      {shownBadge && (
        <button
          ref={badgeButton}
          type="button"
          className={`ddv-badge ddv-badge--${shownBadge.kind}`}
          aria-label="Tab menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={menu.length === 0}
          // The tab element is a native handler target. Its pointer down
          // activates the tab, its click acts on edge groups, and a mouse down
          // on it starts a native drag. The badge must trigger none of them.
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          {shownBadge.kind === "group" ? shownBadge.label : null}
        </button>
      )}
      {icon && (
        // An image is draggable by default and would take the drag from the tab.
        <img
          className="ddv-tab-icon"
          src={icon}
          width={16}
          height={16}
          alt=""
          draggable={false}
        />
      )}
      <span className="ddv-tab-title">{title}</span>
      {active && (
        <button
          type="button"
          className="ddv-tab-close"
          aria-label="Close tab"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => api.close()}
        >
          <CrossGlyph />
        </button>
      )}
      {menuOpen && badgeButton.current && (
        <TabMenu
          anchor={badgeButton.current}
          items={menu}
          onSelect={selectItem}
          onClose={closeMenu}
        />
      )}
    </div>
  );
};

export default PanelTab;
