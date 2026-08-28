// Loads the rear-view kart photo, chroma-keys the magenta background out,
// crops to the opaque bounding box, and precomputes one recolored variant
// per palette color (selective HSL tint: only the white/gray body repaints,
// tires/glass/tail-lights are left alone). Everything below runs once at
// load time — callers just look up a ready-made canvas per frame.
(function () {
  let ready = false;
  let baseAspect = 1;
  const variants = new Map(); // hex color -> { canvas, aspect }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function chromaKeyAndCrop(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const raw = document.createElement('canvas');
    raw.width = w; raw.height = h;
    const rctx = raw.getContext('2d');
    rctx.drawImage(img, 0, 0);
    const data = rctx.getImageData(0, 0, w, h);
    const px = data.data;

    // Sample the key color from a corner (background), not hardcoded, in
    // case the generated shade of magenta drifts slightly.
    const keyR = px[0], keyG = px[1], keyB = px[2];
    const INNER = 55, OUTER = 82;

    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const dist = Math.sqrt((r - keyR) ** 2 + (g - keyG) ** 2 + (b - keyB) ** 2);
      let alpha;
      if (dist <= INNER) alpha = 0;
      else if (dist >= OUTER) alpha = 255;
      else alpha = Math.round(255 * (dist - INNER) / (OUTER - INNER));
      px[i + 3] = alpha;
      if (alpha > 10) {
        const idx = i / 4;
        const x = idx % w, y = Math.floor(idx / w);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    rctx.putImageData(data, 0, 0);

    const pad = 2;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const cw = Math.max(1, maxX - minX + 1), ch = Math.max(1, maxY - minY + 1);

    const cropped = document.createElement('canvas');
    cropped.width = cw; cropped.height = ch;
    cropped.getContext('2d').drawImage(raw, minX, minY, cw, ch, 0, 0, cw, ch);
    return cropped;
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function tint(baseCanvas, hex) {
    const w = baseCanvas.width, h = baseCanvas.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const octx = out.getContext('2d');
    octx.drawImage(baseCanvas, 0, 0);
    const data = octx.getImageData(0, 0, w, h);
    const px = data.data;

    const n = parseInt(hex.slice(1), 16);
    const [targetH, targetS] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
    const paintSat = Math.max(targetS, 0.45);

    // Blend continuously by "how white/gray is this pixel" rather than a
    // hard threshold — a binary cutoff turns JPEG compression noise near
    // the boundary into visible speckling, a smooth blend just softens it.
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 5) continue;
      const [pixHue, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      const reddish = s > 0.04 && (pixHue < 28 || pixHue > 332) ? 1 : 0;
      const satFactor = clamp01((0.22 - s) / 0.22);
      const lightFactor = clamp01((l - 0.28) / 0.14);
      const paintAmount = satFactor * lightFactor * (1 - reddish);
      if (paintAmount > 0.02) {
        // The source photo's body is quite bright overall; HSL desaturates
        // toward pastel at high lightness regardless of saturation, so
        // compress the lightness range to let fully-saturated colors (like
        // red) actually read as bold rather than washed out. Still keeps
        // relative highlight/shadow shading.
        const paintLightness = 0.28 + l * 0.5;
        const [tr, tg, tb] = hslToRgb(targetH, paintSat, paintLightness);
        px[i] += (tr - px[i]) * paintAmount;
        px[i + 1] += (tg - px[i + 1]) * paintAmount;
        px[i + 2] += (tb - px[i + 2]) * paintAmount;
      }
    }
    octx.putImageData(data, 0, 0);
    return out;
  }

  function init(url, palette) {
    const img = new Image();
    img.onload = () => {
      const base = chromaKeyAndCrop(img);
      baseAspect = base.width / base.height;
      for (const hex of palette) variants.set(hex, tint(base, hex));
      ready = true;
    };
    img.onerror = () => { /* stay unready; callers fall back to drawn shape */ };
    img.src = url;
  }

  function get(hex) {
    if (!ready) return null;
    const canvas = variants.get(hex);
    return canvas ? { canvas, aspect: baseAspect } : null;
  }

  window.KartSprite = { init, get, get isReady() { return ready; } };
})();
