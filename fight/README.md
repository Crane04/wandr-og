# Iron Courtyard (wandr fighter)

3D 1v1 fighter. Laptop renders, phones are the controllers.

```
npm install
node server.js
```

Open http://localhost:3004/game.html on the laptop. Scan the QR with a phone on the same wifi.

Keyboard (testing): P1 WASD + J punch, K kick, L special, I block. P2 arrows + . / ; '

Solo modes (lobby, second row):
- ARCADE: 5 different opponents in a row, each best of 3, the CPU a notch harder every stage. Lose and you retry that stage.
- SURVIVAL: one round per opponent and one health bar for the whole run. Each win gives back 20 health and the CPU gets harder. Your best count is saved in this browser.
- TRAINING: no timer and no knockouts. The dummy stands, blocks or attacks: switch with T, by clicking the label under the timer, or △ on a phone while paused.

Both arcade and survival start from the chosen CPU difficulty. While paused, ○ on a phone quits to the lobby.

CPU difficulty: the button next to VS CPU, or ○ on a phone in the lobby, cycles Easy, Medium, Hard and Expert. It's remembered in this browser.

Pause: START on either phone, or Enter on the keyboard. Esc quits to the lobby.

Movement: push the stick partway to walk and all the way towards your opponent to run (on a keyboard, double-tap the direction). Backing away is always a slower walk.

Moves: punch, kick, down+punch uppercut, down+kick sweep, jump+kick air kick, special (needs 50 meter).

Specials, one per fighter (data in `ATTACKS` in `public/js/fighter.js`):

- RIME, Frost Shard: a shot that freezes the target for 1.3s. Any hit breaks the ice.
- SAFFRON, Blade Rush: a fast dash strike that can't be hit until it ends.
- CINDER, Shadow Step: vanishes, reappears behind the opponent and kicks. Blockable.
- CIPHER, Overdrive: 3.5s of armor. No flinch or knockdown, 30% less damage taken, 10% more dealt.
- ORO, Quake: a shockwave along the floor. Jump it or guard low.
- LIRA, Second Wind: recovers 22 health.
- KAIN, Soul Drain: a lunging strike that heals by 75% of the damage it deals.
- ZEPHYR, Gale Blast: a fast shot with huge knockback.

Tuning knobs: light intensities and `scene.environmentIntensity` in `public/js/stage.js`, `toneMappingExposure` and bloom in `public/js/main.js`.

Logic test (no browser): `node test/sim.mjs`
