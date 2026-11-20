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
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const roomsState = {
    'adm.helm7.play': { open: true, event: 'clear', players: {}, builds: [] },
    'ob.timeos.op': { open: false, event: 'clear', players: {}, builds: [] }
};

const globalBans = new Set();
const roomBans = { 'adm.helm7.play': new Set(), 'ob.timeos.op': new Set() };
const mutedNicks = new Set();

app.post('/api/login', (req, res) => {
    const { nickname, password } = req.body;
    const nick = (nickname || '').trim();
    if (!nick) return res.status(400).json({ ok: false, error: 'Введите никнейм' });
    if (globalBans.has(nick)) return res.status(403).json({ ok: false, error: 'Вы забанены в этой игре навсегда' });

    if (nick === secret.adminNick) {
        if (password === secret.adminPass) return res.json({ ok: true, isAdmin: true });
        return res.status(403).json({ ok: false, error: 'Неверный пароль администратора' });
    }
    return res.json({ ok: true, isAdmin: false });
});

app.get('/api/rooms', (req, res) => {
    res.json({
        'adm.helm7.play': { open: roomsState['adm.helm7.play'].open, count: Object.keys(roomsState['adm.helm7.play'].players).length },
        'ob.timeos.op': { open: roomsState['ob.timeos.op'].open, count: Object.keys(roomsState['ob.timeos.op'].players).length }
    });
});

io.on('connection', (socket) => {
    let currentRoom = null;
    let currentNick = null;

    socket.on('joinRoom', ({ room, nickname, isAdmin }) => {
        if (!roomsState[room]) return;
        if (globalBans.has(nickname) || roomBans[room].has(nickname)) {
            return socket.emit('kicked', 'Вы забанены на этом сервере');
        }
        if (!roomsState[room].open && !isAdmin) {
            return socket.emit('kicked', 'Сервер закрыт администратором');
        }

        currentRoom = room;
        currentNick = nickname;
        socket.join(room);

        roomsState[room].players[socket.id] = {
            id: socket.id, nickname, isAdmin: !!isAdmin,
            x: 1000, y: 1000, hp: 100, canBuild: !!isAdmin
        };

        socket.emit('roomInit', {
            event: roomsState[room].event,
            builds: roomsState[room].builds,
            players: roomsState[room].players
        });
        io.to(room).emit('playersUpdate', roomsState[room].players);
    });

    socket.on('move', (coords) => {
        if (currentRoom && roomsState[currentRoom]?.players[socket.id]) {
            roomsState[currentRoom].players[socket.id].x = coords.x;
            roomsState[currentRoom].players[socket.id].y = coords.y;
            socket.to(currentRoom).emit('playerMoved', roomsState[currentRoom].players[socket.id]);
        }
    });

    socket.on('buildBlock', (pos) => {
        if (!currentRoom) return;
        const p = roomsState[currentRoom]?.players[socket.id];
        if (p && (p.isAdmin || p.canBuild)) {
            const block = { x: pos.x, y: pos.y };
            roomsState[currentRoom].builds.push(block);
            io.to(currentRoom).emit('blockBuilt', block);
        }
    });

    socket.on('chatMsg', (text) => {
        if (!currentRoom || !currentNick) return;
        if (mutedNicks.has(currentNick)) {
            return socket.emit('systemNotice', 'Вы замьючены и не можете писать в чат');
        }
        const cleanText = String(text || '').trim().slice(0, 32);
        if (!cleanText) return;
        io.to(currentRoom).emit('chatBroadcast', {
            id: Date.now() + Math.random(),
            nick: currentNick,
            text: cleanText,
            isAdmin: roomsState[currentRoom]?.players[socket.id]?.isAdmin || false
        });
    });

    socket.on('adminCmd', (data) => {
        if (!currentRoom) return;
        const sender = roomsState[currentRoom]?.players[socket.id];
        if (!sender || !sender.isAdmin) return;

        const { action, targetNick, value } = data;

        if (action === 'toggleRoom2') {
            roomsState['ob.timeos.op'].open = !roomsState['ob.timeos.op'].open;
            io.emit('roomsStatus', {
                'adm.helm7.play': { open: roomsState['adm.helm7.play'].open, count: Object.keys(roomsState['adm.helm7.play'].players).length },
                'ob.timeos.op': { open: roomsState['ob.timeos.op'].open, count: Object.keys(roomsState['ob.timeos.op'].players).length }
            });
        }

        if (action === 'setEvent') {
            roomsState[currentRoom].event = value;
            io.to(currentRoom).emit('eventChanged', value);
        }

        if (action === 'mute') {
            if (mutedNicks.has(targetNick)) mutedNicks.delete(targetNick);
            else mutedNicks.add(targetNick);
        }

        if (action === 'banRoom' || action === 'banGlobal') {
            if (action === 'banRoom') roomBans[currentRoom].add(targetNick);
            if (action === 'banGlobal') globalBans.add(targetNick);
            const targetSocketId = Object.keys(roomsState[currentRoom].players).find(
                id => roomsState[currentRoom].players[id].nickname === targetNick
            );
            if (targetSocketId) {
                io.to(targetSocketId).emit('kicked', action === 'banGlobal' ? 'Глобальный бан в игре' : 'Бан на этом сервере');
                io.sockets.sockets.get(targetSocketId)?.disconnect(true);
            }
        }

        if (action === 'give') {
            const targetSocketId = Object.keys(roomsState[currentRoom].players).find(
                id => roomsState[currentRoom].players[id].nickname === targetNick
            );
            if (targetSocketId) {
                if (value === 'build') roomsState[currentRoom].players[targetSocketId].canBuild = true;
                io.to(targetSocketId).emit('receiveGift', value);
            }
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && roomsState[currentRoom]) {
            delete roomsState[currentRoom].players[socket.id];
            io.to(currentRoom).emit('playersUpdate', roomsState[currentRoom].players);
        }
    });
});

server.listen(secret.port, '0.0.0.0', () => console.log(`Сервер запущен на порту ${secret.port}`));
