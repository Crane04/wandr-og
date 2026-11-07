import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Fighter, WALK_AXIS } from './fighter.js';
import { Combat } from './combat.js';
import { AIBrain, DIFFICULTY } from './ai.js';
import { buildStage } from './stage.js';
import { FX, glowTexture } from './fx.js';
import { Blood } from './blood.js';
import * as sfx from './audio.js';
import { dress, preload } from './skin.js';
import { ROSTER } from './roster.js';

const $ = (s) => document.querySelector(s);
const errBox = $('#err');
window.addEventListener('error', (e) => { errBox.textContent = 'Error: ' + e.message; });

// ---------------------------------------------------------------- renderer
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
camera.position.set(0, 1.6, 7);

const stage = buildStage(scene, renderer);
const fx = new FX(scene, camera);
const blood = new Blood(scene);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.65, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- fighters
// Plays exactly as Kain until he gets a special of his own.
ROSTER.push({ ...ROSTER.find((c) => c.name === 'KAIN'), name: 'JAMES', title: 'THE STREET FIGHTER', skinModel: 'james', quote: 'Same time tomorrow? Bring friends.' });
const pick = [0, 2];
const COLORS = [ROSTER[0].fx, ROSTER[2].fx];
const fighters = [new Fighter(ROSTER[pick[0]], 0, null), new Fighter(ROSTER[pick[1]], 1, null)];
fighters.forEach((f) => scene.add(f.m.root));

// projectiles (frost shards)
const fireLights = [0, 1].map(() => { const l = new THREE.PointLight(0xffffff, 0, 6, 2); scene.add(l); return { l, used: false }; });
const fireMeshes = new Map();

// per-fighter ability visuals: an ice shell while frozen, a glow while armored
const iceShells = fighters.map(() => {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x9fe4ff, emissive: 0x2a6a88, roughness: 0.15, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.42, depthWrite: false }),
  );
  m.scale.set(0.62, 1.15, 0.52);
  m.visible = false;
  scene.add(m);
  return m;
});
const armorGlows = fighters.map(() => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
  s.visible = false;
  scene.add(s);
  return s;
});

const hudEl = $('#hud');
const bannerEl = $('#banner');
const subEl = $('#sub');
const flashEl = $('#flash');

let hitstop = 0;
let shake = 0;
let timeScale = 1;
const comboState = [{ n: 0, t: 0 }, { n: 0, t: 0 }];
const wasReady = [false, false];

const sendPhone = (idx, payload) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'to-player', player: idx + 1, payload }));
};

