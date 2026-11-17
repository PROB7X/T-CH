const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

const MAX_PLAYERS = 6;
let activePlayers = {};
let queue = [];

// Координаты 3D-мира (X: от -14 до 14, Z: от -12 до 12)
let gameState = {
  money: 50,
  kioskHp: 100,
  maxHp: 100,
  upgrades: { speed: 1, weapon: 1, armor: 1 },
  tables: [
    { id: 1, x: -4.5, z: -2.5, status: 'empty', timer: 0 },
    { id: 2, x: 0,    z: -2.5, status: 'empty', timer: 0 },
    { id: 3, x: 4.5,  z: -2.5, status: 'empty', timer: 0 }
  ],
  kitchen: { x: 0, z: 3.5 },
  entrance: { x: 0, z: -5.5 },
  visitors: [],
  monsters: []
};

let entityIdCounter = 1;

function resetGameIfEmpty() {
  if (Object.keys(activePlayers).length === 0) {
    gameState.money = 50;
    gameState.kioskHp = 100;
    gameState.maxHp = 100;
    gameState.upgrades = { speed: 1, weapon: 1, armor: 1 };
    gameState.tables.forEach(t => { t.status = 'empty'; t.timer = 0; });
    gameState.visitors = [];
    gameState.monsters = [];
  }
}

function addPlayerToRoom(socket, name) {
  const colors = ['#38bdf8', '#4ade80', '#facc15', '#f472b6', '#a78bfa', '#fb923c'];
  const usedColors = Object.values(activePlayers).map(p => p.color);
  const color = colors.find(c => !usedColors.includes(c)) || '#ffffff';

  activePlayers[socket.id] = {
    id: socket.id,
    name: name || `Официант_${socket.id.slice(0, 3)}`,
    x: (Math.random() - 0.5) * 3,
    z: 0.5 + Math.random() * 1.5,
    rotY: 0,
    color: color,
    holding: null,
    tool: 1,
    actionAnim: 0,
    petardCd: 0
  };
}

function processQueue() {
  while (Object.keys(activePlayers).length < MAX_PLAYERS && queue.length > 0) {
    const nextItem = queue.shift();
    const nextSocket = io.sockets.sockets.get(nextItem.id);
    if (nextSocket) {
      addPlayerToRoom(nextSocket, nextItem.name);
      nextSocket.emit('joinedRoom');
    }
  }
}

