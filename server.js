const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const DB_FILE = path.join(__dirname, 'database.json');
let usersDB = {};
if (fs.existsSync(DB_FILE)) {
    try { usersDB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { usersDB = {}; }
}
function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(usersDB, null, 2));
}

const SKINS = [
    { id: 'green', name: 'Классика', colors: ['#4caf50'], currency: 'coins', price: 0 },
    { id: 'red', name: 'Рубин', colors: ['#ff5252'], currency: 'coins', price: 30 },
    { id: 'blue', name: 'Океан', colors: ['#448aff'], currency: 'coins', price: 50 },
    { id: 'gold', name: 'Золото', colors: ['#ffd740'], currency: 'coins', price: 100 },
    { id: 'sunset', name: 'Закат', colors: ['#ff5252', '#ffd740'], currency: 'coins', price: 200 },
    { id: 'neon', name: 'Неон', colors: ['#00e676', '#00b0ff'], currency: 'gems', price: 10 },
    { id: 'galaxy', name: 'Космос', colors: ['#e040fb', '#448aff', '#00e676'], currency: 'gems', price: 25 }
];

const foodColors = ['#ff5252', '#4caf50', '#448aff', '#ffd740', '#e040fb', '#00e676', '#ff6e40'];
const rooms = {};

function createRoom(id, mode, isCustom = false, hostUid = null) {
    const mapSize = mode === 'duel' ? 1200 : 2000;
    const room = {
        id,
        mode, // 'ffa' (общий), 'zone' (сужение зоны), 'duel' (дуэль)
        isCustom,
        hostUid,
        createdAt: Date.now(),
        expiresAt: isCustom ? Date.now() + 3600000 : null, // 1 час для кастомного
        maxPlayers: isCustom ? 20 : (mode === 'duel' ? 2 : 100),
        mapSize,
        zoneRadius: mapSize / 2,
        players: {},
        foods: [],
        coins: []
    };
    spawnRoomItems(room);
    rooms[id] = room;
    return room;
}

function spawnRoomItems(room) {
    const targetFood = room.mode === 'duel' ? 80 : 180;
    const targetCoins = room.mode === 'duel' ? 5 : 20;
    while (room.foods.length < targetFood) {
        room.foods.push({
            x: Math.floor(Math.random() * (room.mapSize - 80)) + 40,
            y: Math.floor(Math.random() * (room.mapSize - 80)) + 40,
            color: foodColors[Math.floor(Math.random() * foodColors.length)],
            value: Math.random() > 0.8 ? 5 : 2
        });
    }
    while (room.coins.length < targetCoins) {
        room.coins.push({
            x: Math.floor(Math.random() * (room.mapSize - 100)) + 50,
            y: Math.floor(Math.random() * (room.mapSize - 100)) + 50
        });
    }
}

// Создаем постоянные комнаты
createRoom('global_ffa', 'ffa');
createRoom('global_zone', 'zone');

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/1.mp4', (req, res) => {
    const v = path.join(__dirname, '1.mp4');
    if (fs.existsSync(v)) res.sendFile(v);
    else res.status(404).send('Not found');
});

