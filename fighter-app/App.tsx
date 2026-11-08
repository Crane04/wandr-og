import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Engine, ROSTER, type Feedback } from './src/engine';
import { Match, DIFFICULTIES, type Snapshot } from './src/match';
import { Controls } from './src/ui/Controls';
import { Hud } from './src/ui/Hud';
import { Menu, Overlay } from './src/ui/Screens';
import { Loading } from './src/ui/Loading';
import { Versus } from './src/ui/Versus';
import type { FighterCfg } from './src/engine';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// keep the native splash up until the animated loading screen is drawn, so there's no gap
SplashScreen.preventAutoHideAsync().catch(() => {});

// a hit you take or land is felt; a big one harder
let lastBuzz = 0;
function buzz(f: Feedback) {
  const now = Date.now();
  if (now - lastBuzz < 60) return;
  lastBuzz = now;
  const style = f.block ? Haptics.ImpactFeedbackStyle.Light
    : (f.hit ?? 0) > 0.55 || f.ko ? Haptics.ImpactFeedbackStyle.Heavy
    : (f.hit ?? 0) > 0.2 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
  Haptics.impactAsync(style).catch(() => {});
}

// The 3D view draws about 1280 pixels across and the phone scales it up to fill the
// screen. A recent iPhone is ~2.5K wide, so this roughly quarters the GPU's pixel work,
// while the HUD and buttons (native views) stay full sharpness.
const RENDER_WIDTH = 1280;

// buttons don't redraw when the HUD updates
const FightControls = memo(Controls);

export default function App() {
  useKeepAwake(); // nobody wants the screen dimming mid-round
  const engine = useRef<Engine | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [pick, setPick] = useState(0);
  const [difficulty, setDifficulty] = useState(1); // medium
  const { width, height } = useWindowDimensions();
  const f = Math.min(1, RENDER_WIDTH / (Math.max(width, height) * PixelRatio.get()));
  const glStyle = { position: 'absolute' as const, left: 0, top: 0, width: width * f, height: height * f, transform: [{ scale: 1 / f }], transformOrigin: 'top left' };
  const [stats, setStats] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const hideLoading = useCallback(() => setLoading(false), []);
  const [versus, setVersus] = useState<{ you: FighterCfg; cpu: FighterCfg; ready: boolean } | null>(null);
  const endVersus = useCallback(() => { setVersus(null); match?.reveal(); }, [match]);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => engine.current?.stop();
  }, []);

  // the HUD reads the match about 15 times a second; the 3D view runs on its own every frame
  useEffect(() => {
    if (!match) return;
    const t = setInterval(() => setSnap(match.snapshot()), 66);
    const s = setInterval(() => { const st = engine.current?.stats; if (st) setStats(`${st.fps} fps · ${st.ms} ms · ${st.calls} draws`); }, 500);
    return () => { clearInterval(t); clearInterval(s); };
  }, [match]);

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    const e = new Engine(gl);
    e.onFeedback = (f, idx) => { if (idx === 0) buzz(f); };
    e.onReady = () => setReady(true);
    engine.current = e;
    e.start();
    setMatch(new Match(e));
  };

  const choose = (dir: number) => {
    const next = (pick + dir + ROSTER.length) % ROSTER.length;
    setPick(next);
    engine.current?.setFighter(0, ROSTER[next]);
  };
  // The versus screen goes up first; the opponent is built behind it, and it stays at
  // least 1.3s so it reads as part of the game, not a loading flash.
  const fight = () => {
    if (!match) return;
    const others = ROSTER.filter((_, i) => i !== pick);
    const you = ROSTER[pick], cpu = others[Math.floor(Math.random() * others.length)];
    setVersus({ you, cpu, ready: false });
    // two frames, so the versus screen is on the glass before the heavy work starts
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const t0 = Date.now();
      match.setDifficulty(DIFFICULTIES[difficulty]);
      match.start(you, cpu).then(() => {
        setTimeout(() => setVersus((v) => v && { ...v, ready: true }), Math.max(0, 1300 - (Date.now() - t0)));
      });
    }));
  };
  const toMenu = () => {
    match?.toMenu();
    engine.current?.setFighter(0, ROSTER[pick]);
  };

  const onAxis = useCallback((x: number, y: number) => match?.axis(x, y), [match]);
  const onButton = useCallback((a: 'punch' | 'kick' | 'special' | 'block', down: boolean) => match?.button(a, down), [match]);
  const onPause = useCallback(() => match?.setPaused(true), [match]);

  const phase = snap?.phase ?? 'menu';
  const inFight = !!match && phase !== 'menu';

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      <GLView style={glStyle} onContextCreate={onContextCreate} />
      {match && ready && phase === 'menu' && (
        <Menu
          fighter={ROSTER[pick]} onPrev={() => choose(-1)} onNext={() => choose(1)}
          difficulty={DIFFICULTIES[difficulty]} onDifficulty={() => setDifficulty((difficulty + 1) % DIFFICULTIES.length)}
          onFight={fight}
        />
      )}
      {inFight && snap && !versus && <Hud s={snap} />}
      {inFight && snap && !versus && !snap.paused && snap.winner === null && (
        <FightControls onAxis={onAxis} onButton={onButton} onPause={onPause} specialReady={snap.meter[0] >= 50} />
      )}
      {!!stats && <Text style={styles.stats} pointerEvents="none">{stats}</Text>}
      {inFight && snap?.paused && (
        <Overlay title="PAUSED" actions={[{ label: 'RESUME', onPress: () => match.setPaused(false) }, { label: 'QUIT', onPress: toMenu, alt: true }]} />
      )}
      {inFight && snap && snap.winner !== null && (
        <Overlay
          title={snap.winner === 0 ? 'YOU WIN' : `${snap.names[1]} WINS`}
          line={snap.sub}
          actions={[{ label: 'REMATCH', onPress: fight }, { label: 'MENU', onPress: toMenu, alt: true }]}
        />
      )}
      {versus && <Versus you={versus.you} cpu={versus.cpu} ready={versus.ready} onGone={endVersus} />}
      {loading && <Loading ready={ready} onGone={hideLoading} onShown={() => SplashScreen.hideAsync().catch(() => {})} />}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060f' },
  stats: { position: 'absolute', left: 8, bottom: 4, color: 'rgba(255,255,255,0.6)', fontSize: 10 },
});
