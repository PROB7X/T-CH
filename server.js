const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const secret = JSON.parse(fs.readFileSync(path.join(__dirname, 'secret.json'), 'utf8'));
const PORT = secret.port || 3000;
const ADMIN_NICK = secret.adminNick || 'HELM77ZX';
const ADMIN_PASS = secret.adminPass || 'aB9xK2mP7qWz';
const ACC_FILE = path.join(__dirname, 'accounts.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let accounts = {};
if (fs.existsSync(ACC_FILE)) {
  try { accounts = JSON.parse(fs.readFileSync(ACC_FILE, 'utf8')); } catch (e) {}
}
function saveAccounts() {
  const now = Date.now();
  const ttl = 15 * 24 * 60 * 60 * 1000;
  Object.keys(accounts).forEach(k => {
    if (now - (accounts[k].lastSeen || 0) > ttl) delete accounts[k];
  });
  fs.writeFileSync(ACC_FILE, JSON.stringify(accounts, null, 2));
}
saveAccounts();

const globalBans = new Set();
const mutedUntil = new Map();
const frozenPlayers = new Set();
const brotherTitleCd = new Map();
const MAX_TREES = 35;

const rooms = {
  'adm.helm7.play': createRoom('adm.helm7.play', true, false),
  'ob.timeos.op': createRoom('ob.timeos.op', false, true)
};

function createRoom(id, isOpen, adminOnly) {
  const world = {
    id, isOpen, adminOnly,
    weather: 'clear',
    players: {},
    resources: [],
    blocks: [],
    mobs: [],
    luckyBlocks: [],
    banned: new Set()
  };
  for (let i = 0; i < MAX_TREES; i++) spawnResource(world, 'tree');
  for (let i = 0; i < 15; i++) spawnResource(world, 'stone');
  for (let i = 0; i < 10; i++) {
    world.mobs.push({ id: 'mob_' + i, x: 300 + Math.random() * 1400, y: 300 + Math.random() * 1400, hp: 4, vx: 0, vy: 0 });
  }
  return world;
}

function spawnResource(world, type) {
  world.resources.push({
    id: 'res_' + Math.random().toString(36).slice(2, 9),
    type,
    x: 140 + Math.random() * 1720,
    y: 140 + Math.random() * 1720,
    hp: 3
  });
}

setInterval(() => {
  Object.values(rooms).forEach(room => {
    const trees = room.resources.filter(r => r.type === 'tree').length;
    if (trees < MAX_TREES) {
      spawnResource(room, 'tree');
      io.to(room.id).emit('worldSync', { resources: room.resources });
    }
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
}, 2500);

function getRoleStyle(nick) {
  const acc = accounts[nick] || {};
  if (nick === ADMIN_NICK) return { tag: '[OWNER]', color: '#facc15', tagColor: '#f97316', role: 'owner' };
  if (nick === 'StardL' || nick === 'StardL123') return { tag: '[BROTHER]', color: '#cbd5e1', tagColor: '#94a3b8', role: 'brother' };
  if (nick === 'Ксюша') return { tag: '[BA]', color: '#facc15', tagColor: '#eab308', role: acc.op ? 'owner' : 'player' };
  if (acc.op) return { tag: acc.tag || '[OP]', color: '#facc15', tagColor: '#ef4444', role: 'owner' };
  if (acc.tag) return { tag: acc.tag, color: '#38bdf8', tagColor: '#a855f7', role: 'player' };
  return { tag: '', color: '#f8fafc', tagColor: '', role: 'player' };
}

function isNickOnline(nick) {
  const broNicks = ['StardL', 'StardL123'];
  const checkList = broNicks.includes(nick) ? broNicks : [nick];
  return Object.values(rooms).some(r => checkList.some(n => Boolean(r.players[n])));
}

function getRoomsMeta() {
  return Object.values(rooms).map(r => ({ id: r.id, isOpen: r.isOpen, adminOnly: r.adminOnly, count: Object.keys(r.players).length }));
}
function notifyAdmins(room, alertData) {
  Object.values(room.players).forEach(p => {
    if (p.role === 'owner') io.to(p.socketId).emit('adminAlert', alertData);
  });
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentNick = null;

  socket.emit('roomsList', getRoomsMeta());

  socket.on('authCheck', ({ nick, pass }, cb) => {
    const clean = String(nick || '').trim().slice(0, 16);
    if (!clean) return cb({ ok: false, msg: 'Введите ник' });
    if (globalBans.has(clean)) return cb({ ok: false, msg: 'Вы забанены глобально' });
    if (isNickOnline(clean)) return cb({ ok: false, msg: 'Игрок с этим ником уже играет' });

    if (clean === ADMIN_NICK) {
      if (!pass) return cb({ needPass: true });
      if (pass !== ADMIN_PASS) return cb({ ok: false, msg: 'Неверный пароль OWNER' });
    } else if (accounts[clean]?.pass) {
      if (!pass) return cb({ needPass: true });
      if (pass !== accounts[clean].pass) return cb({ ok: false, msg: 'Неверный пароль аккаунта' });
    }

    if (!accounts[clean]) accounts[clean] = {};
    accounts[clean].lastSeen = Date.now();
    saveAccounts();

    const style = getRoleStyle(clean);
    cb({ ok: true, nick: clean, ...style, hasPass: Boolean(accounts[clean].pass) });
  });

  socket.on('setPassword', ({ nick, newPass }, cb) => {
    if (!nick || (nick !== currentNick && !accounts[nick])) return cb?.({ ok: false });
    if (nick === ADMIN_NICK) return cb?.({ ok: false, msg: 'Пароль OWNER меняется в secret.json' });
    if (!accounts[nick]) accounts[nick] = {};
    accounts[nick].pass = String(newPass || '').trim();
    accounts[nick].lastSeen = Date.now();
    saveAccounts();
    cb?.({ ok: true, msg: accounts[nick].pass ? 'Пароль установлен' : 'Пароль удален' });
  });

  socket.on('joinRoom', ({ roomId, nick }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, msg: 'Комната не найдена' });
    if (isNickOnline(nick)) return cb({ ok: false, msg: 'Игрок с таким ником уже на сервере' });
    if (globalBans.has(nick) || room.banned.has(nick)) return cb({ ok: false, msg: 'Вы забанены' });

    const style = getRoleStyle(nick);
    if (!room.isOpen && style.role !== 'owner') return cb({ ok: false, msg: 'Комната закрыта' });
    if (room.adminOnly && style.role !== 'owner') return cb({ ok: false, msg: 'Только для OWNER/OP' });

    currentRoom = room;
    currentNick = nick;
    socket.join(roomId);

    room.players[nick] = {
      nick, socketId: socket.id, ...style,
      x: 1000, y: 1000, hp: 100,
      lastMoveTime: Date.now(), acStrikes: 0,
      frozen: frozenPlayers.has(nick),
      inv: { wood: 5, stone: 5, brick: 0, meat: 2, amulet_tp: 0, amulet_swap: 0 }
    };

    io.emit('roomsList', getRoomsMeta());
    cb({
      ok: true,
      state: { weather: room.weather, players: room.players, resources: room.resources, blocks: room.blocks, mobs: room.mobs, luckyBlocks: room.luckyBlocks }
    });
    socket.to(roomId).emit('playerJoined', room.players[nick]);
  });

  socket.on('move', ({ x, y }) => {
    if (!currentRoom || !currentNick) return;
    const p = currentRoom.players[currentNick];
    if (!p || p.frozen || frozenPlayers.has(currentNick)) return socket.emit('forcePos', { x: p.x, y: p.y });

    const now = Date.now();
    const dt = Math.max(16, now - p.lastMoveTime);
    const dist = Math.hypot(x - p.x, y - p.y);
    const maxSpeed = (currentRoom.weather === 'speed' ? 0.7 : 0.45) * dt + 35;

    if (p.role !== 'owner' && dist > maxSpeed) {
      p.acStrikes++;
      if (p.acStrikes >= 3) {
        p.acStrikes = 0;
        notifyAdmins(currentRoom, { type: 'anticheat', target: currentNick, reason: `Античит: спидхак (${Math.round(dist)}px)` });
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

    if (type === 'attack') {
      const mIdx = currentRoom.mobs.findIndex(m => Math.hypot(m.x - p.x, m.y - p.y) < 65);
      if (mIdx !== -1) {
        currentRoom.mobs[mIdx].hp--;
        if (currentRoom.mobs[mIdx].hp <= 0) {
          currentRoom.mobs.splice(mIdx, 1);
          p.inv.meat += 2;
          socket.emit('invUpdate', p.inv);
        }
        return io.to(currentRoom.id).emit('mobsUpdate', currentRoom.mobs);
      }
      const victim = Object.values(currentRoom.players).find(o => o.nick !== currentNick && Math.hypot(o.x - p.x, o.y - p.y) < 60);
      if (victim && Math.hypot(victim.x - 1000, victim.y - 1000) >= 160 && Math.hypot(p.x - 1000, p.y - 1000) >= 160) {
        victim.hp -= 15;
        if (victim.hp <= 0) { victim.hp = 100; victim.x = 1000; victim.y = 1000; }
        io.to(victim.socketId).emit('hpUpdate', victim.hp);
        io.to(victim.socketId).emit('forcePos', { x: victim.x, y: victim.y });
        io.to(currentRoom.id).emit('playerMoved', { nick: victim.nick, x: victim.x, y: victim.y });
      }
    } else if (type === 'hitResource') {
      const idx = currentRoom.resources.findIndex(r => r.id === targetId);
      if (idx !== -1) {
        currentRoom.resources[idx].hp--;
        if (currentRoom.resources[idx].hp <= 0) {
          const r = currentRoom.resources.splice(idx, 1);
          p.inv[r.type === 'stone' ? 'stone' : 'wood'] += 2;
          io.to(currentRoom.id).emit('worldSync', { resources: currentRoom.resources });
          socket.emit('invUpdate', p.inv);
        }
      }
    } else if (type === 'hitLucky') {
      const idx = currentRoom.luckyBlocks.findIndex(b => b.id === targetId);
      if (idx !== -1) {
        const lb = currentRoom.luckyBlocks.splice(idx, 1);
        if (Math.random() * 100 <= lb.luck) {
          const drop = Math.random() < 0.5 ? 'amulet_tp' : 'amulet_swap';
          p.inv[drop] = (p.inv[drop] || 0) + 1;
          socket.emit('titleMsg', { text: 'УДАЧА! Выпал амулет', color: '#facc15' });
        } else {
          p.hp = Math.max(10, p.hp - 25);
          socket.emit('titleMsg', { text: 'НЕУДАЧА! -25 HP', color: '#ef4444' });
          socket.emit('hpUpdate', p.hp);
        }
        io.to(currentRoom.id).emit('worldSync', { luckyBlocks: currentRoom.luckyBlocks });
        socket.emit('invUpdate', p.inv);
      }
    } else if (type === 'useAmulet') {
      if (item === 'amulet_tp' && p.inv.amulet_tp > 0) {
        p.inv.amulet_tp--; p.x = Math.max(60, Math.min(1940, x)); p.y = Math.max(60, Math.min(1940, y));
        io.to(currentRoom.id).emit('playerMoved', { nick: currentNick, x: p.x, y: p.y });
        socket.emit('forcePos', { x: p.x, y: p.y }); socket.emit('invUpdate', p.inv);
      } else if (item === 'amulet_swap' && p.inv.amulet_swap > 0) {
        const others = Object.values(currentRoom.players).filter(o => o.nick !== currentNick && o.role !== 'owner');
        if (others.length) {
          const t = others[Math.floor(Math.random() * others.length)];
          p.inv.amulet_swap--;
          [p.x, t.x] = [t.x, p.x]; [p.y, t.y] = [t.y, p.y];
          io.to(currentRoom.id).emit('playerMoved', { nick: currentNick, x: p.x, y: p.y });
          io.to(currentRoom.id).emit('playerMoved', { nick: t.nick, x: t.x, y: t.y });
          socket.emit('forcePos', { x: p.x, y: p.y }); io.to(t.socketId).emit('forcePos', { x: t.x, y: t.y });
          socket.emit('invUpdate', p.inv);
        }
      }
    } else if (type === 'build') {
      if (Math.hypot(x - 1000, y - 1000) < 160 || Math.hypot(x - p.x, y - p.y) > 150) return;
      if (p.inv[blockType] > 0) {
        p.inv[blockType]--;
        currentRoom.blocks.push({ id: 'blk_' + Date.now(), type: blockType, x, y });
        io.to(currentRoom.id).emit('worldSync', { blocks: currentRoom.blocks });
        socket.emit('invUpdate', p.inv);
      }
    }
  });

  socket.on('chatMsg', (text) => {
    if (!currentRoom || !currentNick) return;
    if (Date.now() < (mutedUntil.get(currentNick) || 0)) return;
    const clean = String(text || '').trim().slice(0, 32);
    if (!clean) return;
    const p = currentRoom.players[currentNick];
    io.to(currentRoom.id).emit('chatBroadcast', {
      nick: currentNick, tag: p.tag, color: p.color, tagColor: p.tagColor, text: clean
    });
  });

  socket.on('reportPlayer', ({ target, reason }) => {
    if (!currentRoom || !currentNick || target === ADMIN_NICK) return;
    notifyAdmins(currentRoom, { type: 'report', target, reason: `Жалоба от ${currentNick} на ${target}: ${reason}` });
  });

  socket.on('adminCmd', (cmd) => {
    if (!currentRoom || !currentNick) return;
    const actor = currentRoom.players[currentNick];
    if (!actor) return;
    const targetP = cmd.target ? currentRoom.players[cmd.target] : null;

    if (actor.role === 'brother') {
      if (cmd.action === 'mute' && cmd.target && cmd.target !== ADMIN_NICK) {
        const mins = Math.min(20, Math.max(1, Number(cmd.mins) || 5));
        mutedUntil.set(cmd.target, Date.now() + mins * 60000);
      } else if (cmd.action === 'title') {
        if (Date.now() - (brotherTitleCd.get(currentNick) || 0) < 300000) {
          return socket.emit('titleMsg', { text: 'КД на Title: 5 минут!', color: '#ef4444' });
        }
        brotherTitleCd.set(currentNick, Date.now());
        io.to(currentRoom.id).emit('titleMsg', { text: String(cmd.text || '').slice(0, 40), color: '#cbd5e1' });
      }
      return;
    }

    if (actor.role !== 'owner') return;

    if (cmd.action === 'title') {
      const payload = { text: String(cmd.text || '').slice(0, 40), color: '#facc15' };
      if (cmd.target === 'ALL') io.to(currentRoom.id).emit('titleMsg', payload);
      else if (targetP) io.to(targetP.socketId).emit('titleMsg', payload);
    } else if (cmd.action === 'setTag' && cmd.target && cmd.target !== ADMIN_NICK) {
      if (!accounts[cmd.target]) accounts[cmd.target] = {};
      accounts[cmd.target].tag = String(cmd.tag || '').trim().slice(0, 12);
      saveAccounts();
      if (targetP) {
        Object.assign(targetP, getRoleStyle(cmd.target));
        io.to(currentRoom.id).emit('playerRoleSync', { nick: cmd.target, ...getRoleStyle(cmd.target) });
      }
    } else if (cmd.action === 'toggleOp' && cmd.target && cmd.target !== ADMIN_NICK) {
      if (!accounts[cmd.target]) accounts[cmd.target] = {};
      accounts[cmd.target].op = !accounts[cmd.target].op;
      saveAccounts();
      if (targetP) {
        const st = getRoleStyle(cmd.target);
        Object.assign(targetP, st);
        io.to(targetP.socketId).emit('roleChanged', st);
        io.to(currentRoom.id).emit('playerRoleSync', { nick: cmd.target, ...st });
      }
    } else if (cmd.action === 'freeze' && targetP && cmd.target !== ADMIN_NICK) {
      targetP.frozen = !targetP.frozen;
      targetP.frozen ? frozenPlayers.add(cmd.target) : frozenPlayers.delete(cmd.target);
      io.to(targetP.socketId).emit('freezeState', targetP.frozen);
    } else if (cmd.action === 'restrictAll' && cmd.target !== ADMIN_NICK) {
      frozenPlayers.add(cmd.target);
      mutedUntil.set(cmd.target, Date.now() + 9999 * 60000);
      if (targetP) { targetP.frozen = true; io.to(targetP.socketId).emit('freezeState', true); }
    } else if (cmd.action === 'tpTo' && targetP) {
      actor.x = targetP.x + 30; actor.y = targetP.y;
      socket.emit('forcePos', { x: actor.x, y: actor.y });
      io.to(currentRoom.id).emit('playerMoved', { nick: currentNick, x: actor.x, y: actor.y });
    } else if (cmd.action === 'spawnLucky') {
      const count = Math.min(30, Math.max(1, Number(cmd.count) || 5));
      const luck = Math.min(100, Math.max(0, Number(cmd.luck) || 50));
      for (let i = 0; i < count; i++) {
        currentRoom.luckyBlocks.push({ id: 'lb_' + Date.now() + '_' + i, x: 200 + Math.random() * 1600, y: 200 + Math.random() * 1600, luck });
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
      const mins = Math.min(1440, Math.max(1, Number(cmd.mins) || 10));
      mutedUntil.set(cmd.target, Date.now() + mins * 60000);
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
