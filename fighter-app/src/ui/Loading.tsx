// Covers the arena while fighters load and shaders compile. Every animation here runs
// on the native driver, so it keeps moving even while JavaScript is busy loading.
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const loop = (v: Animated.Value, ms: number, easing = Easing.linear) =>
  Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing, useNativeDriver: true }));

export function Loading({ ready, onGone, onShown }: { ready: boolean; onGone: () => void; onShown?: () => void }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [breathe] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const anims = [
      loop(spin, 1400),
      Animated.loop(Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])),
      loop(sweep, 1100, Easing.inOut(Easing.quad)),
    ];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [spin, breathe, sweep]);

  // crossfade into the arena once the fighters are actually on screen
  useEffect(() => {
    if (ready) Animated.timing(fade, { toValue: 0, duration: 450, useNativeDriver: true }).start(() => onGone());
  }, [ready, fade, onGone]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const glow = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  const x = sweep.interpolate({ inputRange: [0, 1], outputRange: [-90, 200] });

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} onLayout={onShown} pointerEvents={ready ? 'none' : 'auto'}>
      <Animated.Text style={[styles.logo, { opacity: glow, transform: [{ scale }] }]}>IRON COURTYARD</Animated.Text>
      <View style={styles.ringBox}>
        <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
        <Text style={styles.vs}>VS</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.light, { transform: [{ translateX: x }] }]} />
      </View>
      <Text style={styles.label}>ENTERING THE COURTYARD</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#05060f', alignItems: 'center', justifyContent: 'center' },
  logo: { color: '#e8b45a', fontSize: 44, fontWeight: '900', fontStyle: 'italic', letterSpacing: 5, textShadowColor: 'rgba(232,180,90,0.55)', textShadowRadius: 22 },
  ringBox: { marginTop: 22, width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: 'rgba(232,180,90,0.18)', borderTopColor: '#e8b45a', borderRightColor: '#e8b45a' },
  vs: { color: '#fff', fontWeight: '900', fontStyle: 'italic', fontSize: 16, letterSpacing: 1 },
  track: { marginTop: 22, width: 200, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  light: { width: 90, height: 3, borderRadius: 2, backgroundColor: '#e8b45a' },
  label: { marginTop: 12, color: '#9aa4c8', fontSize: 10, fontWeight: '700', letterSpacing: 4 },
});
