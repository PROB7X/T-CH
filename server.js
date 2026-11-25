const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Хранилище пользователей: { username: { password: string | null } }
const users = {
  System: { password: null }
};

// Лента постов
let posts = [
  {
    id: 1,
    author: 'System',
    time: '00:00',
    text: 'Добро пожаловать в NioLit Mobile! Теперь доступны личные чаты с автоудалением сообщений через 7 дней.',
    likes: 1
  }
];

// Личные сообщения: [{ id, from, to, text, time, createdAt }]
let directMessages = [];

// Функция очистки сообщений старше 7 дней
function cleanupExpiredMessages() {
  const now = Date.now();
  directMessages = directMessages.filter(m => (now - m.createdAt) < SEVEN_DAYS_MS);
}

// Автоматическая очистка каждый час
setInterval(cleanupExpiredMessages, 60 * 60 * 1000);

function getFormattedTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// Авторизация / регистрация пользователя (пароль необязателен)
app.post('/api/auth', (req, res) => {
  const { username, password } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'Имя пользователя обязательно' });
  }
  const cleanName = username.trim();
  const cleanPass = password ? password.trim() : '';

  if (users[cleanName]) {
    // Если у пользователя установлен пароль — проверяем его
    if (users[cleanName].password && users[cleanName].password !== cleanPass) {
      return res.status(403).json({ error: 'Неверный пароль для этого имени!' });
    }
    // Если пароля не было, а пользователь решил его добавить
    if (!users[cleanName].password && cleanPass) {
      users[cleanName].password = cleanPass;
    }
  } else {
    users[cleanName] = { password: cleanPass || null };
  }

  res.json({ ok: true, username: cleanName });
});

// Список зарегистрированных пользователей
app.get('/api/users', (req, res) => {
  res.json(Object.keys(users));
});

// Посты общей ленты
app.get('/api/posts', (req, res) => {
  res.json(posts);
});

app.post('/api/posts', (req, res) => {
  const { author, text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Пустой текст' });
  }
  const newPost = {
    id: Date.now(),
    author: author || 'Гость',
    time: getFormattedTime(),
    text: text.trim(),
    likes: 0
  };
  posts.unshift(newPost);
  res.json(newPost);
});

app.post('/api/posts/:id/like', (req, res) => {
  const post = posts.find(p => p.id == req.params.id);
  if (!post) return res.status(404).json({ error: 'Не найдено' });
  post.likes++;
  res.json(post);
});

// Получить личную переписку между двумя пользователями (с предварительной очисткой старых)
app.get('/api/dm', (req, res) => {
  cleanupExpiredMessages();
  const { u1, u2 } = req.query;
  if (!u1 || !u2) return res.json([]);

  const dialog = directMessages.filter(
    m => (m.from === u1 && m.to === u2) || (m.from === u2 && m.to === u1)
  );
  res.json(dialog);
});

// Отправить личное сообщение
app.post('/api/dm', (req, res) => {
  cleanupExpiredMessages();
  const { from, to, text } = req.body;
  if (!from || !to || !text || !text.trim()) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }
  const msg = {
    id: Date.now(),
    from: from.trim(),
    to: to.trim(),
    text: text.trim(),
    time: getFormattedTime(),
    createdAt: Date.now()
  };
  directMessages.push(msg);
  res.json(msg);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NioLit Mobile OS server running on port ${PORT}`);
});
