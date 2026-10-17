// Shared contract: the layout sidecar (`<diagram>.spd.layout.json`). Geometry only, keyed by
// model IDs. Coordinates are absolute (top-left origin), including for nested nodes.
import type { Side } from "@spider/profile-schema";

export type Point = [x: number, y: number];

export interface NodeLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pinned nodes never move during layout. Set when a user drags a node. */
  pinned?: boolean;
  /** Containers only: minimum size set by the user; the box is never smaller than its content. */
  minW?: number;
  minH?: number;
}

export interface EdgeLayout {
  /** Full polyline from source boundary to target boundary (incl. both endpoints). */
  points: Point[];
  /** Manually routed: keep `points` as is instead of re-routing. */
  manual?: boolean;
  sourcePort?: Side;
  targetPort?: Side;
  /** Center of the edge label, if the edge has one. */
  labelPos?: Point;
}

export interface LayoutFile {
  version: 1;
  nodes: Record<string, NodeLayout>;
  edges: Record<string, EdgeLayout>;
}

export function emptyLayout(): LayoutFile {
  return { version: 1, nodes: {}, edges: {} };
}
