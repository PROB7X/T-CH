const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

app.use(express.static(__dirname));

const rooms = {};
const AFK_TIMEOUT = 30000; // 30 секунд

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);
    return code;
}

function getDerangement(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * i);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Проверка неактивных игроков каждые 3 секунды
setInterval(() => {
    const now = Date.now();
    for (const code in rooms) {
        const room = rooms[code];
        const afkPlayers = room.players.filter(p => now - p.lastActive > AFK_TIMEOUT);
        afkPlayers.forEach(p => {
            const targetSocket = io.sockets.sockets.get(p.id);
            if (targetSocket) {
                targetSocket.emit('kickedAfk', 'Вы были исключены за бездействие (30 сек)');
                handlePlayerLeave(targetSocket);
            }
        });
    }
}, 3000);

function checkPhaseCompletion(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.state !== 'playing') return;

    const total = room.players.length;
    if (total < 2) {
        room.state = 'lobby';
        io.to(roomCode).emit('gameError', 'Недостаточно игроков для продолжения (минимум 2)');
        io.to(roomCode).emit('backToLobby', { players: room.players, hostId: room.hostId });
        return;
    }

    // Считаем, сколько активных игроков уже сдали текущий этап
    let readyCount = 0;
    room.players.forEach(p => {
        const card = room.cards.find(c => c.assignedTo === p.id);
        if (!card) return;
        if (room.phase === 0 && card.idea) readyCount++;
        else if (room.phase === 1 && card.drawing) readyCount++;
        else if (room.phase === 2 && card.comment) readyCount++;
    });

    io.to(roomCode).emit('waitingStatus', { ready: readyCount, total });

    if (readyCount >= total) {
        room.phase++;
        if (room.phase > 2) {
            room.state = 'results';
            // Показываем только полностью заполненные карточки
            const validCards = room.cards.filter(c => c.idea && c.drawing && c.comment);
            io.to(roomCode).emit('showResults', validCards);
        } else {
            // Оставляем только карточки, заполненные на прошлом этапе
            room.cards = room.cards.filter(c => room.phase === 1 ? c.idea : c.drawing);
            const count = Math.min(room.cards.length, room.players.length);
            const perm = getDerangement(count);

            for (let i = 0; i < count; i++) {
                const targetPlayer = room.players[perm[i]];
                room.cards[i].assignedTo = targetPlayer.id;
                const promptData = room.phase === 1 ? room.cards[i].idea.text : room.cards[i].drawing.img;
                io.to(targetPlayer.id).emit('nextPhase', {
                    phase: room.phase,
                    prompt: promptData
                });
            }
        }
    }
}

function handlePlayerLeave(socket) {
    const currentRoom = socket.data.roomCode;
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];

    socket.leave(currentRoom);
    socket.data.roomCode = null;
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
        delete rooms[currentRoom];
    } else {
        if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
        }
        io.to(currentRoom).emit('updatePlayers', { players: room.players, hostId: room.hostId });
        if (room.state === 'playing') {
            checkPhaseCompletion(currentRoom);
        }
    }
}

io.on('connection', (socket) => {
    socket.on('pingActivity', () => {
        const code = socket.data.roomCode;
        if (code && rooms[code]) {
            const p = rooms[code].players.find(pl => pl.id === socket.id);
            if (p) p.lastActive = Date.now();
        }
    });

    socket.on('createRoom', (data, callback) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            password: (data.password || '').trim(),
            state: 'lobby',
            players: [],
            phase: 0,
            cards: []
        };
        joinRoomLogic(socket, roomCode, data.playerName, callback);
    });

    socket.on('joinRoom', (data, callback) => {
        const { roomCode, playerName, password } = data;
        const room = rooms[roomCode];
        if (!room) return callback({ error: 'Комната с таким кодом не найдена!' });
        if (room.password && room.password !== (password || '').trim()) {
            return callback({ error: 'Неверный пароль от комнаты!' });
        }
        if (room.state !== 'lobby') return callback({ error: 'В этой комнате уже идёт игра!' });
        if (room.players.length >= 10) return callback({ error: 'Комната переполнена (макс. 10)!' });

        joinRoomLogic(socket, roomCode, playerName, callback);
    });

    function joinRoomLogic(socket, roomCode, playerName, callback) {
        socket.data.roomCode = roomCode;
        socket.join(roomCode);
        const name = (playerName || 'Игрок').trim().slice(0, 16) || 'Игрок';
        const room = rooms[roomCode];
        room.players.push({ id: socket.id, name, lastActive: Date.now() });

        callback({
            success: true,
            roomCode,
            isHost: room.hostId === socket.id,
            players: room.players
        });
        io.to(roomCode).emit('updatePlayers', { players: room.players, hostId: room.hostId });
    }

    socket.on('leaveRoom', () => handlePlayerLeave(socket));

    socket.on('startGame', () => {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room || room.hostId !== socket.id) return;
        if (room.players.length < 2) return socket.emit('gameError', 'Для старта нужно минимум 2 игрока!');

        room.state = 'playing';
        room.phase = 0;
        room.cards = room.players.map(() => ({ idea: null, drawing: null, comment: null, assignedTo: null }));

        room.players.forEach((p, idx) => {
            p.lastActive = Date.now();
            room.cards[idx].assignedTo = p.id;
            io.to(p.id).emit('nextPhase', { phase: 0, prompt: null });
        });
    });

    socket.on('submitStep', (content) => {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room || room.state !== 'playing') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        player.lastActive = Date.now();

        const card = room.cards.find(c => c.assignedTo === socket.id);
        if (!card) return;

        if (room.phase === 0 && !card.idea) card.idea = { author: player.name, text: content };
        else if (room.phase === 1 && !card.drawing) card.drawing = { author: player.name, img: content };
        else if (room.phase === 2 && !card.comment) card.comment = { author: player.name, text: content };
        else return;

        checkPhaseCompletion(code);
    });

    socket.on('restartLobby', () => {
        const code = socket.data.roomCode;
        const room = rooms[code];
        if (!room || room.hostId !== socket.id) return;
        room.state = 'lobby';
        room.players.forEach(p => p.lastActive = Date.now());
        io.to(code).emit('backToLobby', { players: room.players, hostId: room.hostId });
    });

    socket.on('disconnect', () => handlePlayerLeave(socket));
});

server.listen(3000, () => console.log('Сервер запущен на порту 3000'));
