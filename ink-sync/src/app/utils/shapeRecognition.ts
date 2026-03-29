/**
 * Smart Shape Recognition
 *
 * Analyzes freehand pen strokes and detects if they resemble
 * a line, arrow, rectangle, or ellipse. Returns a cleaned-up
 * geometric element if a match is found, or null to keep the
 * original pen stroke.
 */

interface Point { x: number; y: number; }

interface PenStroke {
  id: string;
  type: 'pen';
  points: Point[];
  color: string;
  strokeWidth: number;
  opacity?: number;
}

type RecognizedShape =
  | { type: 'line';    x1: number; y1: number; x2: number; y2: number }
  | { type: 'arrow';   x1: number; y1: number; x2: number; y2: number }
  | { type: 'rect';    x1: number; y1: number; x2: number; y2: number }
  | { type: 'ellipse'; x1: number; y1: number; x2: number; y2: number }
  | null;

// ── Math helpers ──────────────────────────────────────────────────────────────

function dist(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function centroid(pts: Point[]): Point {
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

/** Downsample points to at most `n` evenly-spaced samples */
function resample(pts: Point[], n: number): Point[] {
  if (pts.length <= n) return pts;
  const result: Point[] = [];
  const step = (pts.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    result.push(pts[Math.round(i * step)]);
  }
  return result;
}

/** Bounding box of a point cloud */
function bbox(pts: Point[]) {
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Perpendicular distance from point p to line (a→b) */
function distToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return dist(p, a);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

// ── Stroke feature extraction ─────────────────────────────────────────────────

function strokeLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

/** How closed is the stroke? 0 = open, 1 = perfectly closed */
function closedness(pts: Point[]): number {
  const startEndDist = dist(pts[0], pts[pts.length - 1]);
  const perimeter = strokeLength(pts);
  return perimeter > 0 ? Math.max(0, 1 - startEndDist / perimeter) : 0;
}

/** RMS deviation of all points from the line (first→last) */
function linearity(pts: Point[]): number {
  const a = pts[0], b = pts[pts.length - 1];
  const dists = pts.map(p => distToLine(p, a, b));
  const rms = Math.sqrt(dists.reduce((s, d) => s + d * d, 0) / dists.length);
  const totalLen = dist(a, b);
  return totalLen > 0 ? rms / totalLen : 1;
}

/**
 * Detect corners — indices of points where the direction changes sharply.
 * Returns sorted array of corner indices.
 */
function detectCorners(pts: Point[], windowSize = 5, minAngleDeg = 50): number[] {
  const corners: number[] = [];
  const toRad = Math.PI / 180;
  for (let i = windowSize; i < pts.length - windowSize; i++) {
    const prev = pts[i - windowSize];
    const curr = pts[i];
    const next = pts[i + windowSize];
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    if (len1 === 0 || len2 === 0) continue;
    const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) / toRad;
    if (angleDeg > minAngleDeg) corners.push(i);
  }

  // Deduplicate corners that are too close together
  const dedupedCorners: number[] = [];
  const minGap = windowSize * 2;
  for (const c of corners) {
    if (!dedupedCorners.length || c - dedupedCorners[dedupedCorners.length - 1] >= minGap) {
      dedupedCorners.push(c);
    }
  }
  return dedupedCorners;
}

// ── Shape detectors ───────────────────────────────────────────────────────────

/** Detect a straight line or arrow */
function tryLine(pts: Point[]): RecognizedShape {
  const lin = linearity(pts);
  const closed = closedness(pts);
  if (lin > 0.12 || closed > 0.6) return null;

  const start = pts[0];
  const end   = pts[pts.length - 1];
  const len   = dist(start, end);
  if (len < 15) return null;

  // Detect arrow: check if the stroke ends with a sharp V-shape (arrowhead)
  // by looking at the last 20% of points
  const tail = pts.slice(Math.floor(pts.length * 0.8));
  const isArrow = detectArrowhead(tail, start, end);

  return isArrow
    ? { type: 'arrow', x1: start.x, y1: start.y, x2: end.x, y2: end.y }
    : { type: 'line',  x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

/** Check if the tail of a stroke looks like an arrowhead */
function detectArrowhead(tail: Point[], lineStart: Point, lineEnd: Point): boolean {
  if (tail.length < 4) return false;
  // Direction of main line
  const mainAngle = Math.atan2(lineEnd.y - lineStart.y, lineEnd.x - lineStart.x);
  // Check if tail points diverge sharply from the main direction
  let maxDeviation = 0;
  for (const p of tail) {
    const d = distToLine(p, lineStart, lineEnd);
    maxDeviation = Math.max(maxDeviation, d);
  }
  const mainLen = dist(lineStart, lineEnd);
  // Arrowhead: tail deviates noticeably relative to stroke length
  return maxDeviation / mainLen > 0.08 && maxDeviation > 8;
}

/** Detect a rectangle via corner analysis */
function tryRect(pts: Point[]): RecognizedShape {
  const closed = closedness(pts);
  if (closed < 0.45) return null;

  const sampled = resample(pts, 64);
  const corners = detectCorners(sampled, 4, 55);

  if (corners.length < 3 || corners.length > 6) return null;

  const bb = bbox(pts);
  if (bb.w < 10 || bb.h < 10) return null;

  // Aspect ratio sanity: not a degenerate sliver
  const aspect = Math.max(bb.w, bb.h) / Math.min(bb.w, bb.h);
  if (aspect > 12) return null;

  // Check that points are mostly near the perimeter of the bounding box
  const ctr = centroid(pts);
  const perimeterScore = pts.filter(p => {
    const nearLeft   = Math.abs(p.x - bb.minX) < bb.w * 0.25;
    const nearRight  = Math.abs(p.x - bb.maxX) < bb.w * 0.25;
    const nearTop    = Math.abs(p.y - bb.minY) < bb.h * 0.25;
    const nearBottom = Math.abs(p.y - bb.maxY) < bb.h * 0.25;
    return nearLeft || nearRight || nearTop || nearBottom;
  }).length / pts.length;

  if (perimeterScore < 0.65) return null;

  return {
    type: 'rect',
    x1: bb.minX, y1: bb.minY,
    x2: bb.maxX, y2: bb.maxY,
  };
}

/** Detect an ellipse via radial variance */
function tryEllipse(pts: Point[]): RecognizedShape {
  const closed = closedness(pts);
  if (closed < 0.45) return null;

  const bb = bbox(pts);
  if (bb.w < 10 || bb.h < 10) return null;

  // Aspect ratio sanity
  const aspect = Math.max(bb.w, bb.h) / Math.min(bb.w, bb.h);
  if (aspect > 8) return null;

  const ctr = centroid(pts);
  const rx = bb.w / 2, ry = bb.h / 2;

  // For each point, compute normalized distance from ellipse boundary
  const errors = pts.map(p => {
    const nx = (p.x - ctr.x) / (rx || 1);
    const ny = (p.y - ctr.y) / (ry || 1);
    return Math.abs(Math.hypot(nx, ny) - 1);
  });

  const meanError = errors.reduce((s, e) => s + e, 0) / errors.length;

  // Check corners — ellipses should have very few sharp corners
  const sampled = resample(pts, 64);
  const corners = detectCorners(sampled, 4, 70);

  // An ellipse has low fitting error and very few corners
  if (meanError < 0.28 && corners.length <= 2) {
    return {
      type: 'ellipse',
      x1: bb.minX, y1: bb.minY,
      x2: bb.maxX, y2: bb.maxY,
    };
  }

  return null;
}

// ── Minimum stroke requirements ───────────────────────────────────────────────

const MIN_POINTS = 8;
const MIN_LENGTH = 20; // pixels

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempt to recognize the pen stroke as a geometric shape.
 * Returns the recognized shape data, or null if no match.
 *
 * Order: line/arrow → ellipse → rect
 * (ellipse before rect to avoid circles being snapped to squares)
 */
export function recognizeShape(stroke: PenStroke): RecognizedShape {
  const pts = stroke.points ?? [];
  if (pts.length < MIN_POINTS) return null;
  if (strokeLength(pts) < MIN_LENGTH) return null;

  return tryLine(pts) ?? tryEllipse(pts) ?? tryRect(pts);
}

/**
 * Given a recognized shape and the original stroke,
 * return a new DrawElement that replaces the pen stroke.
 */
export function buildShapeElement(
  shape: NonNullable<RecognizedShape>,
  stroke: PenStroke,
): object {
  return {
    id: stroke.id,
    type: shape.type,
    x1: shape.x1,
    y1: shape.y1,
    x2: shape.x2,
    y2: shape.y2,
    color: stroke.color,
    strokeWidth: stroke.strokeWidth,
    opacity: stroke.opacity,
  };
}