const combat = new Combat(fighters, {
  onHit(e) {
    const a = e.attacker, d = e.defender;
    const col = COLORS[a.idx];
    if (e.type === 'block') {
      sfx.block();
      fx.burst(e.pt, 0xffffff, 8, 3.2);
      fx.ring(e.pt, 0xbfd8ff, 0.5);
      hitstop = Math.max(hitstop, 0.04);
      shake = Math.max(shake, 0.04);
      sendPhone(d.idx, { type: 'rumble', ms: 30 });
      return;
    }
    const power = Math.min(1, e.dmg / 16);
    sfx.hit(power);
    if (e.armored) fx.ring(e.pt, COLORS[d.idx], 1.2);
    blood.spray(e.pt, e.dir, d.cfg.blood, 6 + Math.round(power * 22), 2.5 + power * 3);
    fx.burst(e.pt, 0xffd9a0, 10 + Math.round(power * 18), 5 + power * 5);
    fx.burst(e.pt, col, 6, 4);
    fx.ring(e.pt, col, 0.8 + power * 0.8);
    fx.flash(e.pt, 0xffd9a0, 30 + power * 50);
    hitstop = Math.max(hitstop, e.atk.hitstop ?? (0.05 + power * 0.05));
    shake = Math.max(shake, e.atk.shake ?? (0.08 + power * 0.14));
    sendPhone(d.idx, { type: 'rumble', ms: 60 + Math.round(power * 140) });
    sendPhone(a.idx, { type: 'rumble', ms: 25 });
    const cs = comboState[a.idx];
    cs.n = d.comboHits; cs.t = 1.4;
    if (e.ko) { hitstop = 0.28; shake = 0.5; }
  },
  onLand(f, speed, strong) {
    fx.dust(f.x, strong ? 12 : 4, strong ? 0.7 : 0.3);
    if (strong) {
      blood.spray({ x: f.x, y: 0.2 }, f.facingRight ? -1 : 1, f.cfg.blood, 8, 2);
      blood.stain(f.x, 0, 0.55, f.cfg.blood);
      if (f.state === 'ko') blood.stain(f.x, 0, 2.1, f.cfg.blood, 3);
    }
    sfx.land(strong);
    if (strong) shake = Math.max(shake, 0.12);
  },
  onSwing(f, a) {
    if (a.cost) sfx.special();
    else sfx.whoosh(Math.min(1, a.dmg / 14));
  },
  onSpecial(f, a, stage) {
    const pt = { x: f.x, y: f.y + 1.1, z: 0 };
    const col = COLORS[f.idx];
    if (stage === 'buff') {
      fx.explosion(pt, col);
      sfx.boom();
      shake = Math.max(shake, 0.3);
    } else {
      fx.burst(pt, col, 20, 3.5);
      fx.ring(pt, col, 1.1);
      if (stage === 'appear') fx.dust(f.x, 8, 0.5);
    }
  },
  onProjectileSpawn(p) {
    const col = COLORS[p.owner.idx];
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3), toneMapped: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    halo.scale.set(1.5, 1.5, 1);
    g.add(core, halo);
    scene.add(g);
    const lt = fireLights.find((l) => !l.used);
    if (lt) { lt.used = true; lt.l.color.set(col); lt.l.intensity = 18; }
    fireMeshes.set(p.id, { g, lt });
  },
  onProjectileDie(p, hit) {
    const m = fireMeshes.get(p.id);
    if (m) {
      scene.remove(m.g);
      if (m.lt) { m.lt.used = false; m.lt.l.intensity = 0; }
      fireMeshes.delete(p.id);
    }
    if (hit) {
      fx.explosion({ x: p.x, y: p.y, z: 0 }, COLORS[p.owner.idx]);
      sfx.boom();
      shake = Math.max(shake, 0.25);
      hitstop = Math.max(hitstop, 0.08);
    }
  },
});
fighters.forEach((f) => f.setMode('idle'));

// ---------------------------------------------------------------- character select
let detailsFor = null;
function showDetails(i) {
  const c = ROSTER[pick[i]];
  detailsFor = i;
  $('#dName').textContent = c.name;
  $('#dTitle').textContent = c.title;
  $('#dAbility').textContent = c.ability.name;
  $('#dDesc').textContent = c.ability.desc;
  const card = $('#details');
  card.style.setProperty('--c', '#' + c.fx.toString(16).padStart(6, '0'));
  card.classList.add('on');
}
function hideDetails() {
  detailsFor = null;
  $('#details').classList.remove('on');
}
document.querySelectorAll('.more').forEach((el) => { el.onclick = () => showDetails(+el.dataset.p); });
$('#dClose').onclick = hideDetails;
$('#details').onclick = (e) => { if (e.target === e.currentTarget) hideDetails(); };
// puts a fighter on stage and in the HUD; the lobby pick is separate, as arcade swaps foes
function showFighter(i, c) {
  fighters[i].rebuild(c);
  dress(fighters[i]);
  fighters[i].setMode('idle');
  COLORS[i] = c.fx;
  document.querySelector('.name.p' + (i + 1)).textContent = c.name;
  document.querySelector('.meter.p' + (i + 1) + ' b').textContent = c.ability.name + ' READY';
}
function applyPick(i) {
  const c = ROSTER[pick[i]];
  showFighter(i, c);
  const s = document.querySelector('#slot' + (i + 1));
  s.querySelector('.who').textContent = c.name;
  const hex = '#' + c.fx.toString(16).padStart(6, '0');
  s.style.setProperty('--c', hex);
  if (detailsFor === i) showDetails(i); // a phone can flick to another fighter while this is open
}
function cycle(i, dir) {
  pick[i] = (pick[i] + dir + ROSTER.length) % ROSTER.length;
  applyPick(i);
  sfx.tick();
}
document.querySelectorAll('.arr').forEach((el) => {
  el.onclick = () => cycle(+el.dataset.p, +el.dataset.d);
});
applyPick(0); applyPick(1);
preload(ROSTER);

