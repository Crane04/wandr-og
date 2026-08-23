const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// rooms: { code: { host: ws|null, persistent: boolean, controllers: Set<ws> } }
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

wss.on('connection', (ws) => {
  ws.role = null;
  ws.room = null;
  ws.team = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'host-create') {
      const requestedCode = typeof msg.hostId === 'string' && /^[A-Z2-9]{4}$/.test(msg.hostId.toUpperCase())
        ? msg.hostId.toUpperCase()
        : null;
      const code = requestedCode || makeCode();
      if (!rooms[code]) {
        rooms[code] = { host: ws, persistent: true, controllers: new Set() };
      } else {
        rooms[code].host = ws;
      }
      ws.role = 'host';
      ws.room = code;
      ws.send(JSON.stringify({ type: 'room-created', room: code, ip: localIp(), port: PORT }));
      for (const controller of rooms[code].controllers) {
        ws.send(JSON.stringify({ type: 'player-joined', team: controller.team }));
      }
      return;
    }

    if (msg.type === 'join') {
      const room = rooms[msg.room];
      if (!room) {
        ws.send(JSON.stringify({ type: 'join-error', message: 'Room not found' }));
        return;
      }
      if (room.controllers.size >= 2) {
        ws.send(JSON.stringify({ type: 'join-error', message: 'Room full (2/2 teams taken)' }));
        return;
      }
      ws.role = 'controller';
      ws.room = msg.room;
      const occupiedTeams = new Set([...room.controllers].map((controller) => controller.team));
      ws.team = occupiedTeams.has('A') ? 'B' : 'A';
      room.controllers.add(ws);
      ws.send(JSON.stringify({ type: 'joined', room: msg.room, team: ws.team }));
      if (room.host) {
        room.host.send(JSON.stringify({ type: 'player-joined', team: ws.team }));
      }
      return;
    }

    if (msg.type === 'input' && ws.role === 'controller') {
      const room = rooms[ws.room];
      if (room && room.host) {
        room.host.send(JSON.stringify({
          type: 'input',
          team: ws.team,
          joystick: msg.joystick,   // { x: -1..1, y: -1..1 }
          button: msg.button,        // shortPass | cross | longPass | shoot | start
          state: msg.state,          // down | up
          action: msg.action,        // legacy controller support
        }));
      }
      return;
    }
  });

  ws.on('close', () => {
    if (ws.role === 'host' && ws.room) {
      const room = rooms[ws.room];
      if (room && room.host === ws) {
        if (room.persistent) room.host = null;
        else delete rooms[ws.room];
      }
    }
    if (ws.role === 'controller' && ws.room && rooms[ws.room]) {
      rooms[ws.room].controllers.delete(ws);
      if (rooms[ws.room].host) {
        rooms[ws.room].host.send(JSON.stringify({ type: 'player-left', team: ws.team }));
      }
    }
  });
});

const PORT = process.env.PORT || 3009;
server.listen(PORT, () => {
  console.log(`Football server running:`);
  console.log(`  Laptop (game):      http://localhost:${PORT}/`);
  console.log(`  Phone (controller): http://${localIp()}:${PORT}/controller.html`);
});
