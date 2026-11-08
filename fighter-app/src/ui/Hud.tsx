// The fight's heads-up display, laid out like the website's: health bars and names across
// the top, round wins, the timer, special meters, and the big round banners.
import { StyleSheet, Text, View } from 'react-native';
import type { Snapshot } from '../match';

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function Bar({ hp, side }: { hp: number; side: 0 | 1 }) {
  const pct = Math.max(0, Math.min(100, hp));
  return (
    <View style={[styles.bar, side ? styles.right : styles.left]}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: hp < 28 ? '#ff5a4a' : '#e8b45a' }, side ? { alignSelf: 'flex-end' } : null]} />
    </View>
  );
}

export function Hud({ s }: { s: Snapshot }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.top}>
        {[0, 1].map((i) => (
          <View key={i} style={[styles.side, i ? { alignItems: 'flex-end' } : null]}>
            <Bar hp={s.hp[i]} side={i as 0 | 1} />
            <View style={[styles.row, i ? { flexDirection: 'row-reverse' } : null]}>
              <Text style={[styles.name, { color: i ? '#ff8f86' : '#8fb4ff' }]}>{i ? s.names[1] : 'YOU · ' + s.names[0]}</Text>
              <View style={[styles.pips, i ? { flexDirection: 'row-reverse' } : null]}>
                {[0, 1].map((k) => <View key={k} style={[styles.pip, k < s.wins[i] && styles.pipWon]} />)}
              </View>
            </View>
            <View style={[styles.meter, i ? { alignSelf: 'flex-end' } : null]}>
              <View style={[styles.meterFill, { width: `${Math.min(100, s.meter[i])}%`, backgroundColor: hex(s.colors[i]) }]} />
            </View>
            {s.meter[i] >= 50 && <Text style={[styles.ready, { color: hex(s.colors[i]) }]}>{s.specials[i]} READY</Text>}
          </View>
        ))}
        <Text style={styles.timer}>{s.time}</Text>
      </View>
      {s.combo > 0 && <Text style={styles.combo}>{s.combo} HITS</Text>}
      {!!s.banner && <Text style={styles.banner} adjustsFontSizeToFit numberOfLines={1}>{s.banner}</Text>}
      {!!s.sub && <Text style={styles.sub}>{s.sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, paddingHorizontal: 44 },
  side: { width: '40%' },
  bar: { alignSelf: 'stretch', height: 16, borderRadius: 3, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(0,0,0,0.55)', overflow: 'hidden' },
  left: {}, right: {},
  fill: { height: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  name: { fontWeight: '900', letterSpacing: 2, fontSize: 13, textShadowColor: '#000', textShadowRadius: 4 },
  pips: { flexDirection: 'row', gap: 5 },
  pip: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  pipWon: { backgroundColor: '#e8b45a', borderColor: '#e8b45a' },
  meter: { marginTop: 4, width: '55%', height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  meterFill: { height: '100%' },
  ready: { marginTop: 2, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  timer: { position: 'absolute', left: 0, right: 0, top: 4, textAlign: 'center', color: '#fff', fontSize: 34, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 8 },
  combo: { position: 'absolute', left: 50, top: '32%', color: '#e8b45a', fontSize: 30, fontWeight: '900', fontStyle: 'italic', textShadowColor: '#000', textShadowRadius: 8 },
  banner: { position: 'absolute', left: 30, right: 30, top: '30%', textAlign: 'center', color: '#fff', fontSize: 64, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 16 },
  sub: { position: 'absolute', left: 40, right: 40, top: '56%', textAlign: 'center', color: '#ffe2a8', fontSize: 16, fontStyle: 'italic', textShadowColor: '#000', textShadowRadius: 6 },
});