function dropFood(room, p) {
    if (!p || !p.tail) return;
    const col = (p.skin && p.skin.colors && p.skin.colors[0]) ? p.skin.colors[0] : '#4caf50';
    for (let i = 0; i < p.tail.length; i += 3) {
        room.foods.push({
            x: Math.max(20, Math.min(room.mapSize - 20, p.tail[i].x + (Math.random() * 20 - 10))),
            y: Math.max(20, Math.min(room.mapSize - 20, p.tail[i].y + (Math.random() * 20 - 10))),
            color: col,
            value: 5
        });
    }
}
io.on('connection', (socket) => {
    socket.on('pingCheck', (ts) => socket.emit('pongCheck', ts));

    socket.on('auth', (data) => {
        let uid = data && data.uid;
        if (uid && usersDB[uid]) {
            socket.uid = uid;
            socket.emit('authSuccess', { uid, profile: usersDB[uid], skins: SKINS });
        } else if (data && data.registerName) {
            uid = 'u_' + Math.random().toString(36).substr(2, 9);
            usersDB[uid] = {
                name: data.registerName.trim().slice(0, 15) || 'Игрок',
                freeRenameUsed: false,
                savedMass: 12,
                coins: 30,
                gems: 5,
                ownedSkins: ['green'],
                equippedSkin: 'green',
                settings: { dynamicJoy: false, pcMode: false }
            };
            saveDB();
            socket.uid = uid;
            socket.emit('authSuccess', { uid, profile: usersDB[uid], skins: SKINS });
        } else {
            socket.emit('needRegister');
        }
    });

    socket.on('changeName', (newName) => {
        const user = usersDB[socket.uid];
        const clean = (newName || '').trim().slice(0, 15);
        if (!user || !clean) return;
        if (!user.freeRenameUsed) {
            user.name = clean;
            user.freeRenameUsed = true;
            saveDB();
            socket.emit('profile', user);
        } else if (user.coins >= 100) {
            user.coins -= 100;
            user.name = clean;
            saveDB();
            socket.emit('profile', user);
        }
    });

    socket.on('saveSettings', (settings) => {
        const user = usersDB[socket.uid];
        if (user && settings) {
            user.settings = { dynamicJoy: !!settings.dynamicJoy, pcMode: !!settings.pcMode };
            saveDB();
            socket.emit('profile', user);
        }
    });

    socket.on('buyOrEquipSkin', (skinId) => {
        const user = usersDB[socket.uid];
        const skin = SKINS.find(s => s.id === skinId);
        if (!user || !skin) return;
        if (user.ownedSkins.includes(skinId)) {
            user.equippedSkin = skinId;
        } else if (skin.currency === 'coins' && user.coins >= skin.price) {
            user.coins -= skin.price;
            user.ownedSkins.push(skinId);
            user.equippedSkin = skinId;
        } else if (skin.currency === 'gems' && user.gems >= skin.price) {
            user.gems -= skin.price;
            user.ownedSkins.push(skinId);
            user.equippedSkin = skinId;
        }
        saveDB();
        socket.emit('profile', user);
    });

    socket.on('exchangeGems', () => {
        const user = usersDB[socket.uid];
        if (user && user.gems >= 1) {
            user.gems -= 1;
            user.coins += 10;
            saveDB();
            socket.emit('profile', user);
        }
    });

    socket.on('adReward', () => {
        const user = usersDB[socket.uid];
        if (user) {
            user.gems += 5;
            saveDB();
            socket.emit('profile', user);
        }
    });

    // Создание кастомного сервера
    socket.on('createCustomRoom', (mode) => {
        const code = Math.random().toString(36).substr(2, 6).toUpperCase();
        const rMode = ['ffa', 'zone', 'duel'].includes(mode) ? mode : 'ffa';
        createRoom(code, rMode, true, socket.uid);
        socket.emit('customRoomCreated', { code, mode: rMode });
    });

    // Приглашение на дуэль
    socket.on('challengeDuel', (targetSocketId) => {
        const user = usersDB[socket.uid];
        if (user && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('duelInvite', { fromId: socket.id, fromName: user.name });
        }
    });

    socket.on('acceptDuel', (fromSocketId) => {
        if (io.sockets.sockets.get(fromSocketId)) {
            const duelId = 'duel_' + Math.random().toString(36).substr(2, 6);
            createRoom(duelId, 'duel', true);
            io.to(fromSocketId).emit('startDuelRoom', duelId);
            socket.emit('startDuelRoom', duelId);
        }
    });

    // Выход в меню с сохранением веса
    socket.on('leaveToMenu', () => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            const p = room.players[socket.id];
            if (usersDB[p.uid]) {
                usersDB[p.uid].savedMass = Math.max(12, p.mass);
                saveDB();
                socket.emit('profile', usersDB[p.uid]);
            }
            delete room.players[socket.id];
            socket.leave(room.id);
            socket.roomId = null;
        }
    });
    socket.on('joinRoom', (data) => {
        const user = usersDB[socket.uid];
        if (!user) return;

        let roomId = data.roomId || 'global_ffa';
        if (data.mode === 'ffa') roomId = 'global_ffa';
        if (data.mode === 'zone') roomId = 'global_zone';

        const room = rooms[roomId];
        if (!room) return socket.emit('roomError', 'Комната не найдена или время истекло');
        if (Object.keys(room.players).length >= room.maxPlayers) return socket.emit('roomError', 'Комната заполнена');

        if (socket.roomId && rooms[socket.roomId]) {
            delete rooms[socket.roomId].players[socket.id];
            socket.leave(socket.roomId);
        }

        socket.roomId = room.id;
        socket.join(room.id);

        const skinObj = SKINS.find(s => s.id === user.equippedSkin) || SKINS[0];
        let startMass = user.savedMass || 12;
        if (data.reviveMass) startMass = Math.max(12, Math.floor(data.reviveMass * 0.7));
        if (room.mode === 'duel') startMass = 15; // В дуэли равный старт

        const spawnRange = room.mode === 'zone' ? room.zoneRadius * 0.6 : (room.mapSize / 2) - 200;
        const cx = room.mapSize / 2;

        room.players[socket.id] = {
            id: socket.id,
            uid: socket.uid,
            name: user.name,
            x: cx + (Math.random() * 2 - 1) * spawnRange,
            y: cx + (Math.random() * 2 - 1) * spawnRange,
            skin: skinObj,
            mass: startMass,
            tail: [],
            shieldUntil: Date.now() + 3000
        };

        socket.emit('init', {
            id: socket.id,
            roomId: room.id,
            mode: room.mode,
            isCustom: room.isCustom,
            player: room.players[socket.id],
            mapSize: room.mapSize,
            zoneRadius: room.zoneRadius,
            foods: room.foods,
            coins: room.coins
        });
    });

    socket.on('update', (data) => {
        const room = rooms[socket.roomId];
        if (!room || !room.players[socket.id]) return;
        const p = room.players[socket.id];

        p.x = data.x;
        p.y = data.y;
        p.tail = Array.isArray(data.tail) ? data.tail : [];
        const headR = Math.min(28, 12 + p.mass * 0.05);

        // Проверка границы карты или сужающейся зоны
        const distFromCenter = Math.hypot(p.x - room.mapSize / 2, p.y - room.mapSize / 2);
        const hitWall = p.x - headR <= 2 || p.x + headR >= room.mapSize - 2 || p.y - headR <= 2 || p.y + headR >= room.mapSize - 2;
        const hitZone = room.mode === 'zone' && distFromCenter + headR > room.zoneRadius;

        if (hitWall || hitZone) {
            const oldMass = p.mass;
            dropFood(room, p);
            if (usersDB[p.uid]) { usersDB[p.uid].savedMass = 12; saveDB(); }
            delete room.players[socket.id];
            socket.emit('died', { reason: hitZone ? 'красную зону' : 'границу карты', lastMass: oldMass, isDuel: room.mode === 'duel' });
            io.to(room.id).emit('items', { foods: room.foods, coins: room.coins });
            return;
        }

        // Трата массы при ускорении (только при весе > 10)
        if (data.boosting && p.mass > 10) {
            p.boostTick = (p.boostTick || 0) + 1;
            if (p.boostTick >= 14) {
                p.mass = Math.max(10, p.mass - 1);
                p.boostTick = 0;
            }
        }

        const pickupR = Math.min(38, 22 + p.mass * 0.05);
        let changed = false;

        for (let i = room.foods.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - room.foods[i].x, p.y - room.foods[i].y) < pickupR) {
                p.mass += room.foods[i].value;
                room.foods.splice(i, 1);
                changed = true;
            }
        }

        for (let i = room.coins.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - room.coins[i].x, p.y - room.coins[i].y) < pickupR) {
                room.coins.splice(i, 1);
                changed = true;
                if (usersDB[p.uid]) {
                    usersDB[p.uid].coins += 1;
                    saveDB();
                    socket.emit('profile', usersDB[p.uid]);
                }
            }
        }

        // Столкновения между игроками (если ни у кого нет щита)
        const now = Date.now();
        if (!p.shieldUntil || now >= p.shieldUntil) {
            for (let oid in room.players) {
                if (oid === socket.id) continue;
                const other = room.players[oid];
                if (!other || !other.tail || (other.shieldUntil && now < other.shieldUntil)) continue;

                const otherR = Math.min(28, 12 + other.mass * 0.05);
                for (let i = 0; i < other.tail.length; i += 2) {
                    if (Math.hypot(p.x - other.tail[i].x, p.y - other.tail[i].y) < (headR + otherR) * 0.75) {
                        const oldMass = p.mass;
                        dropFood(room, p);
                        if (usersDB[p.uid]) { usersDB[p.uid].savedMass = 12; saveDB(); }
                        if (usersDB[other.uid]) {
                            usersDB[other.uid].coins += 15;
                            saveDB();
                            io.to(oid).emit('profile', usersDB[other.uid]);
                        }
                        delete room.players[socket.id];
                        socket.emit('died', { reason: `игрока ${other.name}`, lastMass: oldMass, isDuel: room.mode === 'duel' });
                        io.to(room.id).emit('items', { foods: room.foods, coins: room.coins });
                        return;
                    }
                }
            }
        }

        if (changed) {
            spawnRoomItems(room);
            io.to(room.id).emit('items', { foods: room.foods, coins: room.coins });
        }
    });

    socket.on('disconnect', () => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            const p = room.players[socket.id];
            if (usersDB[p.uid]) {
                usersDB[p.uid].savedMass = Math.max(12, p.mass);
                saveDB();
            }
            delete room.players[socket.id];
        }
    });
});

