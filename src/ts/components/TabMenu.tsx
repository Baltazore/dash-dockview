import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { PlusGlyph } from "./glyphs";
import type { TabMenuItem } from "./types";

const GAP_PX = 4;
const EDGE_PX = 8;

type Props = {
  anchor: HTMLElement;
  items: TabMenuItem[];
  onSelect: (itemId: string) => void;
  onClose: () => void;
};

const MenuGlyph = ({ icon }: { icon: NonNullable<TabMenuItem["icon"]> }) =>
  icon === "plus" ? (
    <span className="ddv-menu-glyph">
      <PlusGlyph size={18} />
    </span>
  ) : (
    <span className="ddv-menu-glyph ddv-menu-glyph--group" />
  );

/**
 * The menu goes to document.body. The tab bar clips its children, so a menu
 * that stayed inside the tab would be cut off at the bar.
 */
const TabMenu = ({ anchor, items, onSelect, onClose }: Props) => {
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) {
      return;
    }
    const below = anchor.getBoundingClientRect();
    const maxLeft = window.innerWidth - element.offsetWidth - EDGE_PX;
    const left = Math.max(EDGE_PX, Math.min(below.left, maxLeft));
    // Custom properties keep the styles in tabs.css and the numbers here.
    element.style.setProperty("--ddv-menu-left", `${left}px`);
    element.style.setProperty("--ddv-menu-top", `${below.bottom + GAP_PX}px`);
  }, [anchor]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      // The badge toggles the menu itself, so it is not an outside click.
      if (!menu.current?.contains(target) && !anchor.contains(target)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        anchor.focus();
      }
    };
    // The menu is fixed to the screen, so it would drift from the badge.
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div className="ddv-menu" role="menu" ref={menu}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="ddv-menu-item"
          onClick={() => onSelect(item.id)}
        >
          {item.icon && <MenuGlyph icon={item.icon} />}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
};

export default TabMenu;
