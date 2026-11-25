const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(__dirname));

let posts = [
  {
    id: 1,
    author: 'System',
    time: '12:00',
    text: 'Добро пожаловать в NioGram! Общайтесь с другими пользователями сети.',
    likes: 5
  }
];

let chatMessages = [
  { user: 'System', text: 'Общий чат активен.' }
];

app.get('/api/state', (req, res) => {
  res.json({ posts, chatMessages });
});

app.post('/api/posts', (req, res) => {
  const { author, text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text required' });
  }
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const newPost = {
    id: Date.now(),
    author: (author || 'User').slice(0, 20),
    time,
    text: text.slice(0, 500),
    likes: 0
  };
  posts.unshift(newPost);
  if (posts.length > 50) posts.pop();
  res.json(newPost);
});

app.post('/api/posts/:id/like', (req, res) => {
  const post = posts.find(p => p.id == req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  post.likes++;
  res.json(post);
});

app.post('/api/chat', (req, res) => {
  const { user, text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text required' });
  }
  const msg = {
    user: (user || 'User').slice(0, 20),
    text: text.slice(0, 300)
  };
  chatMessages.push(msg);
  if (chatMessages.length > 100) chatMessages.shift();
  res.json(msg);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NioLit OS running on port ${PORT}`);
});
