const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const secret = JSON.parse(fs.readFileSync(path.join(__dirname, 'secret.json'), 'utf8'));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Проверка входа и админ-прав
app.post('/api/login', (req, res) => {
    const { nickname, password } = req.body;
    if (!nickname || nickname.trim() === '') {
        return res.status(400).json({ ok: false, error: 'Введите никнейм' });
    }
    if (nickname.trim() === secret.adminNick) {
        if (password === secret.adminPass) {
            return res.json({ ok: true, isAdmin: true });
        } else {
            return res.status(403).json({ ok: false, error: 'Неверный пароль администратора' });
        }
    }
    return res.json({ ok: true, isAdmin: false });
});

// Логика мультиплеера
const players = {};

io.on('connection', (socket) => {
    socket.on('joinServer', (data) => {
        players[socket.id] = {
            id: socket.id,
            nickname: data.nickname,
            isAdmin: data.isAdmin || false,
            x: 100,
            y: 100,
            hp: 100
        };
        io.emit('playersUpdate', players);
    });

    socket.on('move', (coords) => {
        if (players[socket.id]) {
            players[socket.id].x = coords.x;
            players[socket.id].y = coords.y;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Админ-команда: выдать ресурсы или вылечить всех
    socket.on('adminAction', (action) => {
        if (players[socket.id] && players[socket.id].isAdmin) {
            if (action === 'healAll') {
                Object.values(players).forEach(p => p.hp = 100);
                io.emit('playersUpdate', players);
            }
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playersUpdate', players);
    });
});

server.listen(secret.port, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${secret.port}`);
});
