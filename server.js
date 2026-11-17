const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

    socket.on('createRoom', (callback) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            seed: Math.floor(Math.random() * 1000000),
            players: {}
        };
        joinPlayerToRoom(socket, roomCode, callback);
    });

    socket.on('joinRoom', (roomCode, callback) => {
        if (!rooms[roomCode]) {
            return callback({ error: 'Сервер с таким номером не найден!' });
        }
        if (Object.keys(rooms[roomCode].players).length >= 10) {
            return callback({ error: 'Сервер переполнен (макс. 10 игроков)!' });
        }
        joinPlayerToRoom(socket, roomCode, callback);
    });

    function joinPlayerToRoom(socket, roomCode, callback) {
        currentRoom = roomCode;
        socket.join(roomCode);

        const colors = ['#e74c3c', '#2ecc71', '#3498db', '#9b59b6', '#f1c40f', '#1abc9c', '#e67e22', '#ecf0f1', '#ff7979', '#badc58'];
        const playerIndex = Object.keys(rooms[roomCode].players).length;

        // В 3D центре острова координаты (0, 0, 0), y — высота
        rooms[roomCode].players[socket.id] = {
            id: socket.id,
            x: (Math.random() * 6 - 3),
            y: 0,
            z: (Math.random() * 6 - 3),
            color: colors[playerIndex % colors.length]
        };

        callback({
            success: true,
            roomCode: roomCode,
            seed: rooms[roomCode].seed,
            players: rooms[roomCode].players,
            myId: socket.id
        });

        socket.to(roomCode).emit('playerJoined', rooms[roomCode].players[socket.id]);
    }

    socket.on('move', (data) => {
        if (currentRoom && rooms[currentRoom] && rooms[currentRoom].players[socket.id]) {
            const p = rooms[currentRoom].players[socket.id];
            p.x = data.x;
            p.y = data.y;
            p.z = data.z;
            socket.to(currentRoom).emit('playerMoved', p);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom].players[socket.id];
            io.to(currentRoom).emit('playerLeft', socket.id);
            if (Object.keys(rooms[currentRoom].players).length === 0) {
                delete rooms[currentRoom];
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`3D Сервер запущен на порту ${PORT}`);
});
