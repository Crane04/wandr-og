// A small software stand-in for the browser's 2D canvas. The shared game code paints a
// few textures (stone, sky, glows, blood splats) with it; React Native has no canvas,
// so this draws into plain pixels and hands three.js a DataTexture instead.
// It covers exactly what that code uses: rects, circles, lines, gradients, and
// translate/rotate/save/restore.
import * as THREE from 'three';

type RGBA = [number, number, number, number];
type Paint = string | Gradient;

function parseColor(s: string): RGBA {
  s = s.trim();
  if (s[0] === '#') {
    const h = s.length === 4 ? s.slice(1).split('').map((c) => c + c).join('') : s.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return [0, 0, 0, 1];
}

class Gradient {
  stops: { at: number; c: RGBA }[] = [];
  constructor(private kind: 'linear' | 'radial', private g: number[]) {}
  addColorStop(at: number, color: string) {
    this.stops.push({ at, c: parseColor(color) });
    this.stops.sort((a, b) => a.at - b.at);
  }
  // colour at a point in the drawing's own coordinates
  at(x: number, y: number): RGBA {
    let t: number;
    if (this.kind === 'linear') {
      const [x0, y0, x1, y1] = this.g, dx = x1 - x0, dy = y1 - y0;
      t = ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1);
    } else {
      const [x0, y0, r0, , , r1] = this.g;
      t = (Math.hypot(x - x0, y - y0) - r0) / (r1 - r0 || 1);
    }
    t = Math.min(1, Math.max(0, t));
    const s = this.stops;
    if (t <= s[0].at) return s[0].c;
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i].at) {
        const k = (t - s[i - 1].at) / (s[i].at - s[i - 1].at || 1), a = s[i - 1].c, b = s[i].c;
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
      }
    }
    return s[s.length - 1].c;
  }
}

type Shape = { line: [number, number][] } | { circle: [number, number, number] };

class Context {
  fillStyle: Paint = '#000';
  strokeStyle: Paint = '#000';
  lineWidth = 1;
  private m = [1, 0, 0, 1, 0, 0]; // a b c d e f, as in canvas setTransform
  private stack: number[][] = [];
  private path: Shape[] = [];
  constructor(private cv: SoftCanvas) {}

