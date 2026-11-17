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
let activePlayers = {}; // Игроки в комнате (до 6)
let queue = [];         // Очередь ID сокетов

// Состояние игры
let gameState = {
  money: 50,
  kioskHp: 100,
  maxHp: 100,
  upgrades: {
    speed: 1,
    weapon: 1,
    armor: 1
  },
  tables: [
    { id: 1, x: 250, y: 140, status: 'empty', timer: 0 }, // empty, waiting, eating, dirty
    { id: 2, x: 450, y: 140, status: 'empty', timer: 0 },
    { id: 3, x: 650, y: 140, status: 'empty', timer: 0 }
  ],
  kitchen: { x: 450, y: 460 },
  monsters: []
};

let monsterIdCounter = 1;

function resetGameIfEmpty() {
  if (Object.keys(activePlayers).length === 0) {
    gameState.money = 50;
    gameState.kioskHp = 100;
    gameState.maxHp = 100;
    gameState.upgrades = { speed: 1, weapon: 1, armor: 1 };
    gameState.tables.forEach(t => { t.status = 'empty'; t.timer = 0; });
    gameState.monsters = [];
  }
}

function addPlayerToRoom(socket, name) {
  const colors = ['#38bdf8', '#4ade80', '#facc15', '#f472b6', '#a78bfa', '#fb923c'];
  const usedColors = Object.values(activePlayers).map(p => p.color);
  const color = colors.find(c => !usedColors.includes(c)) || '#ffffff';

  activePlayers[socket.id] = {
    id: socket.id,
    name: name || `Официант_${socket.id.slice(0, 4)}`,
    x: 450 + (Math.random() * 60 - 30),
    y: 300 + (Math.random() * 40 - 20),
    color: color,
    holding: null, // null | 'food'
    tool: 1,       // 1: Фонарик, 2: Швабра, 3: Петарда
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

  // Движение
  socket.on('move', (keys) => {
    const p = activePlayers[socket.id];
    if (!p) return;
    const speed = 4 + (gameState.upgrades.speed - 1) * 1.2;
    if (keys.up) p.y -= speed;
    if (keys.down) p.y += speed;
    if (keys.left) p.x -= speed;
    if (keys.right) p.x += speed;

    p.x = Math.max(40, Math.min(860, p.x));
    p.y = Math.max(40, Math.min(510, p.y));
  });

  // Смена способа отпугивания (1, 2, 3)
  socket.on('selectTool', (toolNum) => {
    const p = activePlayers[socket.id];
    if (p && [1, 2, 3].includes(toolNum)) {
      p.tool = toolNum;
    }
  });

  // Действие: подать еду / убрать / прогнать монстра (Пробел / E)
  socket.on('interact', () => {
    const p = activePlayers[socket.id];
    if (!p) return;

    // 1. Проверка кухни (взять заказ)
    const distKitchen = Math.hypot(p.x - gameState.kitchen.x, p.y - gameState.kitchen.y);
    if (distKitchen < 70 && !p.holding) {
      p.holding = 'food';
      return;
    }

    // 2. Проверка столиков (подать или убрать)
    for (let t of gameState.tables) {
      const distTable = Math.hypot(p.x - t.x, p.y - t.y);
      if (distTable < 75) {
        if (t.status === 'waiting' && p.holding === 'food') {
          p.holding = null;
          t.status = 'eating';
          t.timer = 150; // ~5 секунд едят
          return;
        }
        if (t.status === 'dirty' && !p.holding) {
          t.status = 'empty';
          gameState.money += 25;
          return;
        }
      }
    }

    // 3. Прогнать монстров выбранным способом
    p.actionAnim = 10;
    const power = gameState.upgrades.weapon;

    if (p.tool === 1) {
      // Фонарик: средний радиус, пугает теневых и обычных монстров
      gameState.monsters.forEach(m => {
        if (Math.hypot(p.x - m.x, p.y - m.y) < 130 + power * 15) {
          m.fear += 40 * power;
          m.x += (m.x - p.x) * 0.3;
          m.y += (m.y - p.y) * 0.3;
        }
      });
    } else if (p.tool === 2) {
      // Швабра: ближний бой, сильно отбрасывает и наносит урон
      gameState.monsters.forEach(m => {
        if (Math.hypot(p.x - m.x, p.y - m.y) < 85) {
          m.fear += 65 * power;
          m.x += (m.x - p.x) * 0.8;
          m.y += (m.y - p.y) * 0.8;
        }
      });
    } else if (p.tool === 3 && p.petardCd <= 0) {
      // Петарда: огромный радиус, пугает всех вокруг, но есть откат
      p.petardCd = 150; // 5 секунд перезарядки
      gameState.monsters.forEach(m => {
        if (Math.hypot(p.x - m.x, p.y - m.y) < 220) {
          m.fear += 100;
        }
      });
    }
  });

  // Покупка улучшений
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

// Игровой цикл (30 тиков в секунду)
setInterval(() => {
  const playerCount = Object.keys(activePlayers).length;
  if (playerCount === 0) return;

  // Обновление кулдаунов игроков
  for (let id in activePlayers) {
    let p = activePlayers[id];
    if (p.actionAnim > 0) p.actionAnim--;
    if (p.petardCd > 0) p.petardCd--;
  }

  // Логика столиков (появление клиентов)
  gameState.tables.forEach(t => {
    if (t.status === 'empty' && Math.random() < 0.008) {
      t.status = 'waiting';
    } else if (t.status === 'eating') {
      t.timer--;
      if (t.timer <= 0) {
        t.status = 'dirty';
      }
    }
  });

  // Спавн монстров с окраины (слева или справа)
  if (gameState.monsters.length < 2 + playerCount && Math.random() < 0.012) {
    const fromLeft = Math.random() < 0.5;
    gameState.monsters.push({
      id: monsterIdCounter++,
      x: fromLeft ? 10 : 890,
      y: 100 + Math.random() * 350,
      fear: 0,
      speed: 1.1 + Math.random() * 0.6
    });
  }

  // Движение монстров к ларьку (центр)
  for (let i = gameState.monsters.length - 1; i >= 0; i--) {
    let m = gameState.monsters[i];
    if (m.fear >= 100) {
      // Монстр испугался и убегает
      gameState.monsters.splice(i, 1);
      gameState.money += 10;
      continue;
    }

    const dx = 450 - m.x;
    const dy = 275 - m.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 40) {
      m.x += (dx / dist) * m.speed;
      m.y += (dy / dist) * m.speed;
    } else {
      // Монстр ломает ларёк
      gameState.kioskHp -= 0.15;
    }
  }

  // Если ларёк сломали — перезапуск смены
  if (gameState.kioskHp <= 0) {
    gameState.kioskHp = gameState.maxHp;
    gameState.money = Math.max(0, Math.floor(gameState.money / 2));
    gameState.monsters = [];
  }

  // Отправка состояния всем
  io.emit('state', {
    players: activePlayers,
    queueCount: queue.length,
    game: gameState
  });

  // Обновление номеров в очереди
  queue.forEach((item, index) => {
    io.to(item.id).emit('inQueue', index + 1);
  });

}, 1000 / 30);

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ларёк на окраине запущен: http://103.82.102.226:${PORT}`);
});
