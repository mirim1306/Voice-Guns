"""
main.py
─────────────────────────────────────────────────────────────────
Phase 5: 멀티플레이어 서버
- FastAPI + python-socketio
- 방(Room) 기반 2인 매칭
- 플레이어 위치/탄환 브로드캐스트
- 설치: pip install fastapi uvicorn python-socketio
- 실행: uvicorn main:app --reload --port 8000
─────────────────────────────────────────────────────────────────
"""

import asyncio
import time
from typing import Dict, Optional

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── 서버 설정 ──────────────────────────────────────────────────────

TICK_RATE       = 20          # 서버 틱 (초당 업데이트 횟수)
MAX_ROOM_PLAYERS = 2          # 방당 최대 플레이어 수

# ═══════════════════════════════════════════════════════════════
#  FastAPI + Socket.io 설정
# ═══════════════════════════════════════════════════════════════

# Socket.io 서버 (ASGI 모드)
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',    # 개발용: 실제 배포 시 도메인 지정
    logger=False,
    engineio_logger=False,
)

# FastAPI 앱
app = FastAPI(title="Voice Rounds Server")

# CORS 설정 (개발용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Socket.io를 FastAPI에 마운트
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

# ═══════════════════════════════════════════════════════════════
#  방(Room) 관리
# ═══════════════════════════════════════════════════════════════

# { roomId: { 'players': [sid1, sid2], 'state': {...} } }
rooms: Dict[str, dict] = {}

# { sid: { 'roomId': str, 'playerIndex': int } }
clients: Dict[str, dict] = {}


def get_or_create_room(room_id: str) -> dict:
    if room_id not in rooms:
        rooms[room_id] = {
            'players':  [],   # [sid, sid]
            'state':    {},   # 마지막 플레이어 상태 캐시
        }
    return rooms[room_id]


def remove_player_from_room(sid: str):
    if sid not in clients:
        return
    info   = clients[sid]
    room   = rooms.get(info['roomId'])
    if room and sid in room['players']:
        room['players'].remove(sid)
    del clients[sid]

# ═══════════════════════════════════════════════════════════════
#  Socket.io 이벤트 핸들러
# ═══════════════════════════════════════════════════════════════

@sio.event
async def connect(sid, environ):
    print(f"[Connect] {sid}")


@sio.event
async def disconnect(sid):
    print(f"[Disconnect] {sid}")
    if sid in clients:
        info = clients[sid]
        room_id = info['roomId']
        # 상대방에게 연결 끊김 알림
        await sio.emit(
            'opponent_disconnected',
            {'playerIndex': info['playerIndex']},
            room=room_id,
            skip_sid=sid,
        )
        remove_player_from_room(sid)


@sio.event
async def join_room(sid, data):
    """
    클라이언트가 방에 참가
    data: { roomId: str }
    """
    room_id = data.get('roomId', 'default')
    room    = get_or_create_room(room_id)

    if len(room['players']) >= MAX_ROOM_PLAYERS:
        await sio.emit('room_full', {}, to=sid)
        return

    # 플레이어 인덱스 할당
    player_index = len(room['players'])   # 0 or 1
    room['players'].append(sid)
    clients[sid] = { 'roomId': room_id, 'playerIndex': player_index }

    # Socket.io 방에 참가
    await sio.enter_room(sid, room_id)

    # 참가 확인 응답
    await sio.emit('room_joined', {
        'roomId':      room_id,
        'playerIndex': player_index,
        'playerCount': len(room['players']),
    }, to=sid)

    print(f"[Room] {sid} joined '{room_id}' as P{player_index + 1}")

    # 방이 꽉 찼으면 게임 시작 신호
    if len(room['players']) == MAX_ROOM_PLAYERS:
        await sio.emit('game_start', { 'roomId': room_id }, room=room_id)
        print(f"[Room] '{room_id}' is full → game_start")


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

    # 상태 캐시 갱신
    rooms[room_id]['state'][info['playerIndex']] = data

    # 방 내 다른 클라이언트에게 전달
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
    data: { bulletId, ownerIndex, x, y, vx, vy, bounceCount }
    """
    if sid not in clients:
        return

    room_id = clients[sid]['roomId']

    await sio.emit(
        'bullet_spawn',
        data,
        room=room_id,
        skip_sid=sid,
    )


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
    return { "status": "ok", "rooms": len(rooms) }

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
    # socket_app (ASGIApp)을 직접 실행
    uvicorn.run("main:socket_app", host="0.0.0.0", port=8000, reload=True)