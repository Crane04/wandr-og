const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const os = require("os");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = {}; // { code: { host, controller } }

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from(
      { length: 4 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  } while (rooms[code]);
  return code;
}

function localIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

wss.on("connection", (ws) => {
  ws.role = null;
  ws.room = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "host-create") {
      const requestedCode =
        typeof msg.hostId === "string" &&
        /^[A-Z2-9]{4}$/.test(msg.hostId.toUpperCase())
          ? msg.hostId.toUpperCase()
          : null;
      const code = requestedCode || makeCode();
      if (!rooms[code]) rooms[code] = { host: ws, controller: null };
      else rooms[code].host = ws;
      ws.role = "host";
      ws.room = code;
      ws.send(
        JSON.stringify({
          type: "room-created",
          room: code,
          ip: localIp(),
          port: PORT,
        }),
      );
      if (rooms[code].controller)
        ws.send(JSON.stringify({ type: "player-joined" }));
      return;
    }

    if (msg.type === "join") {
      const room = rooms[msg.room];
      if (!room) {
        ws.send(
          JSON.stringify({ type: "join-error", message: "Room not found" }),
        );
        return;
      }
      if (room.controller) {
        ws.send(
          JSON.stringify({
            type: "join-error",
            message: "Room already has a player",
          }),
        );
        return;
      }
      ws.role = "controller";
      ws.room = msg.room;
      room.controller = ws;
      ws.send(JSON.stringify({ type: "joined", room: msg.room }));
      if (room.host) room.host.send(JSON.stringify({ type: "player-joined" }));
      return;
    }

    if (msg.type === "input" && ws.role === "controller") {
      const room = rooms[ws.room];
      if (room && room.host) {
        room.host.send(
          JSON.stringify({
            type: "input",
            joystick: msg.joystick,
            look: msg.look,
            action: msg.action,
            state: msg.state,
          }),
        );
      }
      return;
    }
  });

  ws.on("close", () => {
    if (ws.role === "host" && ws.room) {
      const room = rooms[ws.room];
      if (room && room.host === ws) room.host = null;
    }
    if (ws.role === "controller" && ws.room && rooms[ws.room]) {
      rooms[ws.room].controller = null;
      if (rooms[ws.room].host)
        rooms[ws.room].host.send(JSON.stringify({ type: "player-left" }));
    }
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  const ip = localIp();
  console.log(`Last Block server running:`);
  console.log(`  Laptop (game):      http://${ip}:${PORT}/`);
  console.log(`  Phone (controller): http://${ip}:${PORT}/controller.html`);
});