  save() { this.stack.push([...this.m]); }
  restore() { const m = this.stack.pop(); if (m) this.m = m; }
  translate(x: number, y: number) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  rotate(r: number) {
    const [a, b, c, d] = this.m, cs = Math.cos(r), sn = Math.sin(r);
    this.m[0] = a * cs + c * sn; this.m[1] = b * cs + d * sn;
    this.m[2] = c * cs - a * sn; this.m[3] = d * cs - b * sn;
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number) { return new Gradient('linear', [x0, y0, x1, y1]); }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) { return new Gradient('radial', [x0, y0, r0, x1, y1, r1]); }

  beginPath() { this.path = []; }
  moveTo(x: number, y: number) { this.path.push({ line: [[x, y]] }); }
  lineTo(x: number, y: number) {
    const last = this.path[this.path.length - 1];
    if (last && 'line' in last) last.line.push([x, y]); else this.path.push({ line: [[x, y]] });
  }
  arc(x: number, y: number, r: number) { this.path.push({ circle: [x, y, r] }); } // full circles only, as used

  fillRect(x: number, y: number, w: number, h: number) {
    this.area([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], this.fillStyle);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    const cv = this.cv;
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(cv.height, y + h); py++)
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(cv.width, x + w); px++) cv.data.fill(0, (py * cv.width + px) * 4, (py * cv.width + px) * 4 + 4);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.segments([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
  }
  fill() {
    for (const s of this.path) if ('circle' in s) this.disc(s.circle, null);
  }
  stroke() {
    for (const s of this.path) {
      if ('circle' in s) this.disc(s.circle, this.lineWidth);
      else this.segments(s.line);
    }
  }

  // ---------- rasterising
  private toPx(x: number, y: number): [number, number] {
    const m = this.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  private toUser(px: number, py: number): [number, number] {
    const [a, b, c, d, e, f] = this.m, det = a * d - b * c || 1;
    const x = px - e, y = py - f;
    return [(d * x - c * y) / det, (a * y - b * x) / det];
  }
  private get scale() { return Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2])); }

  private plot(px: number, py: number, paint: Paint, cover = 1) {
    const cv = this.cv;
    if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return;
    const [ux, uy] = typeof paint === 'string' ? [0, 0] : this.toUser(px + 0.5, py + 0.5);
    const c = typeof paint === 'string' ? cv.color(paint) : paint.at(ux, uy);
    const a = c[3] * cover;
    if (a <= 0) return;
    const i = (py * cv.width + px) * 4, d = cv.data, da = d[i + 3] / 255, oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = (c[k] * a + d[i + k] * da * (1 - a)) / (oa || 1);
    d[i + 3] = oa * 255;
  }

  // a convex polygon given in drawing coordinates
  private area(pts: [number, number][], paint: Paint) {
    const p = pts.map(([x, y]) => this.toPx(x, y));
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(this.cv.width - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(this.cv.height - 1, Math.ceil(Math.max(...ys)));
    const axis = p.every((q, i) => q[0] === p[(i + 1) % 4][0] || q[1] === p[(i + 1) % 4][1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    // the common case, a solid opaque rectangle, is written straight in
    if (axis && typeof paint === 'string' && this.cv.color(paint)[3] >= 1) {
      const c = this.cv.color(paint), d = this.cv.data, w = this.cv.width;
      for (let py = y0; py <= y1; py++) {
        if (py + 0.5 < minY || py + 0.5 > maxY) continue;
        for (let px = x0; px <= x1; px++) {
          if (px + 0.5 < minX || px + 0.5 > maxX) continue;
          const i = (py * w + px) * 4;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
      return;
    }
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        if (axis) {
          if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
        } else {
          let inside = true;
          for (let i = 0; i < p.length && inside; i++) {
            const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
            if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0) inside = false;
          }
          if (!inside) continue;
        }
        this.plot(px, py, paint);
      }
    }
  }

  // a filled circle (width null) or a ring of the given line width
  private disc([x, y, r]: [number, number, number], width: number | null) {
    const [cx, cy] = this.toPx(x, y), s = this.scale, R = r * s, half = width === null ? 0 : (width * s) / 2;
    const reach = R + half + 1;
    const paint = width === null ? this.fillStyle : this.strokeStyle;
    for (let py = Math.floor(cy - reach); py <= cy + reach; py++) {
      for (let px = Math.floor(cx - reach); px <= cx + reach; px++) {
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
        const edge = width === null ? R - d : half - Math.abs(d - R);
        if (edge > -0.5) this.plot(px, py, paint, Math.min(1, edge + 0.5));
      }
    }
  }

  private segments(line: [number, number][]) {
    const s = this.scale, half = Math.max(0.5, (this.lineWidth * s) / 2);
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = this.toPx(...line[i - 1]), [bx, by] = this.toPx(...line[i]);
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
      for (let py = Math.floor(Math.min(ay, by) - half - 1); py <= Math.max(ay, by) + half + 1; py++) {
        for (let px = Math.floor(Math.min(ax, bx) - half - 1); px <= Math.max(ax, bx) + half + 1; px++) {
          const t = Math.min(1, Math.max(0, ((px + 0.5 - ax) * dx + (py + 0.5 - ay) * dy) / len2));
          const d = Math.hypot(px + 0.5 - (ax + dx * t), py + 0.5 - (ay + dy * t));
          if (d < half + 0.5) this.plot(px, py, this.strokeStyle, Math.min(1, half + 0.5 - d));
        }
      }
    }
  }
}

export class SoftCanvas {
  width = 300;
  height = 150;
  private buf: Uint8ClampedArray | null = null;
  private colors = new Map<string, RGBA>();
  get data() {
    if (!this.buf || this.buf.length !== this.width * this.height * 4) this.buf = new Uint8ClampedArray(this.width * this.height * 4);
    return this.buf;
  }
  color(s: string) {
    let c = this.colors.get(s);
    if (!c) { c = parseColor(s); this.colors.set(s, c); }
    return c;
  }
  getContext() { return new Context(this); }
}

export const createCanvas = () => new SoftCanvas();

// Stands in for THREE.CanvasTexture: same orientation and smooth filtering.
export function canvasTexture(c: SoftCanvas) {
  const { width: w, height: h, data } = c;
  const rows = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) rows.set(data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // canvases start at the top
  const t = new THREE.DataTexture(rows, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