// Главный цикл комнат (30 раз в секунду) + сужение зоны и статистика онлайна
setInterval(() => {
    const now = Date.now();
    const onlineList = [];

    for (let rid in rooms) {
        const r = rooms[rid];
        if (r.isCustom && now > r.expiresAt) {
            io.to(rid).emit('roomError', 'Время работы приватного сервера (1 час) истекло');
            delete rooms[rid];
            continue;
        }
        if (r.mode === 'zone') {
            if (Object.keys(r.players).length > 0 && r.zoneRadius > 250) {
                r.zoneRadius -= 0.4; // Плавное сужение зоны
            } else if (Object.keys(r.players).length === 0) {
                r.zoneRadius = r.mapSize / 2; // Сброс зоны, когда никого нет
            }
        }
        for (let pid in r.players) {
            onlineList.push({ id: pid, name: r.players[pid].name, mode: r.mode });
        }
        io.to(rid).emit('state', { players: r.players, zoneRadius: r.zoneRadius });
    }

    // Отправляем в меню количество игроков в каждом режиме
    io.emit('lobbyStats', {
        ffa: Object.keys(rooms['global_ffa'].players).length,
        zone: Object.keys(rooms['global_zone'].players).length,
        duel: Object.values(rooms).filter(r => r.mode === 'duel').reduce((s, r) => s + Object.keys(r.players).length, 0),
        custom: Object.values(rooms).filter(r => r.isCustom && r.mode !== 'duel').reduce((s, r) => s + Object.keys(r.players).length, 0),
        onlinePlayers: onlineList
    });
}, 1000 / 30);

server.listen(3000, () => console.log('Сервер запущен на порту 3000'));
