import { createContext } from "react";

import type { TabMenuAction } from "./types";

export interface TabOutputs {
  lastTabMenuAction?: TabMenuAction;
}

export type EmitTabOutput = (outputs: TabOutputs) => void;

// Dockview renders tabs through React portals that sit under
// DockviewReact, so a provider above it reaches them. The default does nothing.
export const TabOutputContext = createContext<EmitTabOutput>(() => undefined);
