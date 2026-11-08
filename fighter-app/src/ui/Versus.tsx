// The "YOU vs OPPONENT" screen between the menu and the fight. It also covers the moment
// the opponent is being built, so that never shows as a freeze. Native-driver animations
// keep it moving while JavaScript does that work.
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { FighterCfg } from '../engine';
import { hex } from './Hud';

const native = { useNativeDriver: true } as const;

export function Versus({ you, cpu, ready, onGone }: { you: FighterCfg; cpu: FighterCfg; ready: boolean; onGone: () => void }) {
  const [enter] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));

  useEffect(() => {
    Animated.sequence([
      Animated.timing(enter, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), ...native }),
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 140, ...native }),
    ]).start();
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.sin), ...native }),
      Animated.timing(pulse, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.sin), ...native }),
    ]));
    p.start();
    return () => p.stop();
  }, [enter, pop, pulse]);

  useEffect(() => {
    if (ready) Animated.timing(fade, { toValue: 0, duration: 320, ...native }).start(() => onGone());
  }, [ready, fade, onGone]);

  const fromLeft = enter.interpolate({ inputRange: [0, 1], outputRange: [-420, 0] });
  const fromRight = enter.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });
  const vsScale = pop.interpolate({ inputRange: [0, 1], outputRange: [2.4, 1] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  const side = (c: FighterCfg, x: Animated.AnimatedInterpolation<number>, right?: boolean, label?: string) => (
    <Animated.View style={[styles.side, right && styles.right, { borderColor: hex(c.fx), transform: [{ translateX: x }] }]}>
      <Text style={styles.tag}>{label}</Text>
      <Text style={[styles.name, { color: hex(c.fx) }]} adjustsFontSizeToFit numberOfLines={1}>{c.name}</Text>
      <Text style={styles.title}>{c.title}</Text>
    </Animated.View>
  );

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} pointerEvents={ready ? 'none' : 'auto'}>
      <View style={styles.row}>
        {side(you, fromLeft, false, 'YOU')}
        <Animated.Text style={[styles.vs, { opacity: glow, transform: [{ scale: vsScale }] }]}>VS</Animated.Text>
        {side(cpu, fromRight, true, 'CPU')}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#05060f', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  side: { width: 280, paddingVertical: 18, paddingHorizontal: 22, borderLeftWidth: 4, backgroundColor: 'rgba(255,255,255,0.04)' },
  right: { borderLeftWidth: 0, borderRightWidth: 4, alignItems: 'flex-end' },
  tag: { color: '#9aa4c8', fontSize: 11, fontWeight: '900', letterSpacing: 4 },
  name: { marginTop: 2, fontSize: 46, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2 },
  title: { color: '#cfd6f0', fontSize: 11, letterSpacing: 3 },
  vs: { color: '#e8b45a', fontSize: 54, fontWeight: '900', fontStyle: 'italic', textShadowColor: 'rgba(232,180,90,0.6)', textShadowRadius: 20 },
});
