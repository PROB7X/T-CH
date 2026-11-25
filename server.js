const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

app.use(express.json());
app.use(express.static(__dirname));

function getAdminConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'secret.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { adminUsername: 'HELM77ZX', adminPassword: '' };
  }
}

// Хранилище в памяти сервера
const users = new Map(); // username -> { password, isAdmin, lastActive }
const posts = [
  {
    id: 1,
    author: 'HELM77ZX',
    isAdmin: true,
    time: '12:00',
    text: 'Система NioLit OS v2.0 запущена. Все модули работают штатно.',
    likes: 10
  }
];
// Заявки в друзья: { id, from, to, status: 'pending' | 'accepted', createdAt }
let friendRequests = [];
// Личные сообщения: { id, from, to, text, createdAt, time }
let directMessages = [];

function cleanupExpiredData() {
  const now = Date.now();
  friendRequests = friendRequests.filter(r => (now - r.createdAt) < SEVEN_DAYS_MS);
  directMessages = directMessages.filter(m => (now - m.createdAt) < SEVEN_DAYS_MS);
}

setInterval(cleanupExpiredData, 60 * 1000);

// Регистрация и вход
app.post('/api/auth', (req, res) => {
  cleanupExpiredData();
  const { mode, username, password } = req.body || {};
  const cleanName = String(username || '').trim();
  const cleanPass = String(password || '').trim();

  if (!cleanName || cleanName.length < 2 || cleanName.length > 20) {
    return res.status(400).json({ ok: false, error: 'Имя должно быть от 2 до 20 символов' });
  }

  const adminCfg = getAdminConfig();
  const isAdminTarget = cleanName.toUpperCase() === adminCfg.adminUsername.toUpperCase();

  // Особая проверка для администратора HELM77ZX
  if (isAdminTarget) {
    if (!cleanPass) {
      return res.status(401).json({ ok: false, requireAdminPass: true, error: 'Требуется пароль администратора' });
    }
    if (cleanPass !== adminCfg.adminPassword) {
      return res.status(403).json({ ok: false, requireAdminPass: true, error: 'Неверный пароль администратора' });
    }
    const existingAdmin = users.get(adminCfg.adminUsername);
    if (existingAdmin && (Date.now() - existingAdmin.lastActive) < 15000) {
      return res.status(409).json({ ok: false, error: 'Этот пользователь уже в сети' });
    }
    users.set(adminCfg.adminUsername, { password: adminCfg.adminPassword, isAdmin: true, lastActive: Date.now() });
    return res.json({ ok: true, user: { username: adminCfg.adminUsername, isAdmin: true } });
  }

  // Обычные пользователи
  const existingKey = Array.from(users.keys()).find(k => k.toLowerCase() === cleanName.toLowerCase());

  if (mode === 'register') {
    if (existingKey) {
      return res.status(409).json({ ok: false, error: 'Это имя уже занято' });
    }
    users.set(cleanName, { password: cleanPass, isAdmin: false, lastActive: Date.now() });
    return res.json({ ok: true, user: { username: cleanName, isAdmin: false } });
  } else {
    // mode === 'login'
    if (!existingKey) {
      return res.status(404).json({ ok: false, error: 'Пользователь не найден. Зарегистрируйтесь' });
    }
    const userObj = users.get(existingKey);
    if ((Date.now() - userObj.lastActive) < 15000) {
      return res.status(409).json({ ok: false, error: 'Пользователь с таким именем уже онлайн' });
    }
    if (userObj.password && userObj.password !== cleanPass) {
      return res.status(403).json({ ok: false, error: 'Неверный пароль' });
    }
    userObj.lastActive = Date.now();
    return res.json({ ok: true, user: { username: existingKey, isAdmin: false } });
  }
});

// Поддержание сессии (heartbeat) и выход
app.post('/api/heartbeat', (req, res) => {
  const { username } = req.body || {};
  if (username && users.has(username)) {
    users.get(username).lastActive = Date.now();
  }
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const { username } = req.body || {};
  if (username && users.has(username)) {
    users.get(username).lastActive = 0;
  }
  res.json({ ok: true });
});

