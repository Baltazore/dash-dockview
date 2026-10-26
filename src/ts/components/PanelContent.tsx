import React, { createContext, useContext, useEffect, useRef } from "react";
import type { IDockviewPanelProps } from "dockview-react";

export const DockviewIdContext = createContext("");

// Dash may render the content div after the panel mounts, so adoption retries.
const ADOPT_RETRY_DELAYS_MS = [50, 200, 500];

export const contentElementId = (dockviewId: string, panelId: string) =>
  `__dv_content_${dockviewId}_${panelId}`;

const PanelContent = ({ api }: IDockviewPanelProps) => {
  const host = useRef<HTMLDivElement>(null);
  const dockviewId = useContext(DockviewIdContext);

  useEffect(() => {
    if (!api.id || !dockviewId) {
      return undefined;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = () => timers.forEach(clearTimeout);

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
      clearTimers();
      return true;
    };

    if (!adopt()) {
      ADOPT_RETRY_DELAYS_MS.forEach((delay) =>
        timers.push(setTimeout(adopt, delay)),
      );
    }
    return clearTimers;
  }, [api.id, dockviewId]);

  return (
    <div
      ref={host}
      style={{ width: "100%", height: "100%", overflow: "auto" }}
    />
  );
};

export default PanelContent;