// ---------------------------------------------------------------- match flow
let phase = 'lobby'; // lobby, intro, fight, ko, over
let paused = false;
function setPaused(v) {
  paused = v;
  $('#pause').classList.toggle('on', v);
}
let mode = 'cpu';    // cpu | vs | arcade | survival | training
const cpuControlled = () => mode !== 'vs'; // player 2 is the CPU, or the training dummy
let round = 1;
let wins = [0, 0];
let roundTime = 60;
let phaseT = 0;
let koInfo = null;
const LEVELS = Object.keys(DIFFICULTY);
let difficulty = 'medium';
try { const d = localStorage.getItem('fightDifficulty'); if (LEVELS.includes(d)) difficulty = d; } catch {}
const brain = new AIBrain(DIFFICULTY[difficulty]);
function setDifficulty(d) {
  difficulty = d;
  brain.level = DIFFICULTY[d];
  $('#btnDiff').textContent = `CPU: ${d.toUpperCase()}`;
  try { localStorage.setItem('fightDifficulty', d); } catch {}
}
const nextDifficulty = () => setDifficulty(LEVELS[(LEVELS.indexOf(difficulty) + 1) % LEVELS.length]);
setDifficulty(difficulty);
$('#btnDiff').onclick = nextDifficulty;

let bannerTimer = 0;
function banner(text, hold = false, ms = 1400) {
  bannerEl.textContent = text;
  bannerEl.classList.remove('show', 'hold');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');
  if (hold) bannerEl.classList.add('hold');
  clearTimeout(bannerTimer);
  if (!hold) bannerTimer = setTimeout(() => { bannerEl.classList.remove('show'); bannerEl.style.opacity = 0; }, ms);
  bannerEl.style.opacity = '';
}
function sub(text) {
  subEl.textContent = text || '';
  subEl.classList.toggle('on', !!text);
}
function flash(a = 0.7) {
  flashEl.style.transition = 'none';
  flashEl.style.opacity = a;
  void flashEl.offsetWidth;
  flashEl.style.transition = 'opacity .5s';
  flashEl.style.opacity = 0;
}

function setPips() {
  document.querySelectorAll('.pips').forEach((el, i) => {
    el.querySelectorAll('.pip').forEach((p, k) => p.classList.toggle('won', k < wins[i]));
  });
}

function startMatch(m) {
  mode = m;
  hudEl.dataset.mode = m;
  hideResult();
  modeTag();
  wins = [0, 0];
  round = 1;
  hideDetails();
  $('#lobby').classList.add('off');
  hudEl.classList.add('on');
  blood.clear();
  fighters.forEach((f) => { f.meter = 0; });
  setPips();
  startRound();
}

function startRound() {
  combat.clearProjectiles();
  fighters.forEach((f, i) => {
    f.reset(i === 0 ? -1.4 : 1.4, true);
    f.state = 'intro';
  });
  brain.clear(fighters[1]);
  if (mode === 'survival') fighters[0].hp = run.hp; // one health bar for the whole run
  roundTime = mode === 'training' ? Infinity : 60;
  phase = 'intro';
  phaseT = 0;
  timeScale = 1;
  koInfo = null;
  sub('');
  let text = wins[0] === 1 && wins[1] === 1 ? 'FINAL ROUND' : 'ROUND ' + round;
  if (mode === 'arcade' && round === 1) text = `STAGE ${run.stage + 1}`;
  if (mode === 'survival') text = `OPPONENT ${run.beaten + 1}`;
  if (mode === 'training') text = 'TRAINING';
  banner(text, false, 1500);
  sfx.gong();
}

function beginFight() {
  fighters.forEach((f) => f.setMode('idle'));
  phase = 'fight';
  phaseT = 0;
  banner('FIGHT!', false, 800);
  sfx.boom();
}

function endRound(winner, how) {
  // winner: fighter or null (draw)
  if (winner) {
    wins[winner.idx]++;
    setPips();
    if (how !== 'ko') {
      winner.setMode('win');
      fighters[1 - winner.idx].setMode('lose');
    } else {
      winner.setMode('win');
    }
  }
  if (mode === 'survival') run.hp = fighters[0].hp;
  const matchWon = winner && wins[winner.idx] >= (mode === 'survival' ? 1 : 2);
  phase = 'over';
  phaseT = 0;
  koInfo = { winner, matchWon, how };
  if (how === 'time') banner('TIME UP', false, 1300);
  else banner('K.O.', true);
  if (how === 'ko') { sfx.ko(); flash(0.8); }
}

