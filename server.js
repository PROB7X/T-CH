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
    { id: 'green', name: 'Классика', type: 'solid', colors: ['#4caf50'], currency: 'coins', price: 0 },
    { id: 'red', name: 'Рубин', type: 'solid', colors: ['#ff5252'], currency: 'coins', price: 30 },
    { id: 'blue', name: 'Океан', type: 'solid', colors: ['#448aff'], currency: 'coins', price: 50 },
    { id: 'gold', name: 'Золото', type: 'solid', colors: ['#ffd740'], currency: 'coins', price: 100 },
    { id: 'sunset', name: 'Закат', type: 'gradient', colors: ['#ff5252', '#ffd740'], currency: 'coins', price: 200 },
    { id: 'neon', name: 'Неон', type: 'gradient', colors: ['#00e676', '#00b0ff'], currency: 'gems', price: 10 },
    { id: 'galaxy', name: 'Космос', type: 'gradient', colors: ['#e040fb', '#448aff', '#00e676'], currency: 'gems', price: 25 }
];

const MAP_SIZE = 2000;
const FOOD_COUNT = 200;
const COIN_COUNT = 25;
const players = {};
let foods = [];
let mapCoins = [];

const foodColors = ['#ff5252', '#4caf50', '#448aff', '#ffd740', '#e040fb', '#00e676', '#ff6e40'];

function spawnItems() {
    while (foods.length < FOOD_COUNT) {
        foods.push({
            x: Math.floor(Math.random() * (MAP_SIZE - 60)) + 30,
            y: Math.floor(Math.random() * (MAP_SIZE - 60)) + 30,
            color: foodColors[Math.floor(Math.random() * foodColors.length)],
            value: Math.random() > 0.85 ? 5 : 1
        });
    }
    while (mapCoins.length < COIN_COUNT) {
        mapCoins.push({
            x: Math.floor(Math.random() * (MAP_SIZE - 80)) + 40,
            y: Math.floor(Math.random() * (MAP_SIZE - 80)) + 40
        });
    }
}
spawnItems();

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/1.mp4', (req, res) => {
    const videoPath = path.join(__dirname, '1.mp4');
    if (fs.existsSync(videoPath)) res.sendFile(videoPath);
    else res.status(404).send('Файл 1.mp4 не найден на сервере');
});

setInterval(() => {
    const list = Object.values(players).sort((a, b) => b.mass - a.mass).slice(0, 3);
    list.forEach(p => {
        if (p.uid && usersDB[p.uid]) {
            usersDB[p.uid].coins += 5;
            io.to(p.id).emit('profile', usersDB[p.uid]);
        }
    });
    if (list.length > 0) saveDB();
}, 15000);
function dropWormFood(p) {
    if (!p || !p.tail) return;
    const dropColor = (p.skin && p.skin.colors && p.skin.colors[0]) ? p.skin.colors[0] : '#4caf50';
    for (let j = 0; j < p.tail.length; j += 3) {
        foods.push({
            x: Math.max(20, Math.min(MAP_SIZE - 20, p.tail[j].x + (Math.random() * 16 - 8))),
            y: Math.max(20, Math.min(MAP_SIZE - 20, p.tail[j].y + (Math.random() * 16 - 8))),
            color: dropColor,
            value: 4
        });
    }
}

