const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const MAP_SIZE = 2000;
const FOOD_COUNT = 220;
const players = {};
let foods = [];

const colors = ['#ff5252', '#4caf50', '#448aff', '#ffd740', '#e040fb', '#00e676', '#ff6e40'];

function spawnFood() {
    while (foods.length < FOOD_COUNT) {
        foods.push({
            id: Math.random().toString(36).substr(2, 9),
            x: Math.floor(Math.random() * (MAP_SIZE - 40)) + 20,
            y: Math.floor(Math.random() * (MAP_SIZE - 40)) + 20,
            color: colors[Math.floor(Math.random() * colors.length)],
            value: Math.random() > 0.85 ? 5 : 1
        });
    }
}
spawnFood();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    // Сразу отправляем еду и игроков при подключении
    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, foods });

    socket.on('join', (name) => {
        players[socket.id] = {
            id: socket.id,
            name: (name || 'Червяк').slice(0, 15),
            x: Math.floor(Math.random() * (MAP_SIZE - 400)) + 200,
            y: Math.floor(Math.random() * (MAP_SIZE - 400)) + 200,
            color: colors[Math.floor(Math.random() * colors.length)],
            mass: 10,
            tail: []
        };
        socket.emit('init', {
            id: socket.id,
            player: players[socket.id],
            mapSize: MAP_SIZE,
            foods
        });
        io.emit('state', players);
    });

    socket.on('update', (data) => {
        // Если игрок ещё не записан в списке, создаём его автоматически
        if (!players[socket.id]) {
            players[socket.id] = {
                id: socket.id,
                name: (data.name || 'Червяк').slice(0, 15),
                x: data.x || 1000,
                y: data.y || 1000,
                color: data.color || '#4caf50',
                mass: 10,
                tail: []
            };
        }

        const p = players[socket.id];
        p.x = data.x;
        p.y = data.y;
        p.tail = Array.isArray(data.tail) ? data.tail : [];

        // Трата веса при ускорении (если вес больше 10)
        if (data.boosting && p.mass > 10) {
            p.boostTick = (p.boostTick || 0) + 1;
            if (p.boostTick >= 15) {
                p.mass -= 1;
                p.boostTick = 0;
            }
        }

        // Поедание еды
        const pickupRadius = Math.min(35, 18 + p.mass * 0.05);
        let ate = false;

        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            if (Math.hypot(p.x - f.x, p.y - f.y) < pickupRadius) {
                p.mass += f.value;
                foods.splice(i, 1);
                ate = true;
            }
        }

        if (ate) {
            spawnFood();
            io.emit('foods', foods);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('state', players);
    });
});

setInterval(() => {
    io.emit('state', players);
}, 1000 / 30);

server.listen(3000, () => {
    console.log('Сервер запущен на порту 3000');
});
