// Public API of @spider/layout: placement (ELK), incremental layout, orthogonal routing, layout IO.
export * from "./layout-file.ts";
export { layoutDiagram, type LayoutOptions } from "./layout.ts";
export { ARROW_LENGTH, ARROW_STUB, BORDER_GAP, routeEdges, ROUTE_MARGIN } from "./router.ts";
export { reconcileLayout, parseLayoutFile, serializeLayoutFile } from "./layout-io.ts";
export {
  CONTAINER_PADDING,
  CONTAINER_TITLE_SPACE,
  DEFAULT_CONTAINER_SIZE,
  LABEL_BELOW_SPACE,
  containerOverlapDiagnostics,
  containerOverlaps,
  fitContainers,
  type ContainerOverlap,
  labelSpace,
  nodeSize,
  type Rect,
} from "./geometry.ts";
