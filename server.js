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

// Типы питомцев и шансы выпадения
const PET_POOL = [
    { type: 'Ящер', rarity: 'Обычный', chance: 60, hp: 100, atk: 15, emoji: '🦎' },
    { type: 'Огненный Дракон', rarity: 'Редкий', chance: 30, hp: 130, atk: 22, emoji: '🐉' },
    { type: 'Теневой Мутант', rarity: 'Мифический', chance: 10, hp: 160, atk: 30, emoji: '👾' }
];

function rollPet() {
    const roll = Math.random() * 100;
    let sum = 0;
    for (const pet of PET_POOL) {
        sum += pet.chance;
        if (roll <= sum) return { ...pet };
    }
    return { ...PET_POOL[0] };
}

io.on('connection', (socket) => {
    let currentUser = null;

    // Вход игрока по нику
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

    // Открытие яйца
    socket.on('openEgg', () => {
        if (!currentUser) return;
        const dropped = rollPet();
        users[currentUser].pet = {
            type: dropped.type,
            rarity: dropped.rarity,
            emoji: dropped.emoji,
            maxHp: dropped.hp,
            atk: dropped.atk,
            level: 1
        };
        users[currentUser].trainingStart = null;
        saveUsers(users);
        socket.emit('userData', users[currentUser]);
    });

    // Старт / Забор AFK-тренировки
    socket.on('toggleTraining', () => {
        if (!currentUser || !users[currentUser].pet) return;
        const user = users[currentUser];

        if (!user.trainingStart) {
            // Ставим на тренировку
            user.trainingStart = Date.now();
        } else {
            // Забираем награду (1 минута = +1 ATK и +3 HP, минимум 5 секунд для теста)
            const seconds = Math.floor((Date.now() - user.trainingStart) / 1000);
            const gain = Math.floor(seconds / 5); // каждые 5 сек = +1 уровень прокачки
            if (gain > 0) {
                user.pet.atk += gain;
                user.pet.maxHp += gain * 3;
                user.pet.level += Math.floor(gain / 5);
            }
            user.trainingStart = null;
        }
        saveUsers(users);
        socket.emit('userData', user);
    });

    // Поиск PvP боя
    socket.on('findBattle', () => {
        if (!currentUser || !users[currentUser].pet) return;
        if (users[currentUser].trainingStart) {
            return socket.emit('msg', 'Сначала забери питомца с тренировки!');
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
                p1: { name: p1.username, socketId: p1.socket.id, pet: { ...users[p1.username].pet }, hp: users[p1.username].pet.maxHp, move: null },
                p2: { name: p2.username, socketId: p2.socket.id, pet: { ...users[p2.username].pet }, hp: users[p2.username].pet.maxHp, move: null }
            };

            io.to(roomId).emit('battleStart', battles[roomId]);
        } else {
            waitingPlayer = { socket, username: currentUser };
            socket.emit('msg', 'Ищем соперника на арене...');
        }
    });

    // Ход в бою (flame, shield, power)
    socket.on('battleMove', ({ roomId, move }) => {
        const b = battles[roomId];
        if (!b) return;

        if (b.p1.socketId === socket.id) b.p1.move = move;
        if (b.p2.socketId === socket.id) b.p2.move = move;

        if (b.p1.move && b.p2.move) {
            let log = `${b.p1.name} (${b.p1.move}) vs ${b.p2.name} (${b.p2.move}). `;

            // Логика: flame бьёт power | power пробивает shield | shield блокирует flame и хилит
            const calcTurn = (attacker, defender) => {
                if (attacker.move === 'flame') {
                    if (defender.move === 'shield') return 0; // заблокировано
                    return attacker.pet.atk;
                }
                if (attacker.move === 'power') {
                    if (defender.move === 'shield') return Math.floor(attacker.pet.atk * 1.5); // крит по щиту!
                    if (defender.move === 'flame') return Math.floor(attacker.pet.atk * 0.5);
                    return attacker.pet.atk;
                }
                if (attacker.move === 'shield') {
                    attacker.hp = Math.min(attacker.pet.maxHp, attacker.hp + Math.floor(attacker.pet.maxHp * 0.1));
                    return 0;
                }
                return 0;
            };

            const dmgToP2 = calcTurn(b.p1, b.p2);
            const dmgToP1 = calcTurn(b.p2, b.p1);

            b.p2.hp = Math.max(0, b.p2.hp - dmgToP2);
            b.p1.hp = Math.max(0, b.p1.hp - dmgToP1);

            log += `Урон: ${b.p1.name} -${dmgToP1} HP, ${b.p2.name} -${dmgToP2} HP.`;

            b.p1.move = null;
            b.p2.move = null;

            if (b.p1.hp <= 0 || b.p2.hp <= 0) {
                const winner = b.p1.hp > b.p2.hp ? b.p1.name : (b.p2.hp > b.p1.hp ? b.p2.name : 'Ничья');
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
