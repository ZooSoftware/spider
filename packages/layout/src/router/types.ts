// Router constants, directions and the shared job/context types.
import type { ModelEdge } from "@spider/core";
import type { Side } from "@spider/profile-schema";
import type { Rect } from "../geometry.ts";
import type { EdgeLayout, Point } from "../layout-file.ts";
import type { Checker, ObstacleIndex } from "./obstacles.ts";

/** Clearance kept between routes and non-endpoint node boxes. */
export const ROUTE_MARGIN = 12;
/** Length of the straight stub leaving/entering a port. */
export const STUB = 12;
/** Arrowhead length drawn by the renderer (marker 8 × stroke 1.5). */
export const ARROW_LENGTH = 12;
/** Minimum straight run at an end with an arrowhead, so the arrow never sits on a bend. */
export const ARROW_STUB = ARROW_LENGTH + 12;
/** Segments closer than this to a container border (and parallel to it) look like the border. */
export const BORDER_GAP = 10;
/** Cost of running along a container border, in px of route length. */
export const BORDER_COST = 2 * 40;
/** Cost of one bend, in px of route length. */
export const BEND = 40;
/** Distance between nudged parallel segments. */
export const SEP = 10;
/** Weight of the penalty for a port side facing away from the other endpoint. */
export const FACING = 30;
/** Maximum distance between neighboring ports on one side. */
export const SLOT_GAP = 28;

/** right, down, left, up */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;
export const SIDE_DIR: Record<Side, Dir> = { right: 0, bottom: 1, left: 2, top: 3 };
export const ALL_SIDES: Side[] = ["right", "bottom", "left", "top"];
export const opp = (d: Dir): Dir => ((d + 2) % 4) as Dir;

export interface NodeInfo {
  id: string;
  /** Occupied box incl. outside label; the routing boundary. */
  box: Rect;
  /** Shape box; left/right ports stay within its vertical extent. */
  shape: Rect;
  ports?: Side[];
  labelBelow: boolean;
  anc: string[];
  obstacle: number;
}

export interface End {
  node: NodeInfo;
  /** Length of the straight run at this end (longer where an arrowhead is drawn). */
  stub: number;
  sides: Side[];
  /** Endpoint is an ancestor container of the other end: stub points inward. */
  inward: boolean;
  side: Side;
  pos: Point;
}

export interface Job {
  edge: ModelEdge;
  index: number;
  s: End;
  t: End;
  excluded: Set<number>;
  pts: Point[];
  /** Checker with the full margin (from side selection). */
  base: Checker;
  /** Checker the current route was validated with (margin may have been relaxed). */
  checker: Checker;
  prev?: EdgeLayout;
}

export interface Ctx {
  infos: Map<string, NodeInfo>;
  obstacles: Rect[];
  index: ObstacleIndex;
  bounds: Rect;
  /** Container border lines; routes should cross them, never run along them. */
  borders: Border[];
}

export interface Border {
  /** 0: vertical line at x = c; 1: horizontal line at y = c. */
  ax: 0 | 1;
  c: number;
  lo: number;
  hi: number;
}