io.on('connection', (socket) => {
  socket.on('joinGame', (nickname) => {
    const cleanName = (nickname || '').trim().slice(0, 14) || `Стажёр_${socket.id.slice(0, 3)}`;
    if (Object.keys(activePlayers).length < MAX_PLAYERS) {
      addPlayerToRoom(socket, cleanName);
      socket.emit('joinedRoom');
    } else {
      queue.push({ id: socket.id, name: cleanName });
      socket.emit('inQueue', queue.length);
    }
  });

  socket.on('move', (keys) => {
    const p = activePlayers[socket.id];
    if (!p) return;
    const speed = 0.14 + (gameState.upgrades.speed - 1) * 0.035;
    let dx = 0, dz = 0;
    if (keys.up) dz -= speed;
    if (keys.down) dz += speed;
    if (keys.left) dx -= speed;
    if (keys.right) dx += speed;

    if (dx !== 0 || dz !== 0) {
      p.x += dx;
      p.z += dz;
      p.rotY = Math.atan2(dx, dz);
    }

    p.x = Math.max(-13, Math.min(13, p.x));
    p.z = Math.max(-12, Math.min(8, p.z));
  });

  socket.on('selectTool', (toolNum) => {
    const p = activePlayers[socket.id];
    if (p && (toolNum === 1 || toolNum === 2 || toolNum === 3)) {
      p.tool = toolNum;
    }
  });

  socket.on('interact', () => {
    const p = activePlayers[socket.id];
    if (!p) return;

    // 1. Взять еду на кухне
    if (Math.hypot(p.x - gameState.kitchen.x, p.z - gameState.kitchen.z) < 2.3 && !p.holding) {
      p.holding = 'food';
      return;
    }

    // 2. Подать еду или убрать столик
    for (let t of gameState.tables) {
      if (Math.hypot(p.x - t.x, p.z - t.z) < 2.3) {
        if (t.status === 'waiting' && p.holding === 'food') {
          p.holding = null;
          t.status = 'eating';
          t.timer = 210;
          return;
        }
        if (t.status === 'dirty' && !p.holding) {
          t.status = 'empty';
          gameState.money += 30;
          return;
        }
      }
    }

    // 3. Отпугивание монстров
    p.actionAnim = 10;
    const power = gameState.upgrades.weapon;

    if (p.tool === 1) {
      gameState.monsters.forEach(m => {
        if (Math.hypot(p.x - m.x, p.z - m.z) < 4.2 + power * 0.5) {
          m.fear += 40 * power;
          m.x += (m.x - p.x) * 0.25;
          m.z += (m.z - p.z) * 0.25;
        }
      });
    } else if (p.tool === 2) {
      gameState.monsters.forEach(m => {
        if (Math.hypot(p.x - m.x, p.z - m.z) < 2.8) {
          m.fear += 65 * power;
          m.x += (m.x - p.x) * 0.65;
          m.z += (m.z - p.z) * 0.65;
        }
      });
    } else if (p.tool === 3 && p.petardCd <= 0) {
      p.petardCd = 150;
      gameState.monsters.forEach(m => {
        if (Math.hypot(p.x - m.x, p.z - m.z) < 7.0) {
          m.fear += 100;
        }
      });
    }
  });

  socket.on('buyUpgrade', (type) => {
    if (!activePlayers[socket.id]) return;
    const costs = {
      speed: gameState.upgrades.speed * 60,
      weapon: gameState.upgrades.weapon * 75,
      armor: gameState.upgrades.armor * 50,
      repair: 30
    };

    if (type === 'repair' && gameState.money >= costs.repair && gameState.kioskHp < gameState.maxHp) {
      gameState.money -= costs.repair;
      gameState.kioskHp = Math.min(gameState.maxHp, gameState.kioskHp + 35);
    } else if (costs[type] && gameState.money >= costs[type] && gameState.upgrades[type] < 5) {
      gameState.money -= costs[type];
      gameState.upgrades[type]++;
      if (type === 'armor') {
        gameState.maxHp += 40;
        gameState.kioskHp += 40;
      }
    }
  });

  socket.on('disconnect', () => {
    delete activePlayers[socket.id];
    queue = queue.filter(item => item.id !== socket.id);
    processQueue();
    resetGameIfEmpty();
  });
});

// Главный игровой цикл (30 тиков/сек)
setInterval(() => {
  const playerCount = Object.keys(activePlayers).length;
  if (playerCount === 0) return;

  for (let id in activePlayers) {
    let p = activePlayers[id];
    if (p.actionAnim > 0) p.actionAnim--;
    if (p.petardCd > 0) p.petardCd--;
  }

  // Таймер еды за столиками
  gameState.tables.forEach(t => {
    if (t.status === 'eating') {
      t.timer--;
      if (t.timer <= 0) t.status = 'dirty';
    }
  });

  // Спавн обычных посетителей далеко на дороге (Z = -22)
  const emptyTables = gameState.tables.filter(t => t.status === 'empty');
  if (emptyTables.length > gameState.visitors.length && Math.random() = 0; i--) {
    let v = gameState.visitors[i];
    const dx = gameState.entrance.x - v.x;
    const dz = gameState.entrance.z - v.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.6) {
      v.x += (dx / dist) * v.speed;
      v.z += (dz / dist) * v.speed;
    } else {
      const freeTable = gameState.tables.find(t => t.status === 'empty');
      if (freeTable) {
        freeTable.status = 'waiting';
      }
      gameState.visitors.splice(i, 1);
    }
  }

  // Спавн монстров далеко в лесу
  if (gameState.monsters.length = 0; i--) {
    let m = gameState.monsters[i];
    if (m.fear >= 100) {
      gameState.monsters.splice(i, 1);
      gameState.money += 15;
      continue;
    }

    const dx = 0 - m.x;
    const dz = 0 - m.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 1.8) {
      m.x += (dx / dist) * m.speed;
      m.z += (dz / dist) * m.speed;
    } else {
      gameState.kioskHp -= 0.15;
    }
  }

  if (gameState.kioskHp <= 0) {
    gameState.kioskHp = gameState.maxHp;
    gameState.money = Math.max(0, Math.floor(gameState.money / 2));
    gameState.monsters = [];
  }

  io.emit('state', {
    players: activePlayers,
    queueCount: queue.length,
    game: gameState
  });

  queue.forEach((item, index) => {
    io.to(item.id).emit('inQueue', index + 1);
  });

}, 1000 / 30);

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`3D Ларёк на окраине запущен на порту ${PORT}`);
});
