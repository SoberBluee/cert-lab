export type Pt = readonly [number, number];

/**
 * A polyline shifted sideways by `d` (positive = to the left of the direction of travel).
 * Wires are drawn as orthogonal polylines, so corners offset by the sum of both segment normals.
 */
export function offsetPolyline(pts: readonly Pt[], d: number): Pt[] {
  const normals = pts.slice(1).map((p, i) => {
    const q = pts[i]!;
    const len = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
    return [(p[1] - q[1]) / len, -(p[0] - q[0]) / len] as const;
  });
  return pts.map((p, i) => {
    const a = normals[Math.max(0, i - 1)]!;
    const b = normals[Math.min(normals.length - 1, i)]!;
    const n = i === 0 ? b : i === pts.length - 1 ? a : [a[0] + b[0], a[1] + b[1]];
    return [p[0] + n[0] * d, p[1] + n[1] * d] as const;
  });
}

export interface Path {
  pts: Pt[];
  /** Cumulative length at each point. */
  cum: number[];
  length: number;
}

export function toPath(pts: readonly Pt[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return { pts: [...pts], cum, length: cum[cum.length - 1]! };
}

/** The point a fraction `f` (0–1) of the way along a path. */
export function pointAt(path: Path, f: number): Pt {
  const d = Math.max(0, Math.min(1, f)) * path.length;
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i]! < d) i++;
  const a = path.pts[i - 1]!;
  const b = path.pts[i]!;
  const seg = path.cum[i]! - path.cum[i - 1]! || 1;
  const u = (d - path.cum[i - 1]!) / seg;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** The stretch of a path between two distances along it, corners included. */
export function subPath(path: Path, from: number, to: number): Pt[] {
  const a = Math.max(0, Math.min(path.length, from));
  const b = Math.max(a, Math.min(path.length, to));
  const out: Pt[] = [pointAt(path, a / (path.length || 1))];
  for (let i = 1; i < path.pts.length - 1; i++) if (path.cum[i]! > a && path.cum[i]! < b) out.push(path.pts[i]!);
  out.push(pointAt(path, b / (path.length || 1)));
  return out;
}

export const svgPoints = (pts: readonly Pt[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
