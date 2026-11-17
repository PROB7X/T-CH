const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 }); // Лимит до 5 МБ для рисунков

app.use(express.static(__dirname));

const rooms = {};

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('createRoom', (playerName, callback) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            state: 'lobby',
            players: [],
            round: 0,
            maxRounds: 0,
            chains: [],
            submissions: 0
        };
        joinRoomLogic(socket, roomCode, playerName, callback);
    });

    socket.on('joinRoom', (data, callback) => {
        const { roomCode, playerName } = data;
        const room = rooms[roomCode];
        if (!room) return callback({ error: 'Комната не найдена!' });
        if (room.state !== 'lobby') return callback({ error: 'Игра уже началась!' });
        if (room.players.length >= 10) return callback({ error: 'Комната заполнена (макс. 10)!' });
        joinRoomLogic(socket, roomCode, playerName, callback);
    });

    function joinRoomLogic(socket, roomCode, playerName, callback) {
        currentRoom = roomCode;
        socket.join(roomCode);
        const name = (playerName || 'Игрок').trim().slice(0, 16) || 'Игрок';
        const room = rooms[roomCode];
        room.players.push({ id: socket.id, name });

        callback({ success: true, roomCode, isHost: room.hostId === socket.id, players: room.players });
        io.to(roomCode).emit('updatePlayers', { players: room.players, hostId: room.hostId });
    }

    socket.on('startGame', () => {
        const room = rooms[currentRoom];
        if (!room || room.hostId !== socket.id) return;
        if (room.players.length < 2) return socket.emit('gameError', 'Нужно минимум 2 игрока!');

        room.state = 'playing';
        room.round = 0;
        room.maxRounds = room.players.length;
        room.submissions = 0;
        room.chains = room.players.map(p => ({ ownerName: p.name, steps: [] }));

        room.players.forEach((p) => {
            io.to(p.id).emit('nextRound', {
                round: 1,
                maxRounds: room.maxRounds,
                type: 'write',
                prompt: null
            });
        });
    });

    socket.on('submitStep', (content) => {
        const room = rooms[currentRoom];
        if (!room || room.state !== 'playing') return;

        const pIndex = room.players.findIndex(p => p.id === socket.id);
        if (pIndex === -1) return;

        const chainIndex = (pIndex + room.round) % room.players.length;
        if (room.chains[chainIndex].steps.length > room.round) return; // Уже отправил

        room.chains[chainIndex].steps.push({
            type: room.round % 2 === 0 ? 'text' : 'draw',
            author: room.players[pIndex].name,
            content
        });

        room.submissions++;
        io.to(currentRoom).emit('waitingStatus', { ready: room.submissions, total: room.players.length });

        if (room.submissions >= room.players.length) {
            room.round++;
            room.submissions = 0;

            if (room.round >= room.maxRounds) {
                room.state = 'results';
                io.to(currentRoom).emit('showResults', room.chains);
            } else {
                const nextType = room.round % 2 === 0 ? 'write' : 'draw';
                room.players.forEach((p, idx) => {
                    const targetChainIdx = (idx + room.round) % room.players.length;
                    const prevStep = room.chains[targetChainIdx].steps[room.round - 1];
                    io.to(p.id).emit('nextRound', {
                        round: room.round + 1,
                        maxRounds: room.maxRounds,
                        type: nextType,
                        prompt: prevStep.content
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

    socket.on('disconnect', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        room.players = room.players.filter(p => p.id !== socket.id);

        if (room.players.length === 0) {
            delete rooms[currentRoom];
        } else {
            if (room.hostId === socket.id) room.hostId = room.players.id;
            io.to(currentRoom).emit('updatePlayers', { players: room.players, hostId: room.hostId });
        }
    });
});

server.listen(3000, () => console.log('Gartic 2D Сервер запущен на порту 3000'));
