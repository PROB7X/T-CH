const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3001;
const USERS_FILE = path.join(__dirname, 'users.json');

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function getUsersConfig() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Ошибка чтения users.json:', err);
    return { admins: [], protected: {}, tags: {}, banned: [] };
  }
}

function saveUsersConfig(config) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(config, null, 2), 'utf8');
}

const defaultColors = ['#ff75e6', '#00f593', '#bf94ff', '#ffb31a', '#1e90ff', '#ff6347'];
function getRandomColor(nick) {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) {
    hash = nick.charCodeAt(i) + ((hash << 5) - hash);
  }
  return defaultColors[Math.abs(hash) % defaultColors.length];
}

let onlineUsers = new Map();
let messageHistory = [];

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('login', (data) => {
    const rawNick = typeof data === 'object' ? data.nick : data;
    const password = typeof data === 'object' ? String(data.password || '') : '';
    const cleanNick = String(rawNick || '').trim().slice(0, 20);

    if (!cleanNick) {
      socket.emit('login_error', 'Введите корректный никнейм.');
      return;
    }

    const config = getUsersConfig();
    const lowerNick = cleanNick.toLowerCase();

    // Проверка на бан (без учета регистра)
    if (config.banned.some(b => b.toLowerCase() === lowerNick)) {
      socket.emit('login_error', 'Этот никнейм заблокирован администратором.');
      return;
    }

    // Проверка, не занят ли ник прямо сейчас в онлайне
    for (let u of onlineUsers.values()) {
      if (u.nick.toLowerCase() === lowerNick) {
        socket.emit('login_error', 'Пользователь с таким ником уже в чате.');
        return;
      }
    }

    // Проверка защищенного ника (PROB7X и др.)
    const protectedEntries = Object.entries(config.protected || {});
    const foundProtected = protectedEntries.find(([pNick]) => pNick.toLowerCase() === lowerNick);

    if (foundProtected) {
      const [exactNick, requiredPass] = foundProtected;
      if (!password) {
        socket.emit('need_password', `Ник ${exactNick} защищён. Введите секретный код:`);
        return;
      }
      if (password !== requiredPass) {
        socket.emit('login_error', 'Неверный секретный код для этого ника!');
        return;
      }
    }

    const finalNick = foundProtected ? foundProtected : cleanNick;
    const isAdmin = (config.admins || []).some(a => a.toLowerCase() === lowerNick);
    const userTag = config.tags[finalNick] || null;

    currentUser = {
      nick: finalNick,
      isAdmin: isAdmin,
      badge: userTag ? userTag.badge : null,
      badgeColor: userTag ? userTag.badgeColor : null,
      nickColor: userTag ? userTag.nickColor : getRandomColor(finalNick)
    };

    onlineUsers.set(socket.id, currentUser);

    socket.emit('login_success', {
      user: currentUser,
      history: messageHistory
    });

    io.emit('online_count', onlineUsers.size);
    io.emit('system_message', `${finalNick} присоединился к чату`);
  });

  socket.on('chat_message', (text) => {
    if (!currentUser) return;
    const cleanText = String(text || '').trim().slice(0, 500);
    if (!cleanText) return;

    const config = getUsersConfig();
    if (config.banned.some(b => b.toLowerCase() === currentUser.nick.toLowerCase())) {
      socket.emit('kicked', 'Вы были заблокированы.');
      socket.disconnect();
      return;
    }

    // Админ-команды
    if (currentUser.isAdmin && cleanText.startsWith('/')) {
      const parts = cleanText.split(' ');
      const cmd = parts.toLowerCase();
      const target = parts;

      if (cmd === '/clear') {
        messageHistory = [];
        io.emit('clear_chat');
        io.emit('system_message', `Администратор ${currentUser.nick} очистил чат.`);
        return;
      }

      if (cmd === '/ban' && target) {
        if (!config.banned.some(b => b.toLowerCase() === target.toLowerCase())) {
          config.banned.push(target);
          saveUsersConfig(config);
        }
        for (let [id, u] of onlineUsers.entries()) {
          if (u.nick.toLowerCase() === target.toLowerCase()) {
            io.to(id).emit('kicked', 'Вы были заблокированы администратором.');
            io.sockets.sockets.get(id)?.disconnect();
          }
        }
        io.emit('system_message', `Пользователь ${target} забанен.`);
        return;
      }

      if (cmd === '/unban' && target) {
        config.banned = config.banned.filter(u => u.toLowerCase() !== target.toLowerCase());
        saveUsersConfig(config);
        socket.emit('system_message', `Пользователь ${target} разбанен.`);
        return;
      }
    }

    const msgData = {
      id: Date.now() + Math.random(),
      nick: currentUser.nick,
      badge: currentUser.badge,
      badgeColor: currentUser.badgeColor,
      nickColor: currentUser.nickColor,
      text: cleanText,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    };

    messageHistory.push(msgData);
    if (messageHistory.length > 50) messageHistory.shift();

    io.emit('chat_message', msgData);
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      onlineUsers.delete(socket.id);
      io.emit('online_count', onlineUsers.size);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Чат запущен на порту ${PORT}`);
});
