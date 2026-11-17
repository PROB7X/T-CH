const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

app.use(express.static(__dirname));

const rooms = {};

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);
    return code;
}

// Перемешивание без неподвижных точек (никто не получит свой индекс)
function getDerangement(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * i); // строго меньше i, гарантирует сдвиг
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('createRoom', (data, callback) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            password: (data.password || '').trim(),
            state: 'lobby',
            players: [],
            phase: 0, // 0: идея, 1: рисунок, 2: описание
            cards: [],
            submissions: 0
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
        currentRoom = roomCode;
        socket.join(roomCode);
        const name = (playerName || 'Игрок').trim().slice(0, 16) || 'Игрок';
        const room = rooms[roomCode];
        room.players.push({ id: socket.id, name });

        callback({
            success: true,
            roomCode,
            hasPassword: Boolean(room.password),
            isHost: room.hostId === socket.id,
            players: room.players
        });
        io.to(roomCode).emit('updatePlayers', { players: room.players, hostId: room.hostId });
    }

    socket.on('leaveRoom', () => {
        handlePlayerLeave(socket);
    });

    socket.on('startGame', () => {
        const room = rooms[currentRoom];
        if (!room || room.hostId !== socket.id) return;
        if (room.players.length < 2) return socket.emit('gameError', 'Для старта нужно минимум 2 игрока!');

        room.state = 'playing';
        room.phase = 0;
        room.submissions = 0;
        // Создаём пустую карточку на каждого игрока
        room.cards = room.players.map(() => ({
            idea: null,
            drawing: null,
            comment: null,
            assignedTo: null
        }));

        room.players.forEach((p, idx) => {
            room.cards[idx].assignedTo = p.id;
            io.to(p.id).emit('nextPhase', {
                phase: 0,
                prompt: null
            });
        });
    });

    socket.on('submitStep', (content) => {
        const room = rooms[currentRoom];
        if (!room || room.state !== 'playing') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const card = room.cards.find(c => c.assignedTo === socket.id);
        if (!card) return;

        if (room.phase === 0 && !card.idea) {
            card.idea = { author: player.name, text: content };
        } else if (room.phase === 1 && !card.drawing) {
            card.drawing = { author: player.name, img: content };
        } else if (room.phase === 2 && !card.comment) {
            card.comment = { author: player.name, text: content };
        } else {
            return; // Уже отправил в этом этапе
        }

        room.submissions++;
        io.to(currentRoom).emit('waitingStatus', { ready: room.submissions, total: room.players.length });

        if (room.submissions >= room.players.length) {
            room.phase++;
            room.submissions = 0;

            if (room.phase > 2) {
                room.state = 'results';
                io.to(currentRoom).emit('showResults', room.cards);
            } else {
                // Распределяем карточки случайным образом так, чтобы никто не получил свою предыдущую
                const n = room.players.length;
                const perm = getDerangement(n);
                const prevAssignees = room.cards.map(c => c.assignedTo);

                room.cards.forEach((c, idx) => {
                    // Находим нового игрока по перестановке
                    const targetPlayer = room.players[perm[idx]];
                    c.assignedTo = targetPlayer.id;

                    const promptData = room.phase === 1 ? c.idea.text : c.drawing.img;
                    io.to(targetPlayer.id).emit('nextPhase', {
                        phase: room.phase,
                        prompt: promptData
                    });
                });
            }
        }
    });

    socket.on('restartLobby', () => {
        const room = rooms[currentRoom];
        if (!room || room.hostId !== socket.id) return;
        room.state = 'lobby';
        io.to(currentRoom).emit('backToLobby', { players: room.players, hostId: room.hostId });
    });

    function handlePlayerLeave(socket) {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        socket.leave(currentRoom);
        room.players = room.players.filter(p => p.id !== socket.id);

        if (room.players.length === 0) {
            delete rooms[currentRoom];
        } else {
            if (room.hostId === socket.id) {
                room.hostId = room.players.id;
            }
            io.to(currentRoom).emit('updatePlayers', { players: room.players, hostId: room.hostId });
        }
        currentRoom = null;
    }

    socket.on('disconnect', () => handlePlayerLeave(socket));
});

server.listen(3000, () => console.log('Сервер запущен на порту 3000'));
