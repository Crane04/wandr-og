// Segment-based pseudo-3D track model (OutRun/SNES-style "Mode 7" racer technique).
// The renderer never needs absolute world position — only each car's scalar
// totalDistance (z) and lateral x (-1..1). The polyline below exists purely
// for the minimap. Multiple named layouts share the same section-building
// helpers and the same generic post-processing (item boxes, hazards,
// scenery, finish line) — only the shape (the sequence of straights/curves)
// differs per layout.
(function () {
  const SEGMENT_LENGTH = 200;
  const ROAD_WIDTH = 2000; // world units, half-width used for projection scale
  const RUMBLE_LENGTH = 3; // segments per rumble-strip color band

  const CURVE = { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6, EXTREME: 8 };
  const LEN = { SHORT: 25, MEDIUM: 50, LONG: 100 };

  function easeIn(a, b, t) { return a + (b - a) * t * t; }
  function easeInOut(a, b, t) { return a + (b - a) * ((-Math.cos(t * Math.PI) / 2) + 0.5); }

  // Each layout function receives a small toolkit ({addStraight, addCurve,
  // addSCurves, CURVE, LEN}) and just calls them in sequence to lay out its
  // shape — it never touches segments/hazards/etc. directly.
  const LAYOUTS = {
    circuit: {
      name: 'Circuit Loop',
      desc: 'Balanced mix of sweepers, a hairpin, and an S-chicane.',
      build(t) {
        t.addStraight(t.LEN.LONG);
        t.addCurve(t.LEN.MEDIUM, t.CURVE.EASY);
        t.addCurve(t.LEN.MEDIUM, t.CURVE.MEDIUM);
        t.addStraight(t.LEN.SHORT);
        t.addCurve(t.LEN.LONG, t.CURVE.HARD);        // sweeping right
        t.addStraight(t.LEN.SHORT);
        t.addSCurves();
        t.addStraight(t.LEN.MEDIUM);
        t.addCurve(t.LEN.SHORT, t.CURVE.EXTREME);    // hairpin
        t.addCurve(t.LEN.SHORT, t.CURVE.EXTREME);
        t.addStraight(t.LEN.LONG);                   // back straight
        t.addCurve(t.LEN.MEDIUM, -t.CURVE.MEDIUM);
        t.addCurve(t.LEN.MEDIUM, -t.CURVE.EASY);
        t.addStraight(t.LEN.SHORT);
        t.addCurve(t.LEN.LONG, -t.CURVE.HARD);       // sweeping left, back to start
        t.addStraight(t.LEN.MEDIUM);
      },
    },
    speedway: {
      name: 'Speedway Oval',
      desc: 'Two long straights, two sweeping turns. Built for top speed.',
      build(t) {
        t.addStraight(t.LEN.LONG);
        t.addStraight(t.LEN.LONG);
        t.addCurve(150, t.CURVE.MEDIUM);             // long sweeping half-loop
        t.addStraight(t.LEN.LONG);
        t.addStraight(t.LEN.LONG);
        t.addCurve(150, t.CURVE.MEDIUM);
      },
    },
    twister: {
      name: 'Twister',
      desc: 'Tight hairpins and chicanes back to back. Technical and slow.',
      build(t) {
        t.addStraight(t.LEN.SHORT);
        t.addCurve(t.LEN.SHORT, t.CURVE.HARD);
        t.addCurve(t.LEN.SHORT, -t.CURVE.HARD);
        t.addSCurves();
        t.addStraight(t.LEN.SHORT);
        t.addCurve(t.LEN.SHORT, t.CURVE.EXTREME);    // hairpin
        t.addCurve(t.LEN.SHORT, t.CURVE.EXTREME);
        t.addStraight(t.LEN.SHORT);
        t.addSCurves();
        t.addCurve(t.LEN.SHORT, -t.CURVE.EXTREME);   // hairpin
        t.addCurve(t.LEN.SHORT, -t.CURVE.EXTREME);
        t.addStraight(t.LEN.MEDIUM);
        t.addCurve(t.LEN.MEDIUM, -t.CURVE.HARD);
        t.addStraight(t.LEN.SHORT);
      },
    },
    coast: {
      name: 'Serpentine Coast',
      desc: 'Long, wide sweepers that flow into each other. Fast and rhythmic.',
      build(t) {
        t.addStraight(t.LEN.MEDIUM);
        t.addCurve(t.LEN.LONG, t.CURVE.EASY);
        t.addCurve(t.LEN.LONG, -t.CURVE.EASY);
        t.addCurve(t.LEN.LONG, t.CURVE.EASY);
        t.addStraight(t.LEN.MEDIUM);
        t.addCurve(t.LEN.LONG, -t.CURVE.MEDIUM);
        t.addCurve(t.LEN.LONG, t.CURVE.MEDIUM);
        t.addStraight(t.LEN.SHORT);
        t.addCurve(t.LEN.MEDIUM, t.CURVE.EASY);
        t.addCurve(t.LEN.MEDIUM, -t.CURVE.EASY);
        t.addStraight(t.LEN.LONG);
      },
    },
    switchback: {
      name: 'Switchback Summit',
      desc: 'Relentless hairpins climbing a mountain pass. The most technical layout.',
      build(t) {
        t.addStraight(t.LEN.SHORT);
        t.addCurve(t.LEN.SHORT, t.CURVE.EXTREME);    // hairpin
        t.addCurve(t.LEN.SHORT, -t.CURVE.EXTREME);   // hairpin
        t.addCurve(t.LEN.SHORT, t.CURVE.EXTREME);    // hairpin
        t.addCurve(t.LEN.SHORT, -t.CURVE.EXTREME);   // hairpin
        t.addStraight(t.LEN.SHORT);
        t.addCurve(t.LEN.SHORT, t.CURVE.HARD);
        t.addCurve(t.LEN.SHORT, -t.CURVE.HARD);
        t.addSCurves();
        t.addCurve(t.LEN.SHORT, t.CURVE.EXTREME);    // hairpin
        t.addCurve(t.LEN.SHORT, -t.CURVE.EXTREME);   // hairpin
        t.addStraight(t.LEN.MEDIUM);
      },
    },
    // Unlike the hand-authored layouts above, this one's build() rolls a
    // fresh sequence of pieces with Math.random() on every call — so every
    // buildTrack('random') (each race, each thumbnail redraw) produces a
    // different track, not one fixed extra layout.
    random: {
      name: 'Random Circuit',
      desc: 'A freshly generated layout — different every time you race it.',
      build(t) {
        const lens = [t.LEN.SHORT, t.LEN.MEDIUM, t.LEN.LONG];
        const curves = [t.CURVE.EASY, t.CURVE.MEDIUM, t.CURVE.HARD, t.CURVE.EXTREME];
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

        t.addStraight(t.LEN.MEDIUM); // flat run-up to the start/finish line
        const pieceCount = 8 + Math.floor(Math.random() * 6);
        let straightStreak = 0;
        for (let i = 0; i < pieceCount; i++) {
          const forceCurve = straightStreak >= 2;
          if (!forceCurve && Math.random() < 0.35) {
            t.addStraight(pick(lens));
            straightStreak++;
          } else {
            const sign = Math.random() < 0.5 ? 1 : -1;
            t.addCurve(pick(lens), pick(curves) * sign);
            straightStreak = 0;
          }
        }
        t.addStraight(t.LEN.MEDIUM); // settle back onto flat road before the line
      },
    },
  };

  function buildFromLayout(layout) {
    const segments = [];

    function addSegment(curve) {
      const n = segments.length;
      segments.push({
        index: n,
        curve,
        color: Math.floor(n / RUMBLE_LENGTH) % 2 ? 'dark' : 'light',
        sprites: [],
      });
    }

    function addRoad(enter, hold, leave, curve) {
      for (let i = 0; i < enter; i++) addSegment(easeIn(0, curve, i / enter));
      for (let i = 0; i < hold; i++) addSegment(curve);
      for (let i = 0; i < leave; i++) addSegment(easeInOut(curve, 0, i / leave));
    }

    const toolkit = { CURVE, LEN };
    toolkit.addStraight = (n = LEN.MEDIUM) => addRoad(n, n, n, CURVE.NONE);
    toolkit.addCurve = (n = LEN.MEDIUM, curve = CURVE.MEDIUM) => addRoad(n, n, n, curve);
    toolkit.addSCurves = () => {
      addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, -CURVE.EASY);
      addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, CURVE.MEDIUM);
      addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, CURVE.EASY);
      addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, -CURVE.EASY);
      addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, -CURVE.MEDIUM);
    };
    toolkit.addRoad = addRoad;

    layout.build(toolkit);

    // Checkered start/finish line — segment 0 sits on that layout's opening
    // straight, so a few segments there stay flat and unobstructed for it.
    for (let i = 0; i < 3 && i < segments.length; i++) segments[i].finishLine = true;

    const trackLength = segments.length * SEGMENT_LENGTH;

    // Build a closed-loop schematic polyline for the minimap by integrating
    // heading, normalized so the accumulated turning always closes a full
    // circle regardless of the authored curve magnitudes above.
    let rawHeading = 0;
    for (const seg of segments) rawHeading += seg.curve;
    const normalizer = rawHeading !== 0 ? (2 * Math.PI) / Math.abs(rawHeading) * Math.sign(rawHeading) : 0;
    let heading = -Math.PI / 2;
    let px = 0, py = 0;
    const polyline = [{ x: 0, y: 0 }];
    const step = 4; // sample every 4 segments for a light polyline
    for (let i = 0; i < segments.length; i++) {
      heading += segments[i].curve * normalizer * 0.02;
      px += Math.cos(heading);
      py += Math.sin(heading);
      if (i % step === 0) polyline.push({ x: px, y: py });
    }
    // The heading normalizer above only guarantees the total turning sums to
    // a full 2*PI revolution — for asymmetric layouts (uneven mixes of
    // straights/curves) the accumulated (x, y) position doesn't actually
    // land back on the origin. Since the start/finish marker and every car's
    // minimap dot are placed using this same polyline, an unclosed loop
    // means "where the final lap ends" visibly lands somewhere else on the
    // map than the start position. Shear-correct every point by its
    // fractional progress along the lap so the last point exactly coincides
    // with the first, regardless of how lopsided the raw shape is.
    const last = polyline[polyline.length - 1];
    const n = polyline.length - 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      polyline[i].x -= t * last.x;
      polyline[i].y -= t * last.y;
    }
    // Normalize polyline into a 0..1 box for easy minimap scaling.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of polyline) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const spanX = Math.max(1e-6, maxX - minX), spanY = Math.max(1e-6, maxY - minY);
    for (const p of polyline) {
      p.u = (p.x - minX) / spanX;
      p.v = (p.y - minY) / spanY;
    }

    // Place item-box pickups at a handful of fixed spots. Alternate between
    // a single box (offset to one side, so both racing lines get a shot at
    // one) and a full-width row of 4 across the road, for some variety.
    const ITEM_ROW_LANES = [-0.75, -0.25, 0.25, 0.75];
    const itemBoxSegments = [];
    let clusterIndex = 0;
    const clusterSpacing = Math.max(1, Math.floor(segments.length / 6));
    for (let i = 40 % segments.length; i < segments.length; i += clusterSpacing) {
      if (clusterIndex % 2 === 0) {
        for (const x of ITEM_ROW_LANES) itemBoxSegments.push({ segmentIndex: i, x });
      } else {
        itemBoxSegments.push({ segmentIndex: i, x: clusterIndex % 4 ? 0.45 : -0.45 });
      }
      clusterIndex++;
    }

    // Fixed-location road hazards, spaced away from the item-box clusters
    // above. `at(fraction, x)` picks a segment by its position around the
    // lap (0..1) so placement doesn't depend on the exact segment count.
    const at = (fraction, x) => ({ segmentIndex: Math.floor(segments.length * fraction) % segments.length, x });
    const boostPads = [at(0.08, 0), at(0.62, 0)];
    const greasePatches = [at(0.28, -0.3), at(0.85, 0.3)];
    const holes = [at(0.45, 0.5), at(0.72, -0.5)];

    // Cut a corner deep off-road (past the shoulder, same side as `x`'s
    // sign) and get flung `skip` world units further down the track — a
    // net time save, but only if the off-road speed penalty over that
    // stretch doesn't eat it alive. Placed away from every hazard/pad
    // fraction above so nothing stacks visually on the same stretch.
    const shortcuts = [at(0.2, 1.35), at(0.65, -1.35)].map((s, i) => ({ ...s, skip: 500 + i * 150 }));

    // Launch airborne briefly on contact — while airborne the car sails
    // over grease/holes/off-road penalties (see updateCarPhysics) and gets
    // a small landing boost, so timing a jump over a hazard is a real
    // reward, not just a visual flourish.
    const jumpRamps = [at(0.38, 0), at(0.9, 0)];

    // Roadside dressing — trees mostly, a lamppost every so often, and a
    // guardrail hugging tight bends where a real track would need one.
    // Every SCENERY_SPACING segments, both sides get an object; `kind`
    // varies with position so it doesn't look mechanically repetitive.
    const SCENERY_SPACING = 10;
    const scenery = [];
    for (let i = 0; i < segments.length; i += SCENERY_SPACING) {
      const seg = segments[i];
      const sharpCurve = Math.abs(seg.curve) > 5;
      const leftKind = sharpCurve ? 'rail' : (i % 40 < 10 ? 'lamp' : 'tree');
      const rightKind = sharpCurve ? 'rail' : ((i + 20) % 40 < 10 ? 'lamp' : 'tree');
      scenery.push({ segmentIndex: i, x: -1.25, kind: leftKind });
      scenery.push({ segmentIndex: i, x: 1.25, kind: rightKind });
    }

    return {
      segmentLength: SEGMENT_LENGTH,
      roadWidth: ROAD_WIDTH,
      segments,
      length: trackLength,
      polyline,
      itemBoxSegments,
      boostPads,
      greasePatches,
      holes,
      shortcuts,
      jumpRamps,
      scenery,
      startSegment: 0,
    };
  }

  const DEFAULT_ID = 'circuit';

  function buildTrack(id) {
    const layout = LAYOUTS[id] || LAYOUTS[DEFAULT_ID];
    return buildFromLayout(layout);
  }

  const LIST = Object.keys(LAYOUTS).map((id) => ({ id, name: LAYOUTS[id].name, desc: LAYOUTS[id].desc }));

  function segmentIndexAt(track, z) {
    const zWrapped = ((z % track.length) + track.length) % track.length;
    return Math.floor(zWrapped / track.segmentLength) % track.segments.length;
  }

  function segmentAt(track, z) {
    return track.segments[segmentIndexAt(track, z)];
  }

  window.Track = { buildTrack, segmentAt, segmentIndexAt, SEGMENT_LENGTH, ROAD_WIDTH, LIST, DEFAULT_ID };
})();
