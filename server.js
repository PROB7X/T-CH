const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const DB_FILE = path.join(__dirname, 'database.json');
let db = { users: {} };

if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = { users: {} }; }
}
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function parseCookies(str = '') {
  return str.split(';').reduce((acc, part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) acc[k] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

app.use(express.json());
app.get('/1.mp4', (req, res) => {
  const videoPath = path.join(__dirname, '1.mp4');
  if (fs.existsSync(videoPath)) return res.sendFile(videoPath);
  res.status(404).send('Video not found');
});
app.use(express.static(__dirname));

const rooms = {};
function getOrCreateRoom(roomId = 'main', customCfg = {}) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      players: {},
      foods: [],
      coins: [],
      radius: customCfg.radius || 2400,
      minRadius: 500,
      shrinkRate: customCfg.shrinkRate || 0.35
    };
    spawnEntities(rooms[roomId]);
  }
  return rooms[roomId];
}

function spawnEntities(room) {
  const colors = ['#ff4757', '#2ed573', '#1e90ff', '#ffa502', '#eccc68', '#ff6b81', '#7bed9f'];
  while (room.foods.length < 280) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * (room.radius - 60);
    room.foods.push({
      id: Math.random().toString(36).slice(2),
      x: Math.cos(ang) * dist,
      y: Math.sin(ang) * dist,
      r: 8 + Math.random() * 5,
      val: 2,
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }
  while (room.coins.length < 45) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * (room.radius - 80);
    room.coins.push({
      id: Math.random().toString(36).slice(2),
      x: Math.cos(ang) * dist,
      y: Math.sin(ang) * dist,
      r: 12
    });
  }
}

io.on('connection', (socket) => {
  const cookies = parseCookies(socket.handshake.headers.cookie || '');
  let currentUid = cookies.worm_uid || cookies.m || null;

  socket.on('initAuth', (clientUid) => {
    const uid = clientUid || currentUid;
    if (uid && db.users[uid]) {
      currentUid = uid;
      socket.emit('authSuccess', db.users[uid]);
    } else {
      socket.emit('needRegister');
    }
  });

  socket.on('registerProfile', ({ uid, nick, skin }) => {
    const id = uid || ('u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    db.users[id] = {
      uid: id,
      nick: (nick || 'Игрок').trim().slice(0, 16),
      skin: skin || 'emerald',
      coins: 100,
      crystals: 5,
      bestScore: 0
    };
    currentUid = id;
    saveDB();
    socket.emit('authSuccess', db.users[id]);
  });

  socket.on('saveProfile', ({ uid, nick, skin }) => {
    const id = uid || currentUid;
    if (!id || !db.users[id]) return;
    if (nick) db.users[id].nick = nick.trim().slice(0, 16);
    if (skin) db.users[id].skin = skin;
    saveDB();
    socket.emit('profileSaved', db.users[id]);
  });
  socket.on('joinRoom', ({ roomId = 'main', uid, nick, skin, customCfg } = {}) => {
    const id = uid || currentUid;
    const user = (id && db.users[id]) ? db.users[id] : {
      uid: id || socket.id,
      nick: (nick || 'Игрок').slice(0, 16),
      skin: skin || 'emerald',
      coins: 0,
      crystals: 0
    };
    if (nick) user.nick = nick.slice(0, 16);
    if (skin) user.skin = skin;

    const room = getOrCreateRoom(roomId, customCfg);
    socket.join(room.id);
    socket.roomId = room.id;

    const spawnAng = Math.random() * Math.PI * 2;
    const spawnDist = Math.random() * (room.radius * 0.45);
    const sx = Math.cos(spawnAng) * spawnDist;
    const sy = Math.sin(spawnAng) * spawnDist;

    const segments = [];
    for (let i = 0; i < 14; i++) segments.push({ x: sx - i * 6, y: sy });

    room.players[socket.id] = {
      id: socket.id,
      uid: user.uid,
      nick: user.nick,
      skin: user.skin,
      x: sx,
      y: sy,
      angle: 0,
      targetAngle: 0,
      boost: false,
      score: 20,
      segments,
      shieldUntil: Date.now() + 3000
    };

    socket.emit('joinedRoom', {
      roomId: room.id,
      playerId: socket.id,
      radius: room.radius,
      shieldUntil: room.players[socket.id].shieldUntil
    });
  });

  socket.on('input', ({ angle, boost }) => {
    const room = rooms[socket.roomId];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].targetAngle = angle;
    room.players[socket.id].boost = !!boost;
  });

  socket.on('rewardVideo', ({ type, uid }) => {
    const id = uid || currentUid;
    if (id && db.users[id] && type === 'crystals') {
      db.users[id].crystals = (db.users[id].crystals || 0) + 3;
      saveDB();
      socket.emit('profileSaved', db.users[id]);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.id]) delete room.players[socket.id];
  });
});

setInterval(() => {
  const now = Date.now();
  Object.values(rooms).forEach((room) => {
    const playerList = Object.values(room.players);
    if (playerList.length === 0) return;

    if (room.radius > room.minRadius) {
      room.radius = Math.max(room.minRadius, room.radius - room.shrinkRate);
    }
    spawnEntities(room);

    playerList.forEach((p) => {
      const speed = p.boost && p.score > 25 ? 6.2 : 3.6;
      if (p.boost && p.score > 25) p.score -= 0.08;
      p.angle = p.targetAngle;
      p.x += Math.cos(p.angle) * speed;
      p.y += Math.sin(p.angle) * speed;

      p.segments.unshift({ x: p.x, y: p.y });
      const targetLen = Math.min(220, Math.floor(12 + p.score / 3));
      while (p.segments.length > targetLen) p.segments.pop();

      const distFromCenter = Math.hypot(p.x, p.y);
      if (distFromCenter > room.radius && now > p.shieldUntil) {
        io.to(p.id).emit('playerDied', { reason: 'zone', score: Math.floor(p.score) });
        delete room.players[p.id];
        return;
      }

      room.foods = room.foods.filter((f) => {
        if (Math.hypot(p.x - f.x, p.y - f.y) < 22 + f.r) {
          p.score += f.val;
          return false;
        }
        return true;
      });

      room.coins = room.coins.filter((c) => {
        if (Math.hypot(p.x - c.x, p.y - c.y) < 26) {
          if (p.uid && db.users[p.uid]) {
            db.users[p.uid].coins = (db.users[p.uid].coins || 0) + 1;
          }
          return false;
        }
        return true;
      });
    });

    const alive = Object.values(room.players);
    const leaderboard = alive
      .map((p) => ({ id: p.id, nick: p.nick, score: Math.floor(p.score) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    io.to(room.id).emit('state', {
      radius: room.radius,
      players: alive,
      foods: room.foods,
      coins: room.coins,
      leaderboard
    });
  });
}, 1000 / 30);

server.listen(3000, () => console.log('Worms server running on port 3000'));
