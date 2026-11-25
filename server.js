const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'db.json');

const BASE_PRICES = {
  cyber_duck: 40,
  astro_cat: 65,
  neon_rocket: 90,
  magic_potion: 115,
  quantum_safe: 150,
  cyber_bot: 185,
  ufo_saucer: 230,
  crystal_dragon: 290,
  astral_blade: 360,
  chrono_relic: 450,
  void_diamond: 580,
  crown_of_stars: 750
};

let db = { players: {} };
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {}
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let marketPrices = { ...BASE_PRICES };

// Общий онлайн-курс подарков для всех игроков каждые 4 секунды
setInterval(() => {
  Object.keys(BASE_PRICES).forEach(id => {
    const base = BASE_PRICES[id];
    const delta = (Math.random() - 0.48) * 0.22;
    const minP = Math.max(10, Math.round(base * 0.55));
    const maxP = Math.round(base * 2.2);
    marketPrices[id] = Math.min(maxP, Math.max(minP, Math.round(marketPrices[id] * (1 + delta))));
  });
}, 4000);

app.post('/api/sync', (req, res) => {
  const { playerName, balance, inventory, isInitial } = req.body;
  if (!playerName || typeof playerName !== 'string') {
    return res.status(400).json({ error: 'Invalid playerName' });
  }

  const cleanName = playerName.trim().slice(0, 20);

  if (!db.players[cleanName]) {
    db.players[cleanName] = {
      playerName: cleanName,
      balance: typeof balance === 'number' ? balance : 250,
      inventory: Array.isArray(inventory) ? inventory : [],
      updatedAt: Date.now()
    };
    saveDb();
  } else if (!isInitial) {
    db.players[cleanName].balance = balance;
    db.players[cleanName].inventory = inventory;
    db.players[cleanName].updatedAt = Date.now();
    saveDb();
  }

  const leaderboard = Object.values(db.players)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10)
    .map(p => ({ playerName: p.playerName, balance: p.balance }));

  res.json({
    player: db.players[cleanName],
    marketPrices,
    leaderboard
  });
});

app.get('/', (req, res) => {
  res.send('Stars NFT Online Server is running on port 3000!');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Server started on http://0.0.0.0:3000');
});
