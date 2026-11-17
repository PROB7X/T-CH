const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаем статические файлы из текущей папки
app.use(express.static(__dirname));

// Хранилище комнат (серверов)
// Формат: { "1234": { seed: 987654, players: { socketId: { id, x, y, color } } } }
const rooms = {};

// Генерация 4-значного номера комнаты
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    let currentRoom = null;

    // Создание новой комнаты
    socket.on('createRoom', (callback) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            seed: Math.floor(Math.random() * 1000000),
            players: {}
        };
        joinPlayerToRoom(socket, roomCode, callback);
    });

    // Подключение к существующей комнате
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

        const colors = ['#FF5733', '#33FF57', '#3357FF', '#F333FF', '#FF33A8', '#33FFF5', '#FFC300', '#DAF7A6', '#FF8D1A', '#900C3F'];
        const playerIndex = Object.keys(rooms[roomCode].players).length;

        // Спавним игрока в центре острова (координаты мира от 0 до 4000, центр = 2000)
        rooms[roomCode].players[socket.id] = {
            id: socket.id,
            x: 2000 + (Math.random() * 100 - 50),
            y: 2000 + (Math.random() * 100 - 50),
            color: colors[playerIndex % colors.length]
        };

        // Отправляем игроку данные комнаты и всех игроков
        callback({
            success: true,
            roomCode: roomCode,
            seed: rooms[roomCode].seed,
            players: rooms[roomCode].players,
            myId: socket.id
        });

        // Сообщаем остальным в комнате о новом игроке
        socket.to(roomCode).emit('playerJoined', rooms[roomCode].players[socket.id]);
    }

    // Обновление позиции игрока
    socket.on('move', (data) => {
        if (currentRoom && rooms[currentRoom] && rooms[currentRoom].players[socket.id]) {
            const p = rooms[currentRoom].players[socket.id];
            p.x = data.x;
            p.y = data.y;
            socket.to(currentRoom).emit('playerMoved', p);
        }
    });

    // Отключение игрока
    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom].players[socket.id];
            io.to(currentRoom).emit('playerLeft', socket.id);

            // Удаляем комнату, если никого не осталось
            if (Object.keys(rooms[currentRoom].players).length === 0) {
                delete rooms[currentRoom];
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
