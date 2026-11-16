import asyncio
import json
import random
import math
import websockets

PORT = 8000
MAP_SIZE = 2000
FOOD_COUNT = 150

players = {}
food = []

def spawn_food():
    return {
        "id": random.randint(100000, 999999),
        "x": random.randint(50, MAP_SIZE - 50),
        "y": random.randint(50, MAP_SIZE - 50),
        "color": f"hsl({random.randint(0, 360)}, 80%, 60%)"
    }

for _ in range(FOOD_COUNT):
    food.append(spawn_food())

async def game_loop():
    while True:
        await asyncio.sleep(0.03)  # ~33 кадра в секунду
        dead_players = []

        for pid, p in list(players.items()):
            # Движение головы червяка к курсору
            dx = p["target_x"] - p["x"]
            dy = p["target_y"] - p["y"]
            angle = math.atan2(dy, dx)
            speed = 5.0

            p["x"] += math.cos(angle) * speed
            p["y"] += math.sin(angle) * speed

            # Ограничение картой
            p["x"] = max(10, min(MAP_SIZE - 10, p["x"]))
            p["y"] = max(10, min(MAP_SIZE - 10, p["y"]))

            # Добавляем новую точку в тело и обрезаем хвост
            p["body"].insert(0, {"x": p["x"], "y": p["y"]})
            while len(p["body"]) > p["length"]:
                p["body"].pop()

            # Проверка поедания еды
            for f in list(food):
                if math.hypot(p["x"] - f["x"], p["y"] - f["y"]) < 20:
                    food.remove(f)
                    food.append(spawn_food())
                    p["length"] += 3
                    p["score"] += 10

            # Проверка столкновения с телами других червяков
            for other_id, other in players.items():
                if pid == other_id:
                    continue
                for segment in other["body"][5:]:
                    if math.hypot(p["x"] - segment["x"], p["y"] - segment["y"]) < 14:
                        dead_players.append(pid)
                        break

        # Возрождение проигравших
        for pid in set(dead_players):
            if pid in players:
                players[pid]["x"] = random.randint(200, MAP_SIZE - 200)
                players[pid]["y"] = random.randint(200, MAP_SIZE - 200)
                players[pid]["length"] = 20
                players[pid]["score"] = 0
                players[pid]["body"] = []

        # Рассылка состояния всем подключенным игрокам
        if players:
            state = json.dumps({
                "type": "state",
                "players": players,
                "food": food
            })
            await asyncio.gather(
                *[p["ws"].send(state) for p in players.values()],
                return_exceptions=True
            )

async def handler(ws):
    pid = str(id(ws))
    players[pid] = {
        "ws": ws,
        "name": f"Червяк_{pid[-3:]}",
        "x": random.randint(200, MAP_SIZE - 200),
        "y": random.randint(200, MAP_SIZE - 200),
        "target_x": 1000,
        "target_y": 1000,
        "length": 20,
        "score": 0,
        "color": f"hsl({random.randint(0, 360)}, 85%, 55%)",
        "body": []
    }
    await ws.send(json.dumps({"type": "init", "id": pid, "map_size": MAP_SIZE}))

    try:
        async for message in ws:
            data = json.loads(message)
            if data.get("type") == "move" and pid in players:
                players[pid]["target_x"] = data["x"]
                players[pid]["target_y"] = data["y"]
            elif data.get("type") == "name" and pid in players:
                players[pid]["name"] = data["name"][:15]
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if pid in players:
            del players[pid]

async def main():
    asyncio.create_task(game_loop())
    async with websockets.serve(handler, "0.0.0.0", PORT):
        print(f"Сервер червячков запущен на порту {PORT}")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
