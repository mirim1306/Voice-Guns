"""
manager.py
─────────────────────────────────────────────────────────────────
방(Room) 및 플레이어 관리 로직
main.py에서 import하여 사용
─────────────────────────────────────────────────────────────────
"""

from typing import Dict, Optional

MAX_ROOM_PLAYERS = 2


class RoomManager:
    def __init__(self):
        # { roomId: { 'players': [sid, ...], 'state': {playerIndex: snap} } }
        self.rooms:   Dict[str, dict] = {}
        # { sid: { 'roomId': str, 'playerIndex': int } }
        self.clients: Dict[str, dict] = {}

    # ── 방 관리 ────────────────────────────────────────────────

    def get_or_create_room(self, room_id: str) -> dict:
        if room_id not in self.rooms:
            self.rooms[room_id] = {
                'players': [],
                'state':   {},
            }
        return self.rooms[room_id]

    def is_room_full(self, room_id: str) -> bool:
        room = self.rooms.get(room_id)
        if not room:
            return False
        return len(room['players']) >= MAX_ROOM_PLAYERS

    def add_player(self, sid: str, room_id: str) -> Optional[int]:
        """
        플레이어를 방에 추가하고 배정된 playerIndex를 반환.
        방이 가득 찬 경우 None 반환.
        """
        room = self.get_or_create_room(room_id)

        if len(room['players']) >= MAX_ROOM_PLAYERS:
            return None

        player_index = len(room['players'])
        room['players'].append(sid)
        self.clients[sid] = {'roomId': room_id, 'playerIndex': player_index}
        return player_index

    def remove_player(self, sid: str) -> Optional[dict]:
        """
        플레이어를 제거하고 제거된 클라이언트 정보를 반환.
        빈 방은 자동 삭제.
        """
        if sid not in self.clients:
            return None

        info    = self.clients.pop(sid)
        room    = self.rooms.get(info['roomId'])

        if room and sid in room['players']:
            room['players'].remove(sid)

        # 빈 방 삭제
        if room and len(room['players']) == 0:
            self.rooms.pop(info['roomId'], None)

        return info

    def get_client_info(self, sid: str) -> Optional[dict]:
        return self.clients.get(sid)

    def update_state(self, sid: str, snap: dict):
        """플레이어 상태 스냅샷 캐시 업데이트."""
        info = self.clients.get(sid)
        if not info:
            return
        room = self.rooms.get(info['roomId'])
        if room:
            room['state'][info['playerIndex']] = snap

    def get_room_state(self, room_id: str) -> dict:
        room = self.rooms.get(room_id, {})
        return room.get('state', {})

    def player_count(self, room_id: str) -> int:
        room = self.rooms.get(room_id)
        return len(room['players']) if room else 0

    def summary(self) -> dict:
        return {
            room_id: {
                'playerCount': len(room['players']),
                'isFull':      len(room['players']) >= MAX_ROOM_PLAYERS,
            }
            for room_id, room in self.rooms.items()
        }