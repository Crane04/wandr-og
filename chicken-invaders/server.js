const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// A room can have the lobby host plus one host per split-screen viewport.
// hosts: Set<ws>, where host.playerSlot is null (lobby) or a player number.
const rooms = {};

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.room = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'host-create') {
      const requestedCode = typeof msg.hostId === 'string' && /^[A-Z2-9]{4}$/.test(msg.hostId.toUpperCase())
        ? msg.hostId.toUpperCase()
        : null;
      const code = requestedCode || makeCode();
      if (!rooms[code]) rooms[code] = { hosts: new Set(), persistent: true, controllers: new Set() };
      rooms[code].hosts.add(ws);
      ws.role = 'host';
      ws.room = code;
      ws.playerSlot = Number.isInteger(msg.playerSlot) ? msg.playerSlot : null;
      ws.send(JSON.stringify({ type: 'room-created', room: code, ip: localIp(), port: PORT }));
      for (const controller of rooms[code].controllers) {
        ws.send(JSON.stringify({ type: 'player-joined', playerNum: controller.playerNum }));
      }
      return;
    }

    if (msg.type === 'join') {
      const roomCode = typeof msg.room === 'string' ? msg.room.toUpperCase() : '';
      const room = rooms[roomCode];
      if (!room) {
        ws.send(JSON.stringify({ type: 'join-error', message: 'Room not found' }));
        return;
      }

      // A phone can briefly retain its old socket after a refresh. Replace that
      // stale connection instead of assigning the same phone a second slot.
      const controllerId = typeof msg.controllerId === 'string' ? msg.controllerId.slice(0, 80) : '';
      const previous = controllerId
        ? Array.from(room.controllers).find(controller => controller !== ws && controller.controllerId === controllerId)
        : null;
      const previousPlayerNum = previous?.playerNum;
      if (previous) {
        room.controllers.delete(previous);
        previous.role = null;
        previous.close(1000, 'Replaced by refreshed controller');
      }

      // Joining twice on one socket is idempotent.
      if (room.controllers.has(ws)) {
        ws.send(JSON.stringify({ type: 'joined', room: roomCode, playerNum: ws.playerNum }));
        return;
      }

      ws.role = 'controller';
      ws.room = roomCode;
      ws.controllerId = controllerId;
      const usedSlots = new Set(Array.from(room.controllers, controller => controller.playerNum));
      const playerNum = previousPlayerNum || [1, 2].find(slot => !usedSlots.has(slot));
      if (!playerNum) {
        ws.send(JSON.stringify({ type: 'join-error', message: 'This game already has two players' }));
        ws.role = null;
        ws.room = null;
        return;
      }
      room.controllers.add(ws);
      ws.playerNum = playerNum;
      ws.send(JSON.stringify({ type: 'joined', room: roomCode, playerNum }));
      for (const host of room.hosts) host.send(JSON.stringify({ type: 'player-joined', playerNum }));
      return;
    }

    if (msg.type === 'input' && ws.role === 'controller') {
      const room = rooms[ws.room];
      if (room) {
        for (const host of room.hosts) {
          if (host.playerSlot !== null && host.playerSlot !== ws.playerNum) continue;
          host.send(JSON.stringify({
          type: 'input',
          action: msg.action,
          state: msg.state,
          playerNum: ws.playerNum,
          }));
        }
      }
      return;
    }
  });

  ws.on('close', () => {
    if (ws.role === 'host' && ws.room) {
      const room = rooms[ws.room];
      if (room) room.hosts.delete(ws);
    }
    if (ws.role === 'controller' && ws.room && rooms[ws.room]) {
      rooms[ws.room].controllers.delete(ws);
      for (const host of rooms[ws.room].hosts) {
        host.send(JSON.stringify({ type: 'player-left', playerNum: ws.playerNum }));
      }
    }
  });
});

function localIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chicken Invaders server running:`);
  console.log(`  Laptop (game):      http://localhost:${PORT}/`);
  console.log(`  Phone (controller): http://${localIp()}:${PORT}/controller.html`);
});
