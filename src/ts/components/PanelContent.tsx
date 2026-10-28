import React, { createContext, useContext, useEffect, useRef } from "react";
import type { IDockviewPanelProps } from "dockview-react";

export const DockviewIdContext = createContext("");

export const contentElementId = (dockviewId: string, panelId: string) =>
  `__dv_content_${dockviewId}_${panelId}`;

const PanelContent = ({ api }: IDockviewPanelProps) => {
  const host = useRef<HTMLDivElement>(null);
  const dockviewId = useContext(DockviewIdContext);

  useEffect(() => {
    if (!api.id || !dockviewId) {
      return undefined;
    }
    const adopt = () => {
      const content = document.getElementById(
        contentElementId(dockviewId, api.id),
      );
      // An empty div is a Dash placeholder that has not rendered yet.
      if (!content || !host.current || content.childNodes.length === 0) {
        return false;
      }
      content.style.display = "block";
      host.current.appendChild(content);
      return true;
    };

    if (adopt()) {
      return undefined;
    }
    // Dash can render the content div at any time after the panel mounts,
    // for example after a layout restore that adds the panel.
    const observer = new MutationObserver(() => {
      if (adopt()) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [api.id, dockviewId]);

  return (
    <div
      ref={host}
      style={{ width: "100%", height: "100%", overflow: "auto" }}
    />
  );
};

export default PanelContent;
