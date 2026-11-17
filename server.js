const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveUsers(users) {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

let users = loadUsers();
let waitingPlayer = null;
let battles = {};

// 6 характеристик для шестигранника: str (Сила), vit (Живучесть), def (Броня), spd (Скорость), int (Интеллект), rage (Ярость)
const PET_POOL = [
    {
        type: 'БРОНЕЯЩЕР', rarity: 'ОБЫЧНЫЙ', chance: 60, svgKey: 'lizard',
        stats: { str: 14, vit: 18, def: 16, spd: 12, int: 10, rage: 12 }
    },
    {
        type: 'ПЕПЕЛЬНЫЙ ДРАКОН', rarity: 'РЕДКИЙ', chance: 30, svgKey: 'dragon',
        stats: { str: 24, vit: 22, def: 18, spd: 20, int: 22, rage: 25 }
    },
    {
        type: 'ТЕНЕВОЙ МУТАНТ', rarity: 'МИФИЧЕСКИЙ', chance: 10, svgKey: 'mutant',
        stats: { str: 32, vit: 28, def: 24, spd: 30, int: 28, rage: 35 }
    }
];

function rollPet() {
    const roll = Math.random() * 100;
    let sum = 0;
    for (const pet of PET_POOL) {
        sum += pet.chance;
        if (roll <= sum) return JSON.parse(JSON.stringify(pet));
    }
    return JSON.parse(JSON.stringify(PET_POOL));
}

function calcMaxHp(stats) {
    return 60 + stats.vit * 5 + stats.def * 2;
}

io.on('connection', (socket) => {
    let currentUser = null;

    socket.on('login', (username) => {
        if (!username) return;
        currentUser = username.trim().slice(0, 16);
        if (!users[currentUser]) {
            users[currentUser] = {
                name: currentUser,
                pet: null,
                trainingStart: null,
                wins: 0
            };
            saveUsers(users);
        }
        socket.emit('userData', users[currentUser]);
    });

    socket.on('openEgg', () => {
        if (!currentUser) return;
        const dropped = rollPet();
        users[currentUser].pet = {
            type: dropped.type,
            rarity: dropped.rarity,
            svgKey: dropped.svgKey,
            stats: dropped.stats,
            maxHp: calcMaxHp(dropped.stats),
            level: 1
        };
        users[currentUser].trainingStart = null;
        saveUsers(users);
        socket.emit('userData', users[currentUser]);
    });

    socket.on('toggleTraining', () => {
        if (!currentUser || !users[currentUser].pet) return;
        const user = users[currentUser];

        if (!user.trainingStart) {
            user.trainingStart = Date.now();
        } else {
            const seconds = Math.floor((Date.now() - user.trainingStart) / 1000);
            const gain = Math.floor(seconds / 5); // каждые 5 сек = +1 очко ко всем 6 граням
            if (gain > 0) {
                const s = user.pet.stats;
                s.str = Math.min(100, s.str + gain);
                s.vit = Math.min(100, s.vit + gain);
                s.def = Math.min(100, s.def + gain);
                s.spd = Math.min(100, s.spd + gain);
                s.int = Math.min(100, s.int + gain);
                s.rage = Math.min(100, s.rage + gain);
                user.pet.maxHp = calcMaxHp(s);
                user.pet.level += Math.floor(gain / 3);
            }
            user.trainingStart = null;
        }
        saveUsers(users);
        socket.emit('userData', user);
    });

    socket.on('findBattle', () => {
        if (!currentUser || !users[currentUser].pet) return;
        if (users[currentUser].trainingStart) {
            return socket.emit('msg', 'ЗАБЕРИТЕ ПИТОМЦА С ТРЕНИРОВКИ ПЕРЕД БОЕМ');
        }

        if (waitingPlayer && waitingPlayer.username !== currentUser && waitingPlayer.socket.connected) {
            const p1 = waitingPlayer;
            const p2 = { socket, username: currentUser };
            waitingPlayer = null;

            const roomId = `battle_${Date.now()}`;
            p1.socket.join(roomId);
            p2.socket.join(roomId);

            battles[roomId] = {
                roomId,
                p1: { name: p1.username, socketId: p1.socket.id, pet: JSON.parse(JSON.stringify(users[p1.username].pet)), hp: users[p1.username].pet.maxHp, move: null },
                p2: { name: p2.username, socketId: p2.socket.id, pet: JSON.parse(JSON.stringify(users[p2.username].pet)), hp: users[p2.username].pet.maxHp, move: null }
            };

            io.to(roomId).emit('battleStart', battles[roomId]);
        } else {
            waitingPlayer = { socket, username: currentUser };
            socket.emit('msg', 'ПОИСК ПРОТИВНИКА НА АРЕНЕ...');
        }
    });

    socket.on('battleMove', ({ roomId, move }) => {
        const b = battles[roomId];
        if (!b) return;

        if (b.p1.socketId === socket.id) b.p1.move = move;
        if (b.p2.socketId === socket.id) b.p2.move = move;

        if (b.p1.move && b.p2.move) {
            const names = { flame: 'ПЛАМЯ', shield: 'ЩИТ', power: 'СИЛА' };
            let log = `${b.p1.name} [${names[b.p1.move]}] vs ${b.p2.name} [${names[b.p2.move]}] — `;

            const calcTurn = (att, def) => {
                const sA = att.pet.stats;
                const sD = def.pet.stats;
                if (att.move === 'flame') {
                    if (def.move === 'shield') return 0;
                    const dmg = Math.floor((sA.int + sA.rage) * 0.8 - sD.def * 0.2);
                    return Math.max(5, dmg);
                }
                if (att.move === 'power') {
                    if (def.move === 'shield') return Math.max(10, Math.floor(sA.str * 1.4));
                    if (def.move === 'flame') return Math.max(4, Math.floor(sA.str * 0.5));
                    return Math.max(5, Math.floor(sA.str - sD.def * 0.3));
                }
                if (att.move === 'shield') {
                    const heal = Math.floor(att.pet.maxHp * 0.1 + sA.vit * 0.3);
                    att.hp = Math.min(att.pet.maxHp, att.hp + heal);
                    return 0;
                }
                return 0;
            };

            const dmgToP2 = calcTurn(b.p1, b.p2);
            const dmgToP1 = calcTurn(b.p2, b.p1);

            b.p2.hp = Math.max(0, b.p2.hp - dmgToP2);
            b.p1.hp = Math.max(0, b.p1.hp - dmgToP1);

            log += `УРОН: ${b.p1.name} (-${dmgToP1}) | ${b.p2.name} (-${dmgToP2})`;

            b.p1.move = null;
            b.p2.move = null;

            if (b.p1.hp <= 0 || b.p2.hp <= 0) {
                const winner = b.p1.hp > b.p2.hp ? b.p1.name : (b.p2.hp > b.p1.hp ? b.p2.name : 'НИЧЬЯ');
                if (users[winner]) {
                    users[winner].wins += 1;
                    saveUsers(users);
                }
                io.to(roomId).emit('battleEnd', { winner, log, battle: b });
                delete battles[roomId];
            } else {
                io.to(roomId).emit('battleUpdate', { log, battle: b });
            }
        }
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.socket.id === socket.id) {
            waitingPlayer = null;
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`InDeathPet сервер запущен на порту ${PORT}`));
