import asyncio
import json
import random
import math
import os
from aiohttp import web

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
        await asyncio.sleep(0.03)
        dead_players = []

        for pid, p in list(players.items()):
            dx = p["target_x"] - p["x"]
            dy = p["target_y"] - p["y"]
            angle = math.atan2(dy, dx)
            speed = 5.0

            p["x"] += math.cos(angle) * speed
            p["y"] += math.sin(angle) * speed

            p["x"] = max(10, min(MAP_SIZE - 10, p["x"]))
            p["y"] = max(10, min(MAP_SIZE - 10, p["y"]))

            p["body"].insert(0, {"x": p["x"], "y": p["y"]})
            while len(p["body"]) > p["length"]:
                p["body"].pop()

            for f in list(food):
                if math.hypot(p["x"] - f["x"], p["y"] - f["y"]) < 20:
                    food.remove(f)
                    food.append(spawn_food())
                    p["length"] += 3
                    p["score"] += 10

            for other_id, other in players.items():
                if pid == other_id:
                    continue
                for segment in other["body"][5:]:
                    if math.hypot(p["x"] - segment["x"], p["y"] - segment["y"]) < 14:
                        dead_players.append(pid)
                        break

        for pid in set(dead_players):
            if pid in players:
                players[pid]["x"] = random.randint(200, MAP_SIZE - 200)
                players[pid]["y"] = random.randint(200, MAP_SIZE - 200)
                players[pid]["length"] = 20
                players[pid]["score"] = 0
                players[pid]["body"] = []

        if players:
            clean_players = {
                k: {key: val for key, val in v.items() if key != "ws"}
                for k, v in players.items()
            }
            state = json.dumps({
                "type": "state",
                "players": clean_players,
                "food": food
            })
            await asyncio.gather(
                *[p["ws"].send_str(state) for p in players.values()],
                return_exceptions=True
            )

async def index_handler(request):
    html_path = os.path.join(os.path.dirname(__file__), "index.html")
    return web.FileResponse(html_path)

async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

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
    await ws.send_str(json.dumps({"type": "init", "id": pid, "map_size": MAP_SIZE}))

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                if data.get("type") == "move" and pid in players:
                    players[pid]["target_x"] = data["x"]
                    players[pid]["target_y"] = data["y"]
                elif data.get("type") == "name" and pid in players:
                    players[pid]["name"] = data["name"][:15]
    finally:
        if pid in players:
            del players[pid]

    return ws

async def on_startup(app):
    app["game_loop"] = asyncio.create_task(game_loop())

app = web.Application()
app.on_startup.append(on_startup)
app.router.add_get("/", index_handler)
app.router.add_get("/ws", ws_handler)

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=PORT)
