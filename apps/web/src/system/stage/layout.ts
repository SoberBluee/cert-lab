import type { Pt } from './geometry';

/** A box on the stage. Scenes give `kind` its meaning; the renderer only lays it out. */
export interface StageNode {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A wire between two nodes. Dots travel `from` → `to` on one lane and back on the other. */
export interface StageWire {
  id: string;
  from: string;
  to: string;
  pts: Pt[];
  /** On-screen travel time at 1×. */
  stageMs: number;
  /** Modeled one-way latency, ms. */
  ms: number;
}

export interface StageLayout {
  width: number;
  height: number;
  nodes: StageNode[];
  wires: StageWire[];
  /** Where latency is measured from, for the label under the stage. */
  scale: string;
}
