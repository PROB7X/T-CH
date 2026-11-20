const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const secret = JSON.parse(fs.readFileSync(path.join(__dirname, 'secret.json'), 'utf8'));
const PORT = secret.port || 3000;
const ADMIN_NICK = secret.adminNick || 'HELM77ZX';
const ADMIN_PASS = secret.adminPass || 'aB9xK2mP7qWz';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const globalBans = new Set();
const mutedPlayers = new Set();
const frozenPlayers = new Set();

const rooms = {
  'adm.helm7.play': createRoom('adm.helm7.play', true, false),
  'ob.timeos.op': createRoom('ob.timeos.op', false, true)
};

function createRoom(id, isOpen, adminOnly) {
  const world = {
    id, isOpen, adminOnly, weather: 'clear',
    players: {}, resources: [], blocks: [], mobs: [], luckyBlocks: [],
    banned: new Set()
  };
  for (let i = 0; i < 45; i++) {
    world.resources.push({
      id: 'res_' + i + '_' + Math.random().toString(36).slice(2, 6),
      type: i % 3 === 0 ? 'stone' : (i % 5 === 0 ? 'bush' : 'tree'),
      x: 150 + Math.random() * 1700,
      y: 150 + Math.random() * 1700,
      hp: 3
    });
  }
  for (let i = 0; i < 12; i++) {
    world.mobs.push({
      id: 'mob_' + i,
      x: 300 + Math.random() * 1400,
      y: 300 + Math.random() * 1400,
      hp: 3, vx: 0, vy: 0
    });
  }
  return world;
}

setInterval(() => {
  Object.values(rooms).forEach(room => {
    if (!Object.keys(room.players).length) return;
    room.mobs.forEach(m => {
      if (Math.random() < 0.06) {
        const a = Math.random() * Math.PI * 2;
        m.vx = Math.cos(a) * 1.4;
        m.vy = Math.sin(a) * 1.4;
      }
      m.x = Math.max(80, Math.min(1920, m.x + m.vx));
      m.y = Math.max(80, Math.min(1920, m.y + m.vy));
    });
    io.to(room.id).emit('mobsUpdate', room.mobs);
  });
}, 100);

function getRoomsMeta() {
  return Object.values(rooms).map(r => ({
    id: r.id, isOpen: r.isOpen, adminOnly: r.adminOnly,
    count: Object.keys(r.players).length
  }));
}