function afterRoundText() {
  const { winner, matchWon } = koInfo;
  if (matchWon) { banner(winner.name + ' WINS', true); sub('PRESS ENTER OR ANY BUTTON FOR A REMATCH'); }
  else if (!winner) { banner('DRAW', false, 1200); }
  else { banner(winner.name + ' TAKES THE ROUND', false, 1600); }
}

function toLobby() {
  setPaused(false);
  phase = 'lobby';
  run = null;
  hideResult();
  brain.level = DIFFICULTY[difficulty];
  if (fighters[1].cfg !== ROSTER[pick[1]]) applyPick(1); // arcade and survival swap the foe
  showSurvivalBest();
  combat.clearProjectiles();
  blood.clear();
  fighters.forEach((f, i) => { f.reset(i === 0 ? -1.4 : 1.4, false); f.setMode('idle'); });
  brain.clear(fighters[1]);
  hudEl.classList.remove('on');
  bannerEl.classList.remove('show', 'hold');
  bannerEl.style.opacity = 0;
  sub('');
  timeScale = 1;
  $('#lobby').classList.remove('off');
}

function stepMatch(dt) {
  phaseT += dt;
  if (phase === 'intro') {
    if (phaseT > 1.9) beginFight();
  } else if (phase === 'fight') {
    roundTime -= dt;
    if (mode === 'training') {
      dummyThink(dt);
      // nobody goes down in training: health refills before a hit can finish anyone
      for (const f of fighters) if (f.hp < 40) f.hp = f.maxHp;
      fighters[0].meter = 100;
    } else if (cpuControlled()) brain.think(fighters[1], fighters[0], dt);
    const dead = fighters.find((f) => f.state === 'ko');
    if (dead) {
      phase = 'ko';
      phaseT = 0;
      timeScale = 0.25;
      koInfo = { loser: dead };
    } else if (roundTime <= 0) {
      roundTime = 0;
      const [a, b] = fighters;
      if (Math.abs(a.hp - b.hp) < 0.5) endRound(null, 'time');
      else endRound(a.hp > b.hp ? a : b, 'time');
    }
  } else if (phase === 'ko') {
    brain.clear(fighters[1]);
    if (phaseT > 0.3) {
      timeScale = 1;
      endRound(fighters[1 - koInfo.loser.idx], 'ko');
    }
  } else if (phase === 'over') {
    brain.clear(fighters[1]);
    const T = koInfo.matchWon ? 2.2 : 2.0;
    if (run && koInfo.matchWon) { // arcade and survival wait on the result card
      if (phaseT > T && !koInfo.shown) { koInfo.shown = true; showResult(); }
      return;
    }
    if (phaseT > T && !koInfo.shown) { koInfo.shown = true; afterRoundText(); }
    if (koInfo.matchWon) {
      if (phaseT > 12) toLobby();
    } else if (phaseT > 4.2) {
      round++;
      startRound();
    }
  }
}

// ---------------------------------------------------------------- solo modes
// Arcade: 5 different opponents, each a notch harder. Survival: one health bar for as
// many opponents as you can beat. Both start from the chosen CPU difficulty.
const ARCADE_FIGHTS = 5;
const SURVIVAL_HEAL = 20;
let run = null; // arcade or survival progress
const soloLevel = (offset) => Math.min(1, Math.max(0.2, DIFFICULTY[difficulty] + offset));
function pickFoes(n, avoid) {
  const pool = ROSTER.map((_, i) => i).filter((i) => i !== avoid);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n);
}
let survivalBest = 0;
try { survivalBest = +localStorage.getItem('fightSurvivalBest') || 0; } catch {}
function showSurvivalBest() { $('#btnSurvival').textContent = survivalBest ? `SURVIVAL  BEST ${survivalBest}` : 'SURVIVAL'; }
showSurvivalBest();

function startArcade() {
  run = { kind: 'arcade', stage: 0, foes: pickFoes(ARCADE_FIGHTS, pick[0]) };
  arcadeFight();
}
function arcadeFight() {
  showFighter(1, ROSTER[run.foes[run.stage]]);
  brain.level = soloLevel(-0.15 + (0.25 * run.stage) / (ARCADE_FIGHTS - 1)); // a notch under, up to a notch over
  startMatch('arcade');
}
function startSurvival() {
  run = { kind: 'survival', beaten: 0, hp: fighters[0].maxHp, last: -1 };
  survivalFight();
}
function survivalFight() {
  const foe = pickFoes(ROSTER.length - 1, pick[0]).find((i) => i !== run.last);
  run.last = foe;
  showFighter(1, ROSTER[foe]);
  brain.level = soloLevel(-0.15 + 0.04 * run.beaten);
  startMatch('survival');
}

