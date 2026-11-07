const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const app = express();
// three.js is served straight from node_modules so the game has no CDN dependency
app.use('/three', express.static(path.join(__dirname, 'node_modules/three')));
app.use('/qr', express.static(path.join(__dirname, 'node_modules/qrcode-generator/dist')));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// rooms: { code: { host, slots: [ws|null, ws|null] } }  (slot 0 = Player 1, slot 1 = Player 2)
const rooms = {};

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function localIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

wss.on('connection', (ws) => {
  ws.role = null;
  ws.room = null;
  ws.slot = 0;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'host-create') {
      // the laptop asks for its old code back, so a refresh keeps the room and its phones
      const wanted = typeof msg.hostId === 'string' ? msg.hostId.toUpperCase() : '';
      const code = /^[A-Z2-9]{4}$/.test(wanted) ? wanted : makeCode();
      const room = rooms[code] || (rooms[code] = { host: null, slots: [null, null] });
      room.host = ws;
      ws.role = 'host';
      ws.room = code;
      send(ws, { type: 'room-created', room: code, ip: localIp(), port: PORT });
      room.slots.forEach((s, i) => {
        if (!s) return;
        send(ws, { type: 'player-joined', player: i + 1 });
        send(s, { type: 'joined', room: code, player: i + 1 });
      });
      return;
    }

    if (msg.type === 'join') {
      const room = rooms[msg.room];
      if (!room) return send(ws, { type: 'join-error', message: 'Room not found' });
      const idx = room.slots.findIndex((s) => !s);
      if (idx < 0) return send(ws, { type: 'join-error', message: 'Room full (2/2 fighters)' });
      room.slots[idx] = ws;
      ws.role = 'controller';
      ws.room = msg.room;
      ws.slot = idx + 1;
      send(ws, { type: 'joined', room: msg.room, player: ws.slot });
      send(room.host, { type: 'player-joined', player: ws.slot });
      return;
    }

    if (msg.type === 'input' && ws.role === 'controller') {
      const room = rooms[ws.room];
      if (room) {
        send(room.host, {
          type: 'input',
          player: ws.slot,
          joystick: msg.joystick,
          action: msg.action,
          state: msg.state,
        });
      }
      return;
    }

    // host -> a specific phone (rumble, meter-ready glow, ...)
    if (msg.type === 'to-player' && ws.role === 'host') {
      const room = rooms[ws.room];
      if (room) send(room.slots[msg.player - 1], msg.payload);
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.room];
    if (!room) return;
    if (ws.role === 'host') {
      if (room.host !== ws) return; // a refreshed page can connect before the old one closes
      room.host = null;
      room.slots.forEach((s) => send(s, { type: 'host-left' }));
    } else if (ws.role === 'controller') {
      room.slots[ws.slot - 1] = null;
      send(room.host, { type: 'player-left', player: ws.slot });
    }
    if (!room.host && !room.slots.some(Boolean)) delete rooms[ws.room];
  });
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
  console.log('Fight server running:');
  console.log(`  Laptop (game):      http://localhost:${PORT}/game.html`);
  console.log(`  Phone (controller): http://${localIp()}:${PORT}/controller.html`);
});
