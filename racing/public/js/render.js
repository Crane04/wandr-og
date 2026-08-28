// Pseudo-3D projection + drawing (road, billboarded sprites, in-viewport HUD).
// Classic segment-based "OutRun/SNES-style" technique: the camera rides with
// the viewer's kart (hood height), each segment's curvature accumulates into
// a running screen-space x offset, and everything else (other karts, item
// boxes, shells) is drawn as a billboard sprite projected the same way.
(function () {
  const CAMERA_HEIGHT = 1000;
  const FIELD_OF_VIEW = 100;
  const CAMERA_DEPTH = 1 / Math.tan((FIELD_OF_VIEW / 2) * Math.PI / 180);
  const DRAW_DISTANCE = 300;
  const FOG_START = 0.75; // fraction of draw distance where fog-to-sky begins

  const COLORS = {
    sky1: '#78c7ff', sky2: '#bfe8ff',
    light: { road: '#6d7178', grass: '#3ea44b', rumble: '#d64545', lane: '#f0f0f0' },
    dark: { road: '#5f636a', grass: '#2f8a3c', rumble: '#f0f0f0', lane: '#5f636a' },
  };
  // Night variant for the "Night" condition — darker/cooler across the
  // board so lamppost glow (already in the scenery set) actually reads as
  // light sources instead of a redundant detail.
  const COLORS_NIGHT = {
    sky1: '#0a1030', sky2: '#1c2a52',
    light: { road: '#2b2e3a', grass: '#123018', rumble: '#8a2a2a', lane: '#8890a8' },
    dark: { road: '#25272f', grass: '#0e2814', rumble: '#8890a8', lane: '#2b2e3a' },
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mixColor(hex1, hex2, t) {
    const a = parseInt(hex1.slice(1), 16), b = parseInt(hex2.slice(1), 16);
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(lerp(ar, br, t)), g = Math.round(lerp(ag, bg, t)), bl = Math.round(lerp(ab, bb, t));
    return `rgb(${r},${g},${bl})`;
  }

  // Camera sits CAMERA_HEIGHT world-units *above* the road plane (world.y=0),
  // so camera-space y is -CAMERA_HEIGHT — near segments (large scale) must
  // project toward the screen bottom, far ones toward the horizon (height/2).
  function projectEdge(worldZ, playerX, xOffset, camera, width, height, roadWidth) {
    const camZ = worldZ - camera.z;
    if (camZ <= 0.1) return null;
    const scale = CAMERA_DEPTH / camZ;
    const camX = xOffset - playerX * roadWidth;
    return {
      x: width / 2 + scale * camX * (width / 2),
      y: height / 2 + scale * CAMERA_HEIGHT * (height / 2),
      w: scale * roadWidth * (width / 2),
      scale,
    };
  }

  function projectSprite(worldX, worldZ, playerX, xOffset, camera, width, height, roadWidth) {
    const camZ = worldZ - camera.z;
    if (camZ <= 0.1) return null;
    const scale = CAMERA_DEPTH / camZ;
    const camX = (worldX - playerX) * roadWidth + xOffset;
    return {
      x: width / 2 + scale * camX * (width / 2),
      y: height / 2 + scale * CAMERA_HEIGHT * (height / 2),
      scale,
    };
  }

  function drawBackground(ctx, width, height, camera, active, night) {
    const horizon = height / 2;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, active.sky1);
    sky.addColorStop(1, active.sky2);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);
    // Ground-level backdrop for the bottom half — the road/grass trapezoids
    // drawn later narrow sharply near the horizon and don't reach the full
    // canvas width there, so without this the canvas element's own (fixed,
    // day-blue) CSS background shows through the gap. That's invisible in
    // daylight since the two colors happen to be close, but at night it
    // left a bright sky-blue band down both sides of a dark scene.
    ctx.fillStyle = active.light.grass;
    ctx.fillRect(0, horizon, width, height - horizon);

    // A scattering of static stars at night — positions are a deterministic
    // hash of their index, not Math.random(), so they don't re-shuffle
    // every frame.
    if (night) {
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 0; i < 60; i++) {
        const sx = (i * 97.31) % width;
        const sy = (i * 53.7) % (horizon * 0.85);
        ctx.globalAlpha = 0.3 + ((i * 37) % 100) / 140;
        ctx.fillRect(sx, sy, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }

    // Cheap parallax hill layers, scrolling with camera x/z for a sense of motion.
    const scrollFar = -(camera.z * 0.00006) % (width * 2);
    const scrollNear = -(camera.z * 0.00018) % (width * 2);
    const hillFar = night ? 'rgba(8,16,26,.65)' : 'rgba(46,110,66,.55)';
    const hillNear = night ? 'rgba(5,10,18,.8)' : 'rgba(31,86,48,.7)';
    drawHillLayer(ctx, width, horizon, scrollFar, 46, hillFar);
    drawHillLayer(ctx, width, horizon, scrollNear, 74, hillNear);
  }

  function drawHillLayer(ctx, width, horizon, scroll, amp, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-width, horizon);
    const step = width / 8;
    for (let x = -width; x <= width * 2; x += step) {
      const y = horizon - amp - Math.sin((x + scroll) * 0.006) * amp * 0.5;
      ctx.lineTo(x + scroll % step, y);
    }
    ctx.lineTo(width * 2, horizon);
    ctx.closePath();
    ctx.fill();
  }

  function drawQuad(ctx, x1, y1, w1, x2, y2, w2, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1);
    ctx.lineTo(x2 - w2, y2);
    ctx.lineTo(x2 + w2, y2);
    ctx.lineTo(x1 + w1, y1);
    ctx.closePath();
    ctx.fill();
  }

  // Checkered black/white finish-line band, spanning the full road width —
  // subdivides the segment's trapezoid into columns rather than a flat
  // stripe, so it actually reads as a checker pattern, not two colored bars.
  function drawFinishLineQuad(ctx, p1, p2, segIndex, fogT, skyColor) {
    const cols = 8;
    for (let i = 0; i < cols; i++) {
      const t0 = i / cols, t1 = (i + 1) / cols;
      const x1a = (p1.x - p1.w) + 2 * p1.w * t0;
      const x1b = (p1.x - p1.w) + 2 * p1.w * t1;
      const x2a = (p2.x - p2.w) + 2 * p2.w * t0;
      const x2b = (p2.x - p2.w) + 2 * p2.w * t1;
      const dark = (segIndex + i) % 2 === 0;
      ctx.fillStyle = mixColor(dark ? '#111111' : '#f4f4f4', skyColor, fogT);
      ctx.beginPath();
      ctx.moveTo(x1a, p1.y);
      ctx.lineTo(x2a, p2.y);
      ctx.lineTo(x2b, p2.y);
      ctx.lineTo(x1b, p1.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Renders the road + collects/draws billboard sprites (other karts, item
  // boxes, shells) for one viewport. `viewer` supplies {x, totalDistance}.
  // `sprites` is an array of {x, z, draw(ctx, scale), width} in world space.
  // `conditions` (optional) is { night, fogStart, visibleDistance } from the
  // selected race condition (see index.html's CONDITIONS) — omitted
  // entirely, all three fall back to the normal clear-day look.
  //
  // fogStart alone (moving where the color blend toward sky starts) turned
  // out to barely register: distant segments are already tiny from
  // perspective, so recoloring them earlier didn't read as "reduced
  // visibility" — it only became obvious once the actual draw/cull range
  // itself shrinks. visibleDistance (0..1, fraction of the normal
  // DRAW_DISTANCE) does that: the road-drawing loop and sprite culling
  // both stop at `maxN` instead of the full range, and fogT is normalized
  // against maxN (not the fixed DRAW_DISTANCE) so the fog-to-sky blend
  // still finishes exactly at that now-closer cutoff — a real, hard wall
  // of fog, not just an earlier tint.
  function renderScene(ctx, track, viewer, width, height, sprites, conditions) {
    const night = !!(conditions && conditions.night);
    const fogStart = (conditions && conditions.fogStart) ?? FOG_START;
    const visibleDistance = (conditions && conditions.visibleDistance) ?? 1;
    const maxN = Math.max(1, Math.round(DRAW_DISTANCE * visibleDistance));
    const active = night ? COLORS_NIGHT : COLORS;
    const camera = { z: viewer.totalDistance };
    drawBackground(ctx, width, height, camera, active, night);

    const baseSegIndex = Track.segmentIndexAt(track, camera.z);
    const baseZ = camera.z - (camera.z % track.segmentLength);
    const basePercent = (camera.z % track.segmentLength) / track.segmentLength;
    const baseSeg = track.segments[baseSegIndex];

    let x = 0;
    let dx = -(baseSeg.curve * basePercent);
    let maxY = height;
    const spritesByN = new Map();
    for (const s of sprites) {
      const rel = s.z - camera.z;
      if (rel < 0 || rel > maxN * track.segmentLength) continue;
      const n = Math.floor(rel / track.segmentLength);
      if (!spritesByN.has(n)) spritesByN.set(n, []);
      spritesByN.get(n).push(s);
    }
    const spriteDrawList = [];

    for (let n = 0; n < maxN; n++) {
      const worldZ1 = baseZ + n * track.segmentLength;
      const worldZ2 = worldZ1 + track.segmentLength;
      const segIndex = Track.segmentIndexAt(track, worldZ1);
      const seg = track.segments[segIndex];

      const p1 = projectEdge(worldZ1, viewer.x, x, camera, width, height, track.roadWidth);
      const xAtP1 = x;
      x += dx;
      dx += seg.curve;
      const p2 = projectEdge(worldZ2, viewer.x, x, camera, width, height, track.roadWidth);

      const list = spritesByN.get(n);
      if (list) {
        for (const s of list) {
          const proj = projectSprite(s.x, s.z, viewer.x, xAtP1, camera, width, height, track.roadWidth);
          if (proj) spriteDrawList.push({ s, proj, n });
        }
      }

      if (!p1 || !p2 || p2.y >= p1.y || p2.y >= maxY) continue;

      const fogT = Math.max(0, (n / maxN - fogStart) / (1 - fogStart));
      const palette = active[seg.color];
      const grassColor = mixColor(palette.grass, active.sky2, fogT);
      const rumbleColor = mixColor(palette.rumble, active.sky2, fogT);
      const roadColor = mixColor(palette.road, active.sky2, fogT);
      const laneColor = mixColor(palette.lane, active.sky2, fogT);

      drawQuad(ctx, p1.x, p1.y, p1.w * 1.55, p2.x, p2.y, p2.w * 1.55, grassColor);
      drawQuad(ctx, p1.x, p1.y, p1.w * 1.18, p2.x, p2.y, p2.w * 1.18, rumbleColor);
      drawQuad(ctx, p1.x, p1.y, p1.w, p2.x, p2.y, p2.w, roadColor);
      if (seg.finishLine) {
        drawFinishLineQuad(ctx, p1, p2, segIndex, fogT, active.sky2);
      } else {
        drawQuad(ctx, p1.x, p1.y, p1.w * 0.035, p2.x, p2.y, p2.w * 0.035, laneColor);
      }

      maxY = p2.y;
    }

    // Far-to-near so nearer sprites draw on top. Sprite pixel size uses the
    // same scale*worldSize*(width/2) shape as the road edges above — a kart
    // is authored as roughly a fifth of the road's width in world units.
    const spriteBaseWorldWidth = track.roadWidth * 0.22;
    spriteDrawList.sort((a, b) => b.n - a.n);
    for (const { s, proj } of spriteDrawList) {
      if (proj.scale <= 0) continue;
      ctx.save();
      ctx.translate(proj.x, proj.y);
      const scaleW = proj.scale * spriteBaseWorldWidth * (width / 2);
      s.draw(ctx, scaleW);
      ctx.restore();
    }
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function drawHudPanel(ctx, left, top, width, height, car, targetLaps) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,8,20,.6)';
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 2;
    roundRect(ctx, left + 14, top + 14, 168, 96, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = car.position === 1 ? '#ffd23f' : '#fff';
    ctx.font = '900 26px "Baloo 2", Arial';
    ctx.fillText(ordinal(car.position || 1), left + 26, top + 44);

    ctx.font = '700 12px Arial';
    ctx.fillStyle = '#cdd6ff';
    ctx.fillText(`LAP ${Math.min(car.laps + 1, targetLaps)}/${targetLaps}`, left + 26, top + 62);

    ctx.font = '900 22px "Baloo 2", Arial';
    ctx.fillStyle = '#7fe8ff';
    ctx.fillText(String(Math.max(0, Math.round(car.speed / 20))).padStart(3, '0'), left + 26, top + 88);
    ctx.font = '700 10px Arial';
    ctx.fillStyle = '#9fb0d8';
    ctx.fillText('KM/H', left + 74, top + 88);

    // Nitro meter
    const meterX = left + 118, meterY = top + 26, meterW = 14, meterH = 68;
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.strokeRect(meterX, meterY, meterW, meterH);
    const fill = Math.max(0, Math.min(1, car.boostCharge / 100));
    const grad = ctx.createLinearGradient(0, meterY + meterH, 0, meterY);
    grad.addColorStop(0, '#ff7a00');
    grad.addColorStop(1, '#fff34d');
    ctx.fillStyle = car.boosting ? '#ff2fd0' : grad;
    ctx.fillRect(meterX, meterY + meterH * (1 - fill), meterW, meterH * fill);

    // Held item count — the primary "what am I carrying" display is the
    // icon row drawn above the kart itself; this is just a quick-glance badge.
    if (car.items && car.items.length) {
      ctx.beginPath();
      ctx.arc(left + 148, top + 20, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '900 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`x${car.items.length}`, left + 148, top + 24);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
  }

  function drawMinimap(ctx, x, y, w, h, track, cars, humanIds) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,10,20,.6)';
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.stroke();
    ctx.beginPath();
    track.polyline.forEach((p, i) => {
      const px = x + 10 + p.u * (w - 20);
      const py = y + 10 + p.v * (h - 20);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Finish-line marker — polyline[0] is segment 0, the same spot the
    // checkered band is painted on the road itself.
    const start = track.polyline[0];
    const sx = x + 10 + start.u * (w - 20);
    const sy = y + 10 + start.v * (h - 20);
    const rows = 4, cols = 2, cellSize = 3.5;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-Math.PI / 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#fff' : '#111';
        ctx.fillRect(-cols * cellSize / 2 + c * cellSize, -rows * cellSize / 2 + r * cellSize, cellSize, cellSize);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-cols * cellSize / 2, -rows * cellSize / 2, cols * cellSize, rows * cellSize);
    ctx.restore();

    cars.forEach((car) => {
      const t = ((car.totalDistance % track.length) + track.length) % track.length / track.length;
      const idx = Math.min(track.polyline.length - 1, Math.floor(t * track.polyline.length));
      const p = track.polyline[idx];
      const px = x + 10 + p.u * (w - 20);
      const py = y + 10 + p.v * (h - 20);
      ctx.beginPath();
      ctx.arc(px, py, humanIds.has(car.id) ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = car.color;
      ctx.fill();
      if (humanIds.has(car.id)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    });
    ctx.restore();
  }

  window.Render = { renderScene, drawHudPanel, drawMinimap, ordinal, DRAW_DISTANCE };
})();