function modeTag() {
  const el = $('#modeTag');
  if (mode === 'arcade' && run) el.textContent = `STAGE ${run.stage + 1} / ${ARCADE_FIGHTS}`;
  else if (mode === 'survival' && run) el.textContent = `${run.beaten} BEATEN`;
  else if (mode === 'training') el.textContent = `DUMMY: ${dummy.toUpperCase()}`;
  else el.textContent = '';
  $('#pause .dummy').textContent = mode === 'training' ? `△ DUMMY: ${dummy.toUpperCase()}` : '';
}

// the card between fights: who won, their line, and what's next
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
function card(title, who, line, next) {
  const el = $('#result');
  el.style.setProperty('--c', hex(who.fx));
  $('#rTitle').textContent = title;
  $('#rName').textContent = who.name;
  $('#rQuote').textContent = `"${who.quote}"`;
  $('#rLine').textContent = line;
  $('#rNext').textContent = next;
  el.classList.add('on');
  bannerEl.classList.remove('show', 'hold');
  bannerEl.style.opacity = 0;
}
function hideResult() { $('#result').classList.remove('on'); }
function showResult() {
  const won = koInfo.winner === fighters[0];
  const me = fighters[0].cfg, foe = fighters[1].cfg;
  if (run.kind === 'arcade') {
    const ladder = run.foes.map((_, i) => (i < run.stage + (won ? 1 : 0) ? '●' : '○')).join(' ');
    if (won && run.stage === ARCADE_FIGHTS - 1) {
      run.next = 'lobby';
      card('ARCADE CLEAR', me, ladder, 'ANY BUTTON: LOBBY');
    } else if (won) {
      run.next = 'continue';
      card(`STAGE ${run.stage + 1} CLEAR`, me, `${ladder}   NEXT: ${ROSTER[run.foes[run.stage + 1]].name}`, 'ANY BUTTON: NEXT FIGHT   ○ LOBBY');
    } else {
      run.next = 'retry';
      card('DEFEATED', foe, `${ladder}   STAGE ${run.stage + 1} OF ${ARCADE_FIGHTS}`, 'ANY BUTTON: TRY AGAIN   ○ LOBBY');
    }
  } else if (won) {
    run.beaten++;
    run.hp = Math.min(fighters[0].maxHp, fighters[0].hp + SURVIVAL_HEAL);
    run.next = 'continue';
    card(`${run.beaten} DOWN`, me, `HEALTH +${SURVIVAL_HEAL}, NOW ${Math.round(run.hp)}`, 'ANY BUTTON: NEXT OPPONENT   ○ LOBBY');
  } else {
    const best = run.beaten > survivalBest;
    if (best) { survivalBest = run.beaten; try { localStorage.setItem('fightSurvivalBest', survivalBest); } catch {} }
    run.next = 'again';
    card('SURVIVAL OVER', foe, `${run.beaten} BEATEN   ${best ? 'NEW BEST' : 'BEST ' + survivalBest}`, 'ANY BUTTON: TRY AGAIN   ○ LOBBY');
  }
}
function resultNext() {
  const next = run.next;
  if (next === 'lobby') return toLobby();
  if (run.kind === 'arcade') {
    if (next === 'continue') run.stage++;
    return arcadeFight();
  }
  return next === 'again' ? startSurvival() : survivalFight();
}

// Training: a dummy that stands, guards or swings, and nobody runs out of health
const DUMMY = ['stand', 'block', 'attack'];
let dummy = 'stand', dummyT = 0, dummySwing = 0;
function setDummy(d) {
  dummy = d;
  modeTag();
}
const nextDummy = () => { setDummy(DUMMY[(DUMMY.indexOf(dummy) + 1) % DUMMY.length]); sfx.tick(); };
$('#modeTag').onclick = () => { if (mode === 'training') nextDummy(); };
function dummyThink(dt) {
  const me = fighters[1], opp = fighters[0], inp = me.inp;
  const dx = opp.x - me.x;
  inp.aiX = 0; inp.aiY = 0; inp.aiBlock = false;
  if (dummy === 'block') {
    inp.aiBlock = true;
    if (opp.state === 'attack' && opp.atk.level === 'low') inp.aiY = 1; // guards low against sweeps
  } else if (dummy === 'attack') {
    dummyT -= dt;
    if (Math.abs(dx) > 1.3) inp.aiX = (Math.sign(dx) || 1) * WALK_AXIS;
    else if (dummyT <= 0 && me.state === 'idle') { dummyT = 1.3; me.press(dummySwing++ % 2 ? 'kick' : 'punch'); }
  }
}