io.on('connection', (socket) => {
    socket.on('auth', (data) => {
        let uid = data && data.uid;
        if (uid && usersDB[uid]) {
            socket.uid = uid;
            socket.emit('authSuccess', { uid, profile: usersDB[uid], skins: SKINS });
        } else if (data && data.registerName) {
            uid = 'u_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
            usersDB[uid] = {
                name: data.registerName.trim().slice(0, 15) || 'Игрок',
                coins: 20,
                gems: 5,
                ownedSkins: ['green'],
                equippedSkin: 'green'
            };
            saveDB();
            socket.uid = uid;
            socket.emit('authSuccess', { uid, profile: usersDB[uid], skins: SKINS });
        } else {
            socket.emit('needRegister');
        }
    });

    socket.on('buyOrEquipSkin', (skinId) => {
        const user = usersDB[socket.uid];
        const skin = SKINS.find(s => s.id === skinId);
        if (!user || !skin) return;

        if (user.ownedSkins.includes(skinId)) {
            user.equippedSkin = skinId;
        } else {
            if (skin.currency === 'coins' && user.coins >= skin.price) {
                user.coins -= skin.price;
                user.ownedSkins.push(skinId);
                user.equippedSkin = skinId;
            } else if (skin.currency === 'gems' && user.gems >= skin.price) {
                user.gems -= skin.price;
                user.ownedSkins.push(skinId);
                user.equippedSkin = skinId;
            }
        }
        saveDB();
        socket.emit('profile', user);
    });

    socket.on('exchangeGems', (gemAmount) => {
        const user = usersDB[socket.uid];
        const amount = parseInt(gemAmount) || 1;
        if (user && amount > 0 && user.gems >= amount) {
            user.gems -= amount;
            user.coins += amount * 10;
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

    // Вход в матч или возрождение за рекламу (с щитом на 3 секунды)
    socket.on('join', (opts) => {
        const user = usersDB[socket.uid];
        if (!user) return;
        const skinObj = SKINS.find(s => s.id === user.equippedSkin) || SKINS[0];
        const startMass = (opts && opts.reviveMass) ? Math.max(12, Math.floor(opts.reviveMass * 0.7)) : 12;

        players[socket.id] = {
            id: socket.id,
            uid: socket.uid,
            name: user.name,
            x: Math.floor(Math.random() * (MAP_SIZE - 500)) + 250,
            y: Math.floor(Math.random() * (MAP_SIZE - 500)) + 250,
            skin: skinObj,
            mass: startMass,
            tail: [],
            shieldUntil: Date.now() + 3000 // Щит 3 секунды
        };
        socket.emit('init', {
            id: socket.id,
            player: players[socket.id],
            mapSize: MAP_SIZE,
            foods,
            mapCoins
        });
    });

    socket.on('update', (data) => {
        const p = players[socket.id];
        if (!p) return;

        p.x = data.x;
        p.y = data.y;
        p.tail = Array.isArray(data.tail) ? data.tail : [];
        const headRadius = Math.min(28, 11 + p.mass * 0.05);

        // 1. Проверка столкновения со стенкой (границей карты)
        if (p.x - headRadius <= 2 || p.x + headRadius >= MAP_SIZE - 2 ||
            p.y - headRadius <= 2 || p.y + headRadius >= MAP_SIZE - 2) {
            const oldMass = p.mass;
            dropWormFood(p);
            delete players[socket.id];
            socket.emit('died', { reason: 'границу карты', lastMass: oldMass });
            io.emit('items', { foods, mapCoins });
            return;
        }

        // 2. Трата массы при ускорении (только если масса строго больше 10)
        if (data.boosting && p.mass > 10) {
            p.boostTick = (p.boostTick || 0) + 1;
            if (p.boostTick >= 15) {
                p.mass = Math.max(10, p.mass - 1);
                p.boostTick = 0;
            }
        }

        const pickupRadius = Math.min(35, 18 + p.mass * 0.05);
        let itemsChanged = false;

        // Поедание еды
        for (let i = foods.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - foods[i].x, p.y - foods[i].y) < pickupRadius) {
                p.mass += foods[i].value;
                foods.splice(i, 1);
                itemsChanged = true;
            }
        }

        // Подбор монет
        for (let i = mapCoins.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - mapCoins[i].x, p.y - mapCoins[i].y) < pickupRadius) {
                mapCoins.splice(i, 1);
                itemsChanged = true;
                if (usersDB[p.uid]) {
                    usersDB[p.uid].coins += 1;
                    saveDB();
                    socket.emit('profile', usersDB[p.uid]);
                }
            }
        }

        // 3. Проверка столкновения с другими игроками (если нет щита ни у кого из двоих)
        const now = Date.now();
        const iHaveShield = p.shieldUntil && now < p.shieldUntil;

        if (!iHaveShield) {
            for (let otherId in players) {
                if (otherId === socket.id) continue;
                const other = players[otherId];
                if (!other || !other.tail) continue;

                // Если у соперника щит — мы сквозь него проезжаем и он нас не убивает
                if (other.shieldUntil && now < other.shieldUntil) continue;

                const otherRadius = Math.min(28, 11 + other.mass * 0.05);
                let killed = false;

                for (let i = 0; i < other.tail.length; i += 2) {
                    const seg = other.tail[i];
                    if (Math.hypot(p.x - seg.x, p.y - seg.y) < (headRadius + otherRadius) * 0.75) {
                        killed = true;
                        break;
                    }
                }

                if (killed) {
                    const oldMass = p.mass;
                    dropWormFood(p);
                    if (other.uid && usersDB[other.uid]) {
                        usersDB[other.uid].coins += 15;
                        saveDB();
                        io.to(otherId).emit('profile', usersDB[other.uid]);
                    }
                    delete players[socket.id];
                    socket.emit('died', { reason: `игрока ${other.name}`, lastMass: oldMass });
                    io.emit('items', { foods, mapCoins });
                    return;
                }
            }
        }

        if (itemsChanged) {
            spawnItems();
            io.emit('items', { foods, mapCoins });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

setInterval(() => {
    io.emit('state', players);
}, 1000 / 30);

server.listen(3000, () => console.log('Сервер запущен на порту 3000'));
