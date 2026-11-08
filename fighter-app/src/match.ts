// Match rules, as on the website: a round intro, FIGHT!, a 60 second timer, knockouts in
// slow motion, best of three rounds, against the CPU at the chosen difficulty.
import { AIBrain, DIFFICULTY } from './game/ai.js';
import type { Engine, FighterCfg } from './engine';

export type Difficulty = keyof typeof DIFFICULTY;
export const DIFFICULTIES = Object.keys(DIFFICULTY) as Difficulty[];
export type Phase = 'menu' | 'intro' | 'fight' | 'ko' | 'over';

export type Snapshot = {
  phase: Phase;
  paused: boolean;
  hp: [number, number];
  meter: [number, number];
  wins: [number, number];
  names: [string, string];
  colors: [number, number];
  specials: [string, string];
  time: number;
  banner: string;
  sub: string;
  combo: number;
  winner: number | null; // set once a match is decided: 0 you, 1 the CPU
};

export class Match {
  phase: Phase = 'menu';
  paused = false;
  difficulty: Difficulty = 'medium';
  private brain = new AIBrain(DIFFICULTY.medium);
  private round = 1;
  private wins: [number, number] = [0, 0];
  private roundTime = 60;
  private phaseT = 0;
  private loser: number | null = null;
  private roundWinner: number | null = null;
  private matchWon = false;
  private shown = false;
  private banner = '';
  private bannerUntil = 0;
  private sub = '';
  private clock = 0;

  constructor(private engine: Engine) {
    engine.onStep = (dt) => this.step(dt);
  }