// ---------------------------------------------------------------- input
const keys = new Set();
const lastTap = {}, dashing = {}; // double-tap a direction to run, as keys have no half-push
const KB = [
  { l: 'a', r: 'd', u: 'w', d: 's', punch: 'j', kick: 'k', special: 'l', block: 'i' },
  { l: 'arrowleft', r: 'arrowright', u: 'arrowup', d: 'arrowdown', punch: '.', kick: '/', special: ';', block: "'" },
];
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (detailsFor !== null) { if (k === 'escape' || k === 'enter') { e.preventDefault(); hideDetails(); } return; }
  if (k.startsWith('arrow') || k === '/' || k === "'") e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  dashing[k] = performance.now() - (lastTap[k] ?? -1e4) < 260;
  lastTap[k] = performance.now();
  if (k === 'escape') { toLobby(); return; }
  if (k === 'enter') {
    e.preventDefault(); // Enter is the game's key; it must not also click whichever button has focus
    if (phase === 'lobby') startMatch(phones[1] ? 'vs' : 'cpu');
    else if (phase === 'over' && koInfo?.matchWon) { if (!run) startMatch(mode); else if (koInfo.shown) resultNext(); }
    else if (phase === 'fight') setPaused(!paused);
    return;
  }
  if (k === 't' && mode === 'training' && phase !== 'lobby') { nextDummy(); return; }
  if (phase === 'lobby') {
    if (k === 'a') cycle(0, -1); else if (k === 'd') cycle(0, 1);
    else if (k === 'arrowleft') cycle(1, -1); else if (k === 'arrowright') cycle(1, 1);
    return;
  }
  if (phase !== 'fight' || paused) return;
  KB.forEach((m, i) => {
    if (i === 1 && cpuControlled()) return;
    for (const a of ['punch', 'kick', 'special']) if (k === m[a]) fighters[i].press(a);
  });
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
sfx.init((blocked) => $('#soundOff').classList.toggle('on', blocked));

function pollKeyboard() {
  KB.forEach((m, i) => {
    const f = fighters[i];
    if (i === 1 && cpuControlled()) { f.setAxis('kb', 0, 0); f.setBlock('kb', false); return; }
    const held = (key) => (keys.has(key) ? (dashing[key] ? 1 : WALK_AXIS) : 0);
    const x = held(m.r) - held(m.l);
    const y = (keys.has(m.d) ? 1 : 0) - (keys.has(m.u) ? 1 : 0);
    f.setAxis('kb', x, y);
    f.setBlock('kb', keys.has(m.block));
  });
}