// Лента постов
app.get('/api/posts', (req, res) => {
  res.json({ ok: true, posts });
});

app.post('/api/posts', (req, res) => {
  const { author, text } = req.body || {};
  if (!author || !users.has(author) || !text) {
    return res.status(400).json({ ok: false });
  }
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const newPost = {
    id: Date.now(),
    author,
    isAdmin: users.get(author).isAdmin,
    time,
    text: String(text).slice(0, 300),
    likes: 0
  };
  posts.unshift(newPost);
  res.json({ ok: true, post: newPost });
});

app.post('/api/posts/:id/like', (req, res) => {
  const post = posts.find(p => p.id == req.params.id);
  if (post) post.likes++;
  res.json({ ok: true });
});

// Друзья и заявки
app.get('/api/social/:username', (req, res) => {
  cleanupExpiredData();
  const me = req.params.username;
  const allUsers = Array.from(users.entries()).map(([name, info]) => ({
    username: name,
    isAdmin: info.isAdmin,
    online: (Date.now() - info.lastActive) < 15000
  }));

  const myRequests = friendRequests.filter(r => r.from === me || r.to === me);
  res.json({ ok: true, users: allUsers, requests: myRequests });
});

app.post('/api/friends/request', (req, res) => {
  cleanupExpiredData();
  const { from, to } = req.body || {};
  if (!from || !to || from === to) return res.status(400).json({ ok: false, error: 'Некорректный адресат' });
  if (!users.has(to)) return res.status(404).json({ ok: false, error: 'Пользователь не существует' });

  const exists = friendRequests.find(
    r => (r.from === from && r.to === to) || (r.from === to && r.to === from)
  );
  if (exists) {
    return res.status(400).json({ ok: false, error: 'Заявка уже отправлена или вы уже друзья' });
  }

  friendRequests.push({
    id: Date.now(),
    from,
    to,
    status: 'pending',
    createdAt: Date.now()
  });
  res.json({ ok: true });
});

app.post('/api/friends/accept', (req, res) => {
  cleanupExpiredData();
  const { id, username } = req.body || {};
  const reqObj = friendRequests.find(r => r.id == id && r.to === username);
  if (!reqObj) return res.status(404).json({ ok: false });
  reqObj.status = 'accepted';
  res.json({ ok: true });
});

// Личные сообщения (только между одобренными друзьями, хранение 7 дней)
app.get('/api/dm/:me/:peer', (req, res) => {
  cleanupExpiredData();
  const { me, peer } = req.params;
  const isFriend = friendRequests.some(
    r => r.status === 'accepted' && ((r.from === me && r.to === peer) || (r.from === peer && r.to === me))
  );
  if (!isFriend) {
    return res.status(403).json({ ok: false, error: 'Сначала пользователь должен одобрить заявку в друзья' });
  }
  const history = directMessages.filter(
    m => (m.from === me && m.to === peer) || (m.from === peer && m.to === me)
  );
  res.json({ ok: true, messages: history });
});

app.post('/api/dm', (req, res) => {
  cleanupExpiredData();
  const { from, to, text } = req.body || {};
  const isFriend = friendRequests.some(
    r => r.status === 'accepted' && ((r.from === from && r.to === to) || (r.from === to && r.to === from))
  );
  if (!isFriend) {
    return res.status(403).json({ ok: false, error: 'Нет одобренной заявки в друзья' });
  }
  if (!text || !String(text).trim()) return res.status(400).json({ ok: false });

  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const msg = {
    id: Date.now(),
    from,
    to,
    text: String(text).slice(0, 500),
    createdAt: Date.now(),
    time
  };
  directMessages.push(msg);
  res.json({ ok: true, message: msg });
});

app.listen(PORT, () => {
  console.log(`NioLit OS running on port ${PORT}`);
});
