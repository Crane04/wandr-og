// AI steering/throttle, light avoidance, rubberbanding vs. the trailing
// human, and opportunistic item use.
(function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // `conditions` (optional) is the selected race condition (see index.html's
  // CONDITIONS) — bots read upcoming curves straight out of track data, not
  // pixels, so without this they'd corner perfectly through fog a human
  // can't see two car-lengths into. Scaling lookahead by the same
  // visibleDistance that shortens the human's actual draw distance keeps
  // both grounded in the same "how far can anyone tell what's coming" number
  // instead of needing separate, easily-mismatched tuning.
  function computeAIInput(car, track, allCars, conditions, difficulty) {
    const segIndex = Track.segmentIndexAt(track, car.totalDistance);
    const visibleDistance = (conditions && conditions.visibleDistance) ?? 1;
    const lookahead = Math.max(1, Math.round(7 * visibleDistance));
    let curveSum = 0;
    for (let i = 1; i <= lookahead; i++) {
      const seg = track.segments[(segIndex + i) % track.segments.length];
      curveSum += seg.curve * (1 - (i - 1) / lookahead);
    }
    let targetX = clamp(-curveSum * 0.035, -0.55, 0.55);

    // A slow, per-car wander so bots don't all glue themselves to the exact
    // same racing line — otherwise every AI looks robotically identical.
    // Difficulty scales the amplitude: a lower-difficulty bot wanders more
    // (a looser, more beatable line), a higher one holds tighter to the
    // racing line computed above.
    const wander = difficulty ? difficulty.wander : 0.18;
    targetX += Math.sin(performance.now() * 0.0006 + car.id * 1.7) * wander;

    for (const other of allCars) {
      if (other === car || other.finished) continue;
      const gap = (((other.totalDistance - car.totalDistance) % track.length) + track.length) % track.length;
      if (gap > 0 && gap < 260 && Math.abs(other.x - car.x) < 0.3) {
        targetX += (car.x >= other.x ? 1 : -1) * 0.4;
      }
    }
    targetX = clamp(targetX, -0.85, 0.85);

    // Softening the steering gain a little under low visibility, on top of
    // the shorter lookahead above — measured effect on off-road frequency
    // is small even at aggressive settings (the correction is sharp enough
    // to catch most late-seen curves regardless), so this is flavor on top
    // of the real fix below, not the thing doing the work.
    const steerConfidence = 0.7 + 0.3 * Math.min(1, visibleDistance / 0.3);
    const steer = clamp((targetX - car.x) * 3.2 * steerConfidence, -1, 1);

    // The actual reliable "fog slows bots down" effect: a cautious driver
    // who can't see far doesn't corner perfectly slower, they just don't
    // push to the same top speed. Unlike the steering tweaks above this is
    // deterministic and trivially verifiable (average AI speed measurably
    // drops), not dependent on the AI happening to misjudge a specific
    // curve.
    const visibilityCaution = 0.55 + 0.45 * Math.min(1, visibleDistance / 0.3);
    car.maxSpeed *= visibilityCaution;
    // Raised from 14: braking less readily on merely-tight bends lets bots
    // carry speed (and drift, same as a human would) through more corners
    // instead of stabbing the brake on almost every turn. Difficulty pushes
    // this further in either direction — a higher difficulty bot commits to
    // more corners at speed instead of lifting off.
    const brakeThreshold = difficulty ? difficulty.brakeThreshold : 20;
    const sharpTurnAhead = Math.abs(curveSum) > brakeThreshold;
    const boostChance = difficulty ? difficulty.boostChance : 0.03;

    return {
      steer,
      throttle: true,
      brake: sharpTurnAhead && car.speed > car.maxSpeed * 0.7,
      wantBoost: car.boostCharge >= 55 && Math.random() < boostChance,
      wantItem: wantsToUseItem(car, allCars, track, difficulty),
    };
  }

  // tryUseItem always fires whatever's at car.selectedIndex (AI never
  // cycles, so that's effectively "the item it's currently holding") — firing
  // it blind wastes forward-aimed items (bomb/swap/slow) at empty road when
  // nobody's actually ahead. Only fire those when there's a real target;
  // side-hit needs someone actually alongside; boost/shield don't need a
  // target at all.
  function wantsToUseItem(car, allCars, track, difficulty) {
    if (!car.items.length) return false;
    const kind = car.items[Math.min(car.selectedIndex, car.items.length - 1)];
    const mult = difficulty ? difficulty.itemChanceMultiplier : 1;
    const chance = (p) => Math.min(1, p * mult);
    if (kind === 'boost' || kind === 'shield' || kind === 'star') return Math.random() < chance(0.04);
    // Dropped behind, not aimed — no target needed, just don't spam it.
    if (kind === 'banana') return Math.random() < chance(0.03);
    // Locks onto 1st place wherever they are on track — wasted if the AI
    // using it already *is* 1st, so hold onto it until that's not true.
    if (kind === 'missile') return car.position > 1 && Math.random() < chance(0.05);
    if (kind === 'side') return hasTargetBeside(car, allCars) && Math.random() < chance(0.5);
    return hasTargetAhead(car, allCars, track) && Math.random() < chance(0.5); // bomb / swap / slow
  }

  function hasTargetAhead(car, allCars, track) {
    for (const other of allCars) {
      if (other === car || other.finished) continue;
      const gap = (((other.totalDistance - car.totalDistance) % track.length) + track.length) % track.length;
      if (gap > 0 && gap < 3000 && Math.abs(other.x - car.x) < 0.5) return true;
    }
    return false;
  }

  function hasTargetBeside(car, allCars) {
    for (const other of allCars) {
      if (other === car || other.finished) continue;
      const dz = Math.abs(other.totalDistance - car.totalDistance);
      const dx = Math.abs(other.x - car.x);
      if (dz < 150 && dx > 0.15 && dx < 0.9) return true;
    }
    return false;
  }

  // Nudges an AI's effective top speed toward the nearest human's pace so
  // the pack stays competitive without being unbeatable or trivial.
  // difficulty.aiSpeedMultiplier sets the bot's real baseline before that
  // adjustment; difficulty.rubberbandBand caps how far the adjustment can
  // still pull it off that baseline — a wide band (low difficulty) keeps a
  // struggling bot glued near the player even if its baseline is slow, a
  // narrow one (high difficulty) lets a fast baseline actually pull away.
  function applyRubberband(car, humanCars, baseMaxSpeed, difficulty) {
    const base = baseMaxSpeed * (difficulty ? difficulty.aiSpeedMultiplier : 1);
    if (!humanCars.length) { car.maxSpeed = base; return; }
    let nearestGap = Infinity;
    for (const h of humanCars) {
      const gap = car.totalDistance - h.totalDistance;
      if (Math.abs(gap) < Math.abs(nearestGap)) nearestGap = gap;
    }
    const bandCap = difficulty ? difficulty.rubberbandBand : 0.12;
    const band = clamp(nearestGap / 4000, -bandCap, bandCap);
    car.maxSpeed = base * (1 - band);
  }

  window.AI = { computeAIInput, applyRubberband };
})();