// ---------------------------------------------------------------- network
const phones = [false, false, false]; // 1-indexed
const flick = [false, false, false];
let ws = null;
function slotUI() {
  const s1 = $('#slot1'), s2 = $('#slot2');
  s1.classList.toggle('in', phones[1]);
  s2.classList.toggle('in', phones[2]);
  s1.querySelector('p').textContent = phones[1] ? 'phone connected' : 'waiting for a phone (or use keyboard)';
  s2.querySelector('p').textContent = phones[2] ? 'phone connected' : 'waiting for a phone (or fight the CPU)';
}
const gameParams = new URLSearchParams(location.search);
let gameId = (gameParams.get('id') || localStorage.getItem('fightGameId') || '').toUpperCase();
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'host-create', hostId: gameId }));
  ws.onclose = () => { $('#url').textContent = 'disconnected, retrying...'; setTimeout(connect, 1500); };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'room-created') {
      gameId = m.room;
      localStorage.setItem('fightGameId', gameId);
      gameParams.set('id', gameId);
      history.replaceState(null, '', `${location.pathname}?${gameParams}`);
      $('#code').textContent = m.room;
      // on localhost the phone needs the laptop's LAN address; online it's the site's own
      const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      const host = local ? m.ip + ':' + m.port : location.host;
      const url = `${local ? 'http:' : location.protocol}//${host}/controller.html?room=${m.room}`;
      $('#url').textContent = `${host}/controller.html`;
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData(url); qr.make();
        $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch (err) { $('#qr').textContent = ''; }
    } else if (m.type === 'player-joined') {
      phones[m.player] = true; slotUI();
      sendPhone(m.player - 1, { type: 'meter', ready: false });
    } else if (m.type === 'player-left') {
      phones[m.player] = false; slotUI();
      const f = fighters[m.player - 1];
      f.setAxis('pad', 0, 0); f.setBlock('pad', false);
    } else if (m.type === 'input') {
      const f = fighters[m.player - 1];
      if (!f) return;
      // either phone can pause, even a second phone sitting out a CPU match
      if (m.action === 'start' && m.state === 'down' && phase === 'fight') { setPaused(!paused); return; }
      // paused: ○ quits to the lobby, and in training △ changes what the dummy does
      if (paused && phase === 'fight' && m.state === 'down') {
        if (m.action === 'block') { toLobby(); return; }
        if (m.action === 'special' && mode === 'training') { nextDummy(); return; }
      }
      if (phase === 'over' && run && koInfo?.shown && m.state === 'down' && m.action) {
        if (m.action === 'block') toLobby(); else resultNext();
        return;
      }
      if (m.player === 2 && cpuControlled() && phase !== 'lobby') return;
      if (m.joystick) {
        if (phase === 'lobby') {
          const x = m.joystick.x || 0;
          if (Math.abs(x) > 0.6 && !flick[m.player]) { flick[m.player] = true; cycle(m.player - 1, x > 0 ? 1 : -1); }
          else if (Math.abs(x) < 0.3) flick[m.player] = false;
        }
        f.setAxis('pad', m.joystick.x || 0, m.joystick.y || 0);
      }
      if (m.action) {
        if (m.action === 'block') {
          f.setBlock('pad', m.state === 'down');
          if (phase === 'lobby' && m.state === 'down') nextDifficulty(); // ○ in the lobby cycles it
        }
        else if (m.state === 'down') {
          if (phase === 'fight') { if (!paused) f.press(m.action); }
          else if (phase === 'over' && koInfo?.matchWon && !run) startMatch(mode);
          else if (phase === 'lobby') startMatch(phones[1] && phones[2] ? 'vs' : 'cpu');
        }
      }
    }
  };
}
connect();
$('#btnCpu').onclick = () => startMatch('cpu');
$('#btnVs').onclick = () => startMatch('vs');
// a clicked button keeps focus, so Enter or Space would press it again later
document.querySelectorAll('button').forEach((el) => el.addEventListener('click', () => el.blur()));
$('#btnArcade').onclick = startArcade;
$('#btnSurvival').onclick = startSurvival;
$('#btnTraining').onclick = () => { dummy = 'stand'; startMatch('training'); };

// ---------------------------------------------------------------- HUD + camera
const bars = [...document.querySelectorAll('.bar')];
const meters = [...document.querySelectorAll('.meter')];
const comboEls = [$('#combo'), $('#combo2')];
const timerEl = $('#timer');
let lastTimer = -1;
function updateHUD(dt) {
  fighters.forEach((f, i) => {
    const pct = Math.max(0, f.hp) + '%';
    bars[i].querySelector('.fill').style.width = pct;
    bars[i].querySelector('.lag').style.width = pct;
    bars[i].classList.toggle('low', f.hp < 28);
    meters[i].querySelector('i').style.width = Math.min(100, f.meter) + '%';
    const ready = f.meter >= 50;
    meters[i].classList.toggle('full', ready);
    if (ready !== wasReady[i]) { wasReady[i] = ready; sendPhone(i, { type: 'meter', ready }); }
    const cs = comboState[i];
    if (cs.t > 0) cs.t -= dt;
    const show = cs.t > 0 && cs.n >= 2;
    comboEls[i].style.opacity = show ? 1 : 0;
    if (show) comboEls[i].innerHTML = `${cs.n} HITS<small>COMBO</small>`;
  });
  const t = Math.ceil(roundTime);
  if (t !== lastTimer) { lastTimer = t; timerEl.textContent = t; }
}

