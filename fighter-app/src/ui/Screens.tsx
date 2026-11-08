// The menu (pick a fighter and a difficulty) and the pause / match-over overlays.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FighterCfg } from '../engine';
import type { Difficulty } from '../match';
import { hex } from './Hud';

function Btn({ label, onPress, alt }: { label: string; onPress: () => void; alt?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.btn, alt && styles.btnAlt, pressed && { opacity: 0.7 }]}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

export function Menu({ fighter, onPrev, onNext, difficulty, onDifficulty, onFight }: {
  fighter: FighterCfg; onPrev: () => void; onNext: () => void;
  difficulty: Difficulty; onDifficulty: () => void; onFight: () => void;
}) {
  return (
    <View style={styles.menu}>
      <Text style={styles.logo}>IRON COURTYARD</Text>
      <View style={[styles.card, { borderColor: hex(fighter.fx) }]}>
        <View style={styles.pick}>
          <Pressable onPress={onPrev} hitSlop={16}><Text style={styles.arrow}>‹</Text></Pressable>
          <Text style={[styles.who, { color: hex(fighter.fx) }]}>{fighter.name}</Text>
          <Pressable onPress={onNext} hitSlop={16}><Text style={styles.arrow}>›</Text></Pressable>
        </View>
        <Text style={styles.title}>{fighter.title}</Text>
        <Text style={styles.ability}>{fighter.ability.name}</Text>
        <Text style={styles.desc}>{fighter.ability.desc}</Text>
      </View>
      <View style={styles.row}>
        <Btn label="FIGHT" onPress={onFight} />
        <Btn label={`CPU: ${difficulty.toUpperCase()}`} onPress={onDifficulty} alt />
      </View>
    </View>
  );
}

export function Overlay({ title, line, actions }: { title: string; line?: string; actions: { label: string; onPress: () => void; alt?: boolean }[] }) {
  return (
    <View style={styles.overlay}>
      <Text style={styles.overTitle}>{title}</Text>
      {!!line && <Text style={styles.line}>{line}</Text>}
      <View style={styles.row}>{actions.map((a) => <Btn key={a.label} {...a} />)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(3,3,10,0.45)' },
  logo: { color: '#e8b45a', fontSize: 40, fontWeight: '900', fontStyle: 'italic', letterSpacing: 4, textShadowColor: 'rgba(232,180,90,0.5)', textShadowRadius: 18 },
  card: { marginTop: 14, width: 340, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 2, borderRadius: 8, backgroundColor: 'rgba(10,10,24,0.7)', alignItems: 'center' },
  pick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  arrow: { color: '#fff', fontSize: 40, fontWeight: '300', paddingHorizontal: 12 },
  who: { fontSize: 30, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2 },
  title: { color: '#9aa4c8', fontSize: 10, letterSpacing: 3 },
  ability: { marginTop: 8, color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  desc: { marginTop: 2, color: '#cfd6f0', fontSize: 12, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { paddingVertical: 12, paddingHorizontal: 26, borderRadius: 6, backgroundColor: '#c88a2c' },
  btnAlt: { backgroundColor: '#3a4686' },
  btnText: { color: '#fff', fontWeight: '900', letterSpacing: 3, fontSize: 14 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,5,12,0.62)' },
  overTitle: { color: '#fff', fontSize: 54, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3 },
  line: { marginTop: 6, color: '#ffe2a8', fontSize: 15, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 40 },
});
