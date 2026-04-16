"""
main.py
─────────────────────────────────────────────────────────────────
Voice Rounds 멀티플레이어 서버
- FastAPI + python-socketio
- 방(Room) 기반 2인 매칭
- 플레이어 위치/탄환 브로드캐스트
- 사망 동기화

설치: pip install fastapi uvicorn python-socketio
실행: uvicorn main:socket_app --reload --port 8000
─────────────────────────────────────────────────────────────────
"""

from typing import Dict
import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── 서버 설정 ──────────────────────────────────────────────────
MAX_ROOM_PLAYERS = 2

# ═══════════════════════════════════════════════════════════════
#  FastAPI + Socket.io
# ═══════════════════════════════════════════════════════════════

sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False,
)

app = FastAPI(title="Voice Rounds Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Socket.io를 FastAPI ASGI 앱에 마운트
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

# ═══════════════════════════════════════════════════════════════
#  상태 관리
# ═══════════════════════════════════════════════════════════════

# { roomId: { 'players': [sid, ...], 'state': {playerIndex: snap} } }
rooms: Dict[str, dict] = {}

# { sid: { 'roomId': str, 'playerIndex': int } }
clients: Dict[str, dict] = {}


def get_or_create_room(room_id: str) -> dict:
    if room_id not in rooms:
        rooms[room_id] = {
            'players': [],
            'state':   {},
        }
    return rooms[room_id]


def remove_player(sid: str):
    if sid not in clients:
        return
    info    = clients.pop(sid)
    room    = rooms.get(info['roomId'])
    if room and sid in room['players']:
        room['players'].remove(sid)
    # 방이 비면 삭제
    if room and len(room['players']) == 0:
        rooms.pop(info['roomId'], None)

# ═══════════════════════════════════════════════════════════════
#  Socket.io 이벤트
# ═══════════════════════════════════════════════════════════════

@sio.event
async def connect(sid, environ):
    print(f"[Connect]  {sid}")


@sio.event
async def disconnect(sid):
    print(f"[Disconnect] {sid}")
    if sid in clients:
        info    = clients[sid]
        room_id = info['roomId']
        await sio.emit(
            'opponent_disconnected',
            {'playerIndex': info['playerIndex']},
            room=room_id,
            skip_sid=sid,
        )
        remove_player(sid)


@sio.event
async def join_room(sid, data):
    """
    클라이언트 방 참가
    data: { roomId: str }
    """
    room_id = data.get('roomId', 'default')
    room    = get_or_create_room(room_id)

    if len(room['players']) >= MAX_ROOM_PLAYERS:
        await sio.emit('room_full', {}, to=sid)
        return

    player_index = len(room['players'])
    room['players'].append(sid)
    clients[sid] = {'roomId': room_id, 'playerIndex': player_index}

    await sio.enter_room(sid, room_id)

    await sio.emit('room_joined', {
        'roomId':      room_id,
        'playerIndex': player_index,
        'playerCount': len(room['players']),
    }, to=sid)

    print(f"[Room]  {sid} → '{room_id}' P{player_index + 1}")

    # 방 인원이 다 차면 게임 시작
    if len(room['players']) == MAX_ROOM_PLAYERS:
        await sio.emit('game_start', {'roomId': room_id}, room=room_id)
        print(f"[Room]  '{room_id}' 정원 충족 → game_start")


@sio.event
async def player_update(sid, data):
    """
    플레이어 위치/상태 브로드캐스트
    data: { playerIndex, x, y, vx, vy, facingDir, aimAngle, hp, timestamp }
    """
    if sid not in clients:
        return

    info    = clients[sid]
    room_id = info['roomId']

    rooms[room_id]['state'][info['playerIndex']] = data

    await sio.emit(
        'player_update',
        data,
        room=room_id,
        skip_sid=sid,
    )


@sio.event
async def bullet_spawn(sid, data):
    """
    탄환 발사 브로드캐스트
    data: { bulletId, ownerIndex, x, y, vx, vy }
    """
    if sid not in clients:
        return

    room_id = clients[sid]['roomId']
    await sio.emit('bullet_spawn', data, room=room_id, skip_sid=sid)


@sio.event
async def player_dead(sid, data):
    """
    플레이어 사망 브로드캐스트
    data: { playerIndex }
    """
    if sid not in clients:
        return

    room_id = clients[sid]['roomId']
    await sio.emit('player_dead', data, room=room_id, skip_sid=sid)

# ═══════════════════════════════════════════════════════════════
#  REST 엔드포인트
# ═══════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "rooms":   len(rooms),
        "clients": len(clients),
    }


@app.get("/rooms")
async def list_rooms():
    return {
        room_id: {
            "playerCount": len(room["players"]),
            "isFull":      len(room["players"]) >= MAX_ROOM_PLAYERS,
        }
        for room_id, room in rooms.items()
    }

# ═══════════════════════════════════════════════════════════════
#  실행 진입점
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:socket_app", host="0.0.0.0", port=8000, reload=True)