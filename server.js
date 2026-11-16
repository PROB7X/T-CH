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
const FOOD_COUNT = 150;
const players = {};
let foods = [];

const colors = ['#ff5252', '#4caf50', '#448aff', '#ffd740', '#e040fb', '#00e676', '#ff6e40'];

function spawnFood() {
    while (foods.length < FOOD_COUNT) {
        foods.push({
            id: Math.random().toString(36).substr(2, 9),
            x: Math.floor(Math.random() * MAP_SIZE),
            y: Math.floor(Math.random() * MAP_SIZE),
            color: colors[Math.floor(Math.random() * colors.length)],
            value: Math.random() > 0.85 ? 5 : 1 // Редкая крупная еда дает +5 веса
        });
    }
}
spawnFood();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    socket.on('join', (name) => {
        players[socket.id] = {
            id: socket.id,
            name: (name || 'Червяк').slice(0, 15),
            x: Math.floor(Math.random() * (MAP_SIZE - 200)) + 100,
            y: Math.floor(Math.random() * (MAP_SIZE - 200)) + 100,
            color: colors[Math.floor(Math.random() * colors.length)],
            mass: 10,
            tail: []
        };
        socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, foods });
    });

    socket.on('update', (data) => {
        const p = players[socket.id];
        if (!p) return;

        p.x = data.x;
        p.y = data.y;
        p.tail = data.tail;

        // Проверка поедания еды (с учетом радиуса магнита игрока)
        const pickupRadius = 20 + (data.magnetLevel || 0) * 12;
        let ate = false;

        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            const dist = Math.hypot(p.x - f.x, p.y - f.y);
            if (dist < pickupRadius) {
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

    socket.on('spendMass', (amount) => {
        const p = players[socket.id];
        if (p && p.mass - amount >= 10) {
            p.mass -= amount;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// Рассылка состояния всем игрокам 30 раз в секунду
setInterval(() => {
    io.emit('state', players);
}, 1000 / 30);

server.listen(3000, () => {
    console.log('Сервер запущен на порту 3000');
});
