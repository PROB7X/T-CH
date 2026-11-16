const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const players = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    players[socket.id] = { x: 250, y: 250, color: '#' + Math.floor(Math.random()*16777215).toString(16) };
    
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
        }
        io.emit('state', players);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('state', players);
    });
});

server.listen(3000, () => {
    console.log('Сервер запущен на порту 3000');
});
