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

  // tryUseItem always fires whatever's at car.selectedIndex, and AI never
  // cycles that by hand — so it has to *decide* which held item to point
  // selectedIndex at, not just work through them in pickup order. For each
  // item this figures out (a) whether it's eligible to use at all right now
  // (a forward-aimed item needs a real target, a missile is wasted already
  // in 1st, repair is wasted at full health) and (b) how valuable using it
  // would actually be in the current situation — then fires the single most
  // valuable eligible item, not just the first one that happens to roll
  // lucky. This also incidentally fixes the older bug where a single stuck
  // front item (no target for a bomb/swap/slow, say) permanently blocked
  // everything queued behind it: every held item gets considered every
  // frame regardless of its position in the array.
  function wantsToUseItem(car, allCars, track, difficulty) {
    if (!car.items.length) return false;
    const mult = difficulty ? difficulty.itemChanceMultiplier : 1;
    const chance = (p) => Math.min(1, p * mult);
    const targetAhead = hasTargetAhead(car, allCars, track);
    const targetBeside = hasTargetBeside(car, allCars);
    // Someone closing in from behind — the same situation the player's own
    // "incoming" HUD warning exists for (see index.html) — is when a
    // defensive item (shield/guard) or a dropped banana is actually worth
    // using now rather than saving for later.
    const chased = hasThreatBehind(car, allCars, track);

    let bestIndex = -1, bestValue = -1, bestChance = 0;
    for (let i = 0; i < car.items.length; i++) {
      const kind = car.items[i];
      let eligible = false, value = 0, useChance = 0;
      if (kind === 'missile') {
        // Locks onto 1st place wherever they are on track — wasted if the
        // AI using it already *is* 1st, so hold onto it until that's not
        // true. Always the single best play when it's live: guaranteed hit
        // on the race leader from anywhere.
        eligible = car.position > 1;
        value = 5; useChance = 0.35;
      } else if (kind === 'side') {
        eligible = targetBeside;
        value = 4; useChance = 0.6;
      } else if (kind === 'bomb' || kind === 'swap' || kind === 'slow') {
        eligible = targetAhead;
        value = 3; useChance = 0.5;
      } else if (kind === 'shield' || kind === 'guard') {
        // Worth holding onto until something's actually worth blocking —
        // otherwise it just burns the timer doing nothing. Small background
        // chance so it doesn't sit unused forever on a clean run.
        eligible = true;
        value = chased ? 4 : 1;
        useChance = chased ? 0.5 : 0.03;
      } else if (kind === 'repair') {
        // Wasted at full health; more urgent the more damage stacked up.
        eligible = car.damage > 0;
        value = 2 + car.damage;
        useChance = 0.15 + car.damage * 0.1;
      } else if (kind === 'banana') {
        // Dropped behind, not aimed — no target needed, but it's a much
        // better play specifically when something's on your tail.
        eligible = true;
        value = chased ? 3 : 1;
        useChance = chased ? 0.4 : 0.03;
      } else { // boost
        eligible = true;
        value = 1; useChance = 0.04;
      }
      if (eligible && value > bestValue) { bestValue = value; bestIndex = i; bestChance = useChance; }
    }
    if (bestIndex < 0) return false;
    if (Math.random() < chance(bestChance)) { car.selectedIndex = bestIndex; return true; }
    return false;
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

  function hasThreatBehind(car, allCars, track) {
    for (const other of allCars) {
      if (other === car || other.finished) continue;
      const gap = (((car.totalDistance - other.totalDistance) % track.length) + track.length) % track.length;
      if (gap > 0 && gap < 2200 && Math.abs(other.x - car.x) < 0.6) return true;
    }
    return false;
  }

  // Nudges an AI's effective top speed toward the nearest human's pace so
  // the pack stays competitive without being unbeatable or trivial.
  // difficulty.aiSpeedMultiplier sets the bot's real baseline before that
  // adjustment. rubberbandEase/rubberbandCatchup then cap how far the
  // adjustment can pull it off that baseline in each direction separately —
  // ease when the bot is ahead of the human (positive gap), catchup when
  // it's behind (negative gap). Kept as two caps rather than one shared
  // band: forcing a single band to 0 for "never eases off" also disabled
  // catchup, so a bot that fell behind once — bad corner, hazard, anything —
  // could never close the gap again and the race was effectively decided by
  // whichever mistake happened first. Insane wants exactly the asymmetric
  // version: ease at 0 (a lead is never handed back) but catchup still high
  // (falling behind gets punished immediately).
  function applyRubberband(car, humanCars, baseMaxSpeed, difficulty) {
    const base = baseMaxSpeed * (difficulty ? difficulty.aiSpeedMultiplier : 1);
    if (!humanCars.length) { car.maxSpeed = base; return; }
    let nearestGap = Infinity;
    for (const h of humanCars) {
      const gap = car.totalDistance - h.totalDistance;
      if (Math.abs(gap) < Math.abs(nearestGap)) nearestGap = gap;
    }
    const easeCap = difficulty ? difficulty.rubberbandEase : 0.12;
    const catchupCap = difficulty ? difficulty.rubberbandCatchup : 0.12;
    const band = nearestGap >= 0
      ? clamp(nearestGap / 4000, 0, easeCap)
      : -clamp(-nearestGap / 4000, 0, catchupCap);
    car.maxSpeed = base * (1 - band);
  }

  window.AI = { computeAIInput, applyRubberband };
})();