function notifyAdmins(room, alertData) {
  Object.values(room.players).forEach(p => {
    if (p.isAdmin) io.to(p.socketId).emit('adminAlert', alertData);
  });
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentNick = null;

  socket.emit('roomsList', getRoomsMeta());

  socket.on('authCheck', ({ nick, pass }, cb) => {
    if (globalBans.has(nick)) return cb({ ok: false, msg: 'Вы забанены глобально' });
    if (nick === ADMIN_NICK) {
      if (!pass) return cb({ needPass: true });
      if (pass !== ADMIN_PASS) return cb({ ok: false, msg: 'Неверный пароль' });
      return cb({ ok: true, isAdmin: true });
    }
    cb({ ok: true, isAdmin: false });
  });
  socket.on('joinRoom', ({ roomId, nick, isAdmin }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, msg: 'Комната не найдена' });
    if (globalBans.has(nick) || room.banned.has(nick)) return cb({ ok: false, msg: 'Доступ запрещен (Бан)' });
    if (!room.isOpen && !isAdmin) return cb({ ok: false, msg: 'Комната закрыта' });
    if (room.adminOnly && !isAdmin) return cb({ ok: false, msg: 'Только для OWNER' });

    currentRoom = room;
    currentNick = nick;
    socket.join(roomId);

    room.players[nick] = {
      nick, socketId: socket.id, isAdmin: !!isAdmin,
      x: 1000, y: 1000, hp: 100,
      lastMoveTime: Date.now(), acStrikes: 0,
      frozen: frozenPlayers.has(nick),
      inv: { wood: 0, stone: 0, brick: 0, meat: 0, amulet_tp: 0, amulet_swap: 0 }
    };

    io.emit('roomsList', getRoomsMeta());
    cb({
      ok: true,
      state: {
        weather: room.weather, players: room.players,
        resources: room.resources, blocks: room.blocks,
        mobs: room.mobs, luckyBlocks: room.luckyBlocks
      }
    });
    socket.to(roomId).emit('playerJoined', room.players[nick]);
  });

  socket.on('move', ({ x, y }) => {
    if (!currentRoom || !currentNick) return;
    const p = currentRoom.players[currentNick];
    if (!p || p.frozen || frozenPlayers.has(currentNick)) {
      return socket.emit('forcePos', { x: p ? p.x : 1000, y: p ? p.y : 1000 });
    }
    const now = Date.now();
    const dt = Math.max(16, now - p.lastMoveTime);
    const dist = Math.hypot(x - p.x, y - p.y);
    const maxSpeed = (currentRoom.weather === 'speed' ? 0.75 : 0.48) * dt + 35;

    if (!p.isAdmin && dist > maxSpeed) {
      p.acStrikes++;
      if (p.acStrikes >= 3) {
        p.acStrikes = 0;
        notifyAdmins(currentRoom, {
          type: 'anticheat', target: currentNick,
          reason: `Античит: спидхак (${Math.round(dist)}px)`
        });
      }
      return socket.emit('forcePos', { x: p.x, y: p.y });
    }
    p.acStrikes = Math.max(0, p.acStrikes - 0.2);
    p.lastMoveTime = now;
    p.x = Math.max(40, Math.min(1960, x));
    p.y = Math.max(40, Math.min(1960, y));
    socket.to(currentRoom.id).emit('playerMoved', { nick: currentNick, x: p.x, y: p.y });
  });

  socket.on('action', ({ type, targetId, x, y, blockType, item }) => {
    if (!currentRoom || !currentNick) return;
    const p = currentRoom.players[currentNick];
    if (!p || p.frozen || frozenPlayers.has(currentNick)) return;

    if (type === 'hitResource') {
      const idx = currentRoom.resources.findIndex(r => r.id === targetId);
      if (idx !== -1 && --currentRoom.resources[idx].hp <= 0) {
        const [res] = currentRoom.resources.splice(idx, 1);
        const drop = res.type === 'stone' ? 'stone' : (res.type === 'bush' ? 'meat' : 'wood');
        p.inv[drop] += 2;
        io.to(currentRoom.id).emit('worldSync', { resources: currentRoom.resources });
        socket.emit('invUpdate', p.inv);
      }
    } else if (type === 'hitMob') {
      const idx = currentRoom.mobs.findIndex(m => m.id === targetId);
      if (idx !== -1 && --currentRoom.mobs[idx].hp <= 0) {
        currentRoom.mobs.splice(idx, 1);
        p.inv.meat += 3;
        io.to(currentRoom.id).emit('mobsUpdate', currentRoom.mobs);
        socket.emit('invUpdate', p.inv);
      }
    } else if (type === 'hitLucky') {
      const idx = currentRoom.luckyBlocks.findIndex(b => b.id === targetId);
      if (idx !== -1) {
        const [lb] = currentRoom.luckyBlocks.splice(idx, 1);
        if (Math.random() * 100 <= lb.luck) {
          const drop = Math.random() < 0.5 ? 'amulet_tp' : 'amulet_swap';
          p.inv[drop] = (p.inv[drop] || 0) + 1;
          socket.emit('titleMsg', { text: 'УДАЧА! Выпал амулет', color: '#facc15' });
        } else {
          p.hp = Math.max(10, p.hp - 25);
          socket.emit('titleMsg', { text: 'НЕУДАЧА! Ловушка -25 HP', color: '#ef4444' });
          socket.emit('hpUpdate', p.hp);
        }
        io.to(currentRoom.id).emit('worldSync', { luckyBlocks: currentRoom.luckyBlocks });
        socket.emit('invUpdate', p.inv);
      }
    } else if (type === 'useAmulet') {
      if (item === 'amulet_tp' && p.inv.amulet_tp > 0) {
        p.inv.amulet_tp--;
        p.x = Math.max(60, Math.min(1940, x));
        p.y = Math.max(60, Math.min(1940, y));
        io.to(currentRoom.id).emit('playerMoved', { nick: currentNick, x: p.x, y: p.y });
        socket.emit('forcePos', { x: p.x, y: p.y });
        socket.emit('invUpdate', p.inv);
      } else if (item === 'amulet_swap' && p.inv.amulet_swap > 0) {
        const others = Object.values(currentRoom.players).filter(o => o.nick !== currentNick && !o.isAdmin);
        if (others.length) {
          const t = others[Math.floor(Math.random() * others.length)];
          p.inv.amulet_swap--;
          [p.x, t.x] = [t.x, p.x];
          [p.y, t.y] = [t.y, p.y];
          io.to(currentRoom.id).emit('playerMoved', { nick: currentNick, x: p.x, y: p.y });
          io.to(currentRoom.id).emit('playerMoved', { nick: t.nick, x: t.x, y: t.y });
          socket.emit('forcePos', { x: p.x, y: p.y });
          io.to(t.socketId).emit('forcePos', { x: t.x, y: t.y });
          socket.emit('invUpdate', p.inv);
        }
      }
    } else if (type === 'build') {
      if (Math.hypot(x - 1000, y - 1000) < 160) return;
      if (p.inv[blockType] > 0) {
        p.inv[blockType]--;
        currentRoom.blocks.push({ id: 'blk_' + Date.now(), type: blockType, x, y });
        io.to(currentRoom.id).emit('worldSync', { blocks: currentRoom.blocks });
        socket.emit('invUpdate', p.inv);
      }
    }
  });

  socket.on('chatMsg', (text) => {
    if (!currentRoom || !currentNick || mutedPlayers.has(currentNick)) return;
    const clean = String(text || '').trim().slice(0, 32);
    if (!clean) return;
    const p = currentRoom.players[currentNick];
    io.to(currentRoom.id).emit('chatBroadcast', {
      id: 'm_' + Date.now(), nick: currentNick, isAdmin: p?.isAdmin, text: clean
    });
  });

  socket.on('reportPlayer', ({ target, reason }) => {
    if (!currentRoom || !currentNick || target === ADMIN_NICK) return;
    notifyAdmins(currentRoom, {
      type: 'report', target,
      reason: `Жалоба от ${currentNick} на ${target}: ${reason}`
    });
  });

  socket.on('adminCmd', (cmd) => {
    if (!currentRoom || currentNick !== ADMIN_NICK) return;
    const targetP = cmd.target ? currentRoom.players[cmd.target] : null;

    if (cmd.action === 'title') {
      if (cmd.target === 'ALL') io.to(currentRoom.id).emit('titleMsg', { text: cmd.text, color: '#facc15' });
      else if (targetP) io.to(targetP.socketId).emit('titleMsg', { text: cmd.text, color: '#facc15' });
    } else if (cmd.action === 'freeze' && targetP && cmd.target !== ADMIN_NICK) {
      targetP.frozen = !targetP.frozen;
      targetP.frozen ? frozenPlayers.add(cmd.target) : frozenPlayers.delete(cmd.target);
      io.to(targetP.socketId).emit('freezeState', targetP.frozen);
    } else if (cmd.action === 'restrictAll' && cmd.target !== ADMIN_NICK) {
      frozenPlayers.add(cmd.target);
      mutedPlayers.add(cmd.target);
      if (targetP) { targetP.frozen = true; io.to(targetP.socketId).emit('freezeState', true); }
    } else if (cmd.action === 'tpTo' && targetP) {
      const adm = currentRoom.players[ADMIN_NICK];
      if (adm) {
        adm.x = targetP.x + 30; adm.y = targetP.y;
        socket.emit('forcePos', { x: adm.x, y: adm.y });
        io.to(currentRoom.id).emit('playerMoved', { nick: ADMIN_NICK, x: adm.x, y: adm.y });
      }
    } else if (cmd.action === 'spawnLucky') {
      const count = Math.min(30, Math.max(1, Number(cmd.count) || 5));
      const luck = Math.min(100, Math.max(0, Number(cmd.luck) || 50));
      for (let i = 0; i < count; i++) {
        currentRoom.luckyBlocks.push({
          id: 'lb_' + Date.now() + '_' + i,
          x: 200 + Math.random() * 1600, y: 200 + Math.random() * 1600, luck
        });
      }
      io.to(currentRoom.id).emit('worldSync', { luckyBlocks: currentRoom.luckyBlocks });
    } else if (cmd.action === 'give' && targetP) {
      targetP.inv[cmd.item] = (targetP.inv[cmd.item] || 0) + (Number(cmd.amount) || 1);
      io.to(targetP.socketId).emit('invUpdate', targetP.inv);
    } else if (cmd.action === 'weather') {
      currentRoom.weather = cmd.weather;
      io.to(currentRoom.id).emit('weatherUpdate', cmd.weather);
    } else if (cmd.action === 'toggleRoom') {
      const r = rooms[cmd.roomId || currentRoom.id];
      if (r) { r.isOpen = !r.isOpen; io.emit('roomsList', getRoomsMeta()); }
    } else if (cmd.action === 'mute' && cmd.target !== ADMIN_NICK) {
      mutedPlayers.has(cmd.target) ? mutedPlayers.delete(cmd.target) : mutedPlayers.add(cmd.target);
    } else if (cmd.action === 'banRoom' && cmd.target !== ADMIN_NICK) {
      currentRoom.banned.add(cmd.target);
      if (targetP) io.to(targetP.socketId).emit('kicked', 'Вы забанены в этой комнате');
    } else if (cmd.action === 'banGlobal' && cmd.target !== ADMIN_NICK) {
      globalBans.add(cmd.target);
      if (targetP) io.to(targetP.socketId).emit('kicked', 'Вы получили глобальный бан');
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && currentNick && currentRoom.players[currentNick]) {
      delete currentRoom.players[currentNick];
      io.to(currentRoom.id).emit('playerLeft', currentNick);
      io.emit('roomsList', getRoomsMeta());
    }
  });
});

server.listen(PORT, () => console.log('Survival 2D running on port', PORT));
