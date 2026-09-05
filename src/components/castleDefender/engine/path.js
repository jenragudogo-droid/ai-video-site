/* ------------------------------------------------------------------ *
 * Castle Defender — roads.
 *
 * A route is authored as a handful of control points. It is smoothed
 * with a Catmull-Rom spline and sampled into a dense polyline with
 * cumulative distances, so an enemy is just (route, distance) and its
 * position, heading and "how far along" all fall out of one lookup.
 * Pure maths, no DOM.
 * ------------------------------------------------------------------ */

const SAMPLE_STEP = 6;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/* Turns control points into { pts, dist, length }. `pts[i]` is a
   sampled point, `dist[i]` its distance from the start. */
export function buildRoute(points) {
  const raw = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(2, Math.ceil(segLen / SAMPLE_STEP));
    for (let k = 0; k < steps; k += 1) raw.push(catmull(p0, p1, p2, p3, k / steps));
  }
  raw.push({ x: points[n - 1].x, y: points[n - 1].y });

  const pts = [];
  const dist = [];
  let total = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (i > 0) total += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
    pts.push(raw[i]);
    dist.push(total);
  }
  return { pts, dist, length: total, control: points };
}

/* Position and unit tangent at distance `d` along the route. Clamps at
   both ends so a slightly overshooting enemy still resolves. */
export function sampleRoute(route, d) {
  const { pts, dist } = route;
  const last = pts.length - 1;
  if (d <= 0) {
    const a = pts[0]; const b = pts[1] || pts[0];
    return withTangent(a.x, a.y, a, b);
  }
  if (d >= route.length) {
    const a = pts[last - 1] || pts[last]; const b = pts[last];
    return withTangent(b.x, b.y, a, b);
  }
  /* binary search for the segment */
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= d) lo = mid; else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const seg = dist[hi] - dist[lo] || 1;
  const f = (d - dist[lo]) / seg;
  return withTangent(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a, b);
}

function withTangent(x, y, a, b) {
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  const l = Math.hypot(tx, ty) || 1;
  tx /= l; ty /= l;
  return { x, y, tx, ty, nx: -ty, ny: tx };
}

/* Closest sampled point on a route to (x, y): { d, x, y, dist2 }. */
export function nearestOnRoute(route, x, y) {
  let best = 0;
  let bestD2 = Infinity;
  const { pts } = route;
  for (let i = 0; i < pts.length; i += 1) {
    const dx = pts[i].x - x;
    const dy = pts[i].y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return { d: route.dist[best], x: pts[best].x, y: pts[best].y, dist2: bestD2 };
}

/* Closest point across every route. */
export function nearestOnRoutes(routes, x, y) {
  let best = null;
  for (let r = 0; r < routes.length; r += 1) {
    const n = nearestOnRoute(routes[r], x, y);
    if (!best || n.dist2 < best.dist2) best = { ...n, route: r };
  }
  return best;
}