const camLook = new THREE.Vector3(0, 1.15, 0);
let camX = 0, camDist = 6.2;
const tmpV = new THREE.Vector3();
function updateCamera(dt, t) {
  const [a, b] = fighters;
  let mid = (a.x + b.x) / 2;
  const sep = Math.abs(a.x - b.x);
  const aspect = camera.aspect;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
  let wantDist = Math.max(5.9, (sep + 3.4) / (2 * tanH));
  let focusY = 1.1;
  if (phase === 'ko' && koInfo?.loser) {
    mid = mid * 0.4 + koInfo.loser.x * 0.6;
    wantDist = Math.max(4.2, wantDist * 0.78);
    focusY = 0.9;
  }
  if (phase === 'lobby') { wantDist = 6.6; mid = Math.sin(t * 0.25) * 0.8; }
  const k = 1 - Math.exp(-6 * dt);
  camX += (mid - camX) * k;
  camDist += (wantDist - camDist) * (1 - Math.exp(-4 * dt));
  const sway = phase === 'lobby' ? Math.sin(t * 0.2) * 1.2 : Math.sin(t * 0.35) * 0.25;
  tmpV.set(camX + sway, 1.55 + (phase === 'lobby' ? 0.3 : 0), camDist);
  if (shake > 0) {
    tmpV.x += (Math.random() - 0.5) * shake;
    tmpV.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 0.9);
  }
  camera.position.copy(tmpV);
  camLook.set(camX * 0.98, focusY, 0);
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------- loop
const STEP = 1 / 60;
let acc = 0, last = performance.now(), clockT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  // a slow load can leave `last` ahead of the first frame's timestamp, and a negative step flings the camera
  const real = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  clockT += real;

  pollKeyboard();

  if (paused) {
    // the whole fight holds still, including the round timer and anything in the air
  } else if (hitstop > 0) {
    hitstop -= real;
  } else {
    acc += real * timeScale;
    let n = 0;
    while (acc >= STEP && n++ < 5) {
      if (phase === 'lobby') {
        brain.clear(fighters[1]);
      } else {
        stepMatch(STEP);
      }
      combat.update(STEP);
      acc -= STEP;
    }
  }

  // projectile visuals
  for (const p of combat.projectiles) {
    const m = fireMeshes.get(p.id);
    if (!m) continue;
    m.g.position.set(p.x, p.y, 0);
    m.g.scale.setScalar(1 + Math.sin(clockT * 30) * 0.08);
    if (m.lt) m.lt.l.position.set(p.x, p.y, 0.6);
    if (!paused && Math.random() < 0.7) fx.burst({ x: p.x - p.dir * 0.15, y: p.y, z: 0 }, COLORS[p.owner.idx], 1, 1.2);
  }

  fighters.forEach((f, i) => {
    iceShells[i].visible = f.frozen;
    if (f.frozen) iceShells[i].position.set(f.x, f.y + 1.05, 0);
    const armored = f.armor > 0;
    armorGlows[i].visible = armored;
    if (armored) {
      const size = 2.6 + Math.sin(clockT * 12) * 0.25;
      armorGlows[i].material.color.set(COLORS[i]);
      armorGlows[i].position.set(f.x, f.y + 1.1, 0);
      armorGlows[i].scale.set(size, size * 1.2, 1);
      if (!paused && Math.random() < 0.3) fx.burst({ x: f.x, y: f.y + 0.4 + Math.random() * 1.3, z: 0 }, COLORS[i], 1, 1.5);
    }
    if (!paused && f.state === 'attack' && f.atk.dash && f.phase === 'active') {
      fx.burst({ x: f.x, y: f.y + 1 + Math.random() * 0.5, z: 0 }, COLORS[i], 3, 1.5);
    }
    if (!paused && phase !== 'lobby' && f.hp > 0 && f.hp < 30 && Math.random() < real * 2.5) blood.drip(f.x, f.y + 1.1, f.cfg.blood);
  });

  if (!paused) {
    fighters.forEach((f) => f.skin?.update(real));
    fx.update(real);
    blood.update(real);
  }
  stage.update(clockT, real);
  updateHUD(real);
  updateCamera(real, clockT);
  composer.render();
}
requestAnimationFrame(frame);
window.__wandr = { fighters, combat, blood, startMatch, applyPick, pick, ROSTER, get phase() { return phase; }, get run() { return run; }, get mode() { return mode; }, get dummy() { return dummy; }, get paused() { return paused; }, brain };
