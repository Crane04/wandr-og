// Touch controls like a normal phone fighter: a stick that appears under your left
// thumb, and □ punch, × kick, ○ block (hold), △ special on the right.
// Built on Gesture Handler, which tracks each finger natively and always reports when
// tracking ends (onFinalize), so a control can't be left stuck "held".
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, useManualGesture } from 'react-native-gesture-handler';

type Action = 'punch' | 'kick' | 'special' | 'block';
type Touch = { id: number; x: number; y: number; absoluteX: number; absoluteY: number };
const DEADZONE = 0.22;
const STICK = 128;  // base size
const RADIUS = 46;  // how far the knob travels
const JS = { runOnJS: true, disableReanimated: true } as const; // plain JS callbacks, no Reanimated

function Stick({ onAxis }: { onAxis: (x: number, y: number) => void }) {
  const finger = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const [base, setBase] = useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const move = (t: Touch) => {
    let dx = t.absoluteX - start.current.x, dy = t.absoluteY - start.current.y;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) { dx = (dx / d) * RADIUS; dy = (dy / d) * RADIUS; }
    setKnob({ x: dx, y: dy });
    const x = dx / RADIUS, y = dy / RADIUS;
    onAxis(Math.abs(x) < DEADZONE ? 0 : x, Math.abs(y) < DEADZONE ? 0 : y);
  };
  const reset = () => {
    finger.current = null;
    setBase(null);
    setKnob({ x: 0, y: 0 });
    onAxis(0, 0);
  };
  const gesture = useManualGesture({
    ...JS,
    shouldCancelWhenOutside: false, // a thumb sliding off the zone keeps steering
    onTouchesDown: (e) => {
      if (finger.current !== null) return;
      const t = e.changedTouches[0];
      finger.current = t.id;
      start.current = { x: t.absoluteX, y: t.absoluteY };
      setBase({ x: t.x, y: t.y });
      move(t);
    },
    onTouchesMove: (e) => { for (const t of e.changedTouches) if (t.id === finger.current) move(t); },
    onTouchesUp: (e) => { if (e.changedTouches.some((t) => t.id === finger.current)) reset(); },
    onTouchesCancel: reset,
    onFinalize: reset, // the backstop: tracking ended for any reason, so let go
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.stickZone}>
        <View style={[styles.base, base ? { left: base.x - STICK / 2, top: base.y - STICK / 2, opacity: 1 } : styles.restBase]}>
          <View style={[styles.knob, { transform: [{ translateX: knob.x }, { translateY: knob.y }] }]} />
        </View>
      </View>
    </GestureDetector>
  );
}

function Button({ label, action, style, onButton, glow }: { label: string; action: Action; style: object; onButton: (a: Action, down: boolean) => void; glow?: boolean }) {
  const held = useRef(new Set<number>());
  const pressed = useRef(false); // a ref, so release never reads a stale value
  const [down, setDown] = useState(false);
  const press = () => { pressed.current = true; setDown(true); onButton(action, true); };
  const release = () => {
    held.current.clear();
    if (!pressed.current) return;
    pressed.current = false;
    setDown(false);
    onButton(action, false);
  };
  const gesture = useManualGesture({
    ...JS,
    shouldCancelWhenOutside: false,
    onTouchesDown: (e) => {
      const wasUp = held.current.size === 0;
      e.changedTouches.forEach((t) => held.current.add(t.id));
      if (wasUp) press();
    },
    onTouchesUp: (e) => {
      e.changedTouches.forEach((t) => held.current.delete(t.id));
      if (held.current.size === 0) release();
    },
    onTouchesCancel: release,
    onFinalize: release,
  });
  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.btn, style, glow && styles.glow, down && styles.btnDown]}>
        <Text style={[styles.btnText, glow && styles.glowText]}>{label}</Text>
      </View>
    </GestureDetector>
  );
}

export function Controls({ onAxis, onButton, onPause, specialReady }: {
  onAxis: (x: number, y: number) => void;
  onButton: (a: Action, down: boolean) => void;
  onPause: () => void;
  specialReady: boolean;
}) {
  const pause = useManualGesture({ ...JS, onTouchesUp: onPause });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Stick onAxis={onAxis} />
      <View style={styles.pad} pointerEvents="box-none">
        <Button label="△" action="special" style={styles.top} onButton={onButton} glow={specialReady} />
        <Button label="□" action="punch" style={styles.left} onButton={onButton} />
        <Button label="○" action="block" style={styles.right} onButton={onButton} />
        <Button label="×" action="kick" style={styles.bottom} onButton={onButton} />
      </View>
      <GestureDetector gesture={pause}>
        <View style={styles.pause}>
          <Text style={styles.pauseText}>II</Text>
        </View>
      </GestureDetector>
    </View>
  );
}

const SIZE = 66;
const styles = StyleSheet.create({
  stickZone: { position: 'absolute', left: 0, top: '22%', bottom: 0, width: '46%' },
  base: { position: 'absolute', width: STICK, height: STICK, borderRadius: STICK / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  restBase: { left: '28%', top: '58%', marginLeft: -STICK / 2, marginTop: -STICK / 2, opacity: 0.4 },
  knob: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255,255,255,0.3)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)' },
  pad: { position: 'absolute', right: 36, bottom: 22, width: SIZE * 3, height: SIZE * 3 },
  btn: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.32)', backgroundColor: 'rgba(14,16,32,0.55)', alignItems: 'center', justifyContent: 'center' },
  btnDown: { backgroundColor: 'rgba(232,180,90,0.5)', transform: [{ scale: 0.9 }] },
  btnText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  top: { left: SIZE, top: 0 },
  left: { left: 0, top: SIZE },
  right: { right: 0, top: SIZE },
  bottom: { left: SIZE, bottom: 0 },
  glow: { borderColor: '#ffd77a', shadowColor: '#ffc85a', shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  glowText: { color: '#ffd77a' },
  pause: { position: 'absolute', alignSelf: 'center', bottom: 12, width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: 'rgba(255,255,255,0.32)', backgroundColor: 'rgba(14,16,32,0.55)', alignItems: 'center', justifyContent: 'center' },
  pauseText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