  get you() { return this.engine.fighters[0]; }
  get cpu() { return this.engine.fighters[1]; }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    this.brain.level = DIFFICULTY[d];
  }

  // Sets up a fight. The world holds still until reveal(), so the round intro plays after
  // the versus screen, not underneath it. Resolves once both fighters are ready to draw.
  start(you: FighterCfg, cpu: FighterCfg) {
    const e = this.engine;
    const bodies = [e.setFighter(0, you), e.setFighter(1, cpu)];
    e.lobby = false;
    e.clearArena();
    this.wins = [0, 0];
    this.round = 1;
    this.paused = false;
    e.paused = false;
    e.fighters.forEach((f) => { f.meter = 0; });
    this.startRound();
    e.paused = true;
    return e.warm(bodies);
  }

  reveal() { this.engine.paused = false; }

  toMenu() {
    const e = this.engine;
    this.phase = 'menu';
    this.paused = false;
    e.paused = false;
    e.lobby = true;
    e.focus = null;
    e.timeScale = 1;
    e.clearArena();
    e.fighters.forEach((f, i) => { f.reset(i === 0 ? -1.4 : 1.4, false); f.setMode('idle'); });
    this.brain.clear(this.cpu);
    this.release();
    this.show('', 0);
    this.sub = '';
  }

  setPaused(on: boolean) {
    if (this.phase === 'menu') return;
    this.paused = on;
    this.engine.paused = on;
    if (on) this.release();
  }

  // ---------- your controls
  axis(x: number, y: number) { this.you.setAxis('pad', x, y); }
  button(action: 'punch' | 'kick' | 'special' | 'block', down: boolean) {
    if (action === 'block') { this.you.setBlock('pad', down); return; }
    if (down && this.phase === 'fight' && !this.paused) this.you.press(action);
  }
  private release() { this.you.setAxis('pad', 0, 0); this.you.setBlock('pad', false); }

  // ---------- flow
  private show(text: string, seconds: number) { this.banner = text; this.bannerUntil = seconds ? this.clock + seconds : Infinity; }

  private startRound() {
    const e = this.engine;
    e.combat.clearProjectiles();
    e.fighters.forEach((f, i) => { f.reset(i === 0 ? -1.4 : 1.4, true); f.state = 'intro'; });
    this.brain.clear(this.cpu);
    this.roundTime = 60;
    this.phase = 'intro';
    this.phaseT = 0;
    e.timeScale = 1;
    e.focus = null;
    this.loser = null;
    this.roundWinner = null;
    this.matchWon = false;
    this.shown = false;
    this.sub = '';
    this.show(this.wins[0] === 1 && this.wins[1] === 1 ? 'FINAL ROUND' : `ROUND ${this.round}`, 1.5);
  }

  private beginFight() {
    this.engine.fighters.forEach((f) => f.setMode('idle'));
    this.phase = 'fight';
    this.phaseT = 0;
    this.show('FIGHT!', 0.8);
  }

  private endRound(winner: number | null, how: 'ko' | 'time') {
    const f = this.engine.fighters;
    if (winner !== null) {
      this.wins[winner]++;
      f[winner].setMode('win');
      if (how !== 'ko') f[1 - winner].setMode('lose');
    }
    this.roundWinner = winner;
    this.matchWon = winner !== null && this.wins[winner] >= 2;
    this.phase = 'over';
    this.phaseT = 0;
    this.show(how === 'time' ? 'TIME UP' : 'K.O.', how === 'time' ? 1.3 : 0);
  }

  private step(dt: number) {
    const e = this.engine;
    this.clock += dt;
    if (this.clock > this.bannerUntil) this.banner = '';
    if (this.phase === 'menu') { this.brain.clear(this.cpu); return; }
    this.phaseT += dt;
    if (this.phase === 'intro') {
      if (this.phaseT > 1.9) this.beginFight();
    } else if (this.phase === 'fight') {
      this.roundTime -= dt;
      this.brain.think(this.cpu, this.you, dt);
      const dead = e.fighters.findIndex((f) => f.state === 'ko');
      if (dead >= 0) {
        this.phase = 'ko';
        this.phaseT = 0;
        e.timeScale = 0.25;
        this.loser = dead;
        e.focus = e.fighters[dead];
      } else if (this.roundTime <= 0) {
        this.roundTime = 0;
        const [a, b] = e.fighters;
        this.endRound(Math.abs(a.hp - b.hp) < 0.5 ? null : a.hp > b.hp ? 0 : 1, 'time');
      }
    } else if (this.phase === 'ko') {
      this.brain.clear(this.cpu);
      if (this.phaseT > 0.3) {
        e.timeScale = 1;
        this.endRound(1 - (this.loser ?? 0), 'ko');
      }
    } else if (this.phase === 'over') {
      this.brain.clear(this.cpu);
      const T = this.matchWon ? 2.2 : 2.0;
      if (this.phaseT > T && !this.shown) {
        this.shown = true;
        const w = this.roundWinner;
        if (this.matchWon && w !== null) { this.show(w === 0 ? 'YOU WIN' : `${e.fighters[w].name} WINS`, 0); this.sub = w === 0 ? `"${e.fighters[0].cfg.quote}"` : ''; }
        else if (w === null) this.show('DRAW', 1.2);
        else this.show(`${e.fighters[w].name} TAKES THE ROUND`, 1.6);
      }
      if (!this.matchWon && this.phaseT > 4.2) {
        this.round++;
        this.startRound();
      }
    }
  }

  snapshot(): Snapshot {
    const [a, b] = this.engine.fighters, c = this.engine.combo[0];
    return {
      phase: this.phase,
      paused: this.paused,
      hp: [a.hp, b.hp],
      meter: [a.meter, b.meter],
      wins: [...this.wins],
      names: [a.name, b.name],
      colors: [...this.engine.colors] as [number, number],
      specials: [a.cfg.ability.name, b.cfg.ability.name],
      time: Math.ceil(this.roundTime),
      banner: this.banner,
      sub: this.sub,
      combo: c.t > 0 && c.n >= 2 ? c.n : 0,
      winner: this.phase === 'over' && this.matchWon && this.shown ? this.roundWinner : null,
    };
  }
}
