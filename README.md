# VOICE ROUNDS - 프로젝트 구조

## 디렉토리 구조

```
project/
├── index.html              # 메인 HTML (스크립트 로드 순서 중요)
├── assets/
│   ├── background.png      # 배경 이미지 (960×540)
│   ├── floor.png           # 바닥/플랫폼 타일
│   ├── wall.png            # 좌우 벽 타일
│   ├── Char.png            # 캐릭터 스프라이트 (P1/P2 공통, tint로 구분)
│   └── Gun.png             # 총 스프라이트 (오른쪽 방향 기준)
├── js/
│   ├── player.js           # 플레이어 클래스 (이동/점프/조준/발사)
│   ├── bullet.js           # 탄환 시스템 (물리/튕김/히트)
│   ├── speech.js           # 음성 인식 (P1/P2 독립 인식)
│   ├── socket.js           # 네트워크 클라이언트 (보간 포함)
│   └── game.js             # Phaser3 씬/HUD/게임 루프
└── server/
    └── main.py             # FastAPI + Socket.io 서버
```

## 스크립트 로드 순서 (index.html)

```html
<script src="js/player.js"></script>   <!-- 1. 플레이어 클래스 -->
<script src="js/bullet.js"></script>   <!-- 2. 탄환 시스템 -->
<script src="js/speech.js"></script>   <!-- 3. 음성 인식 -->
<script src="js/socket.js"></script>   <!-- 4. 네트워크 -->
<script src="js/game.js"></script>     <!-- 5. 게임 씬 (마지막) -->
```

## 조작키

| 플레이어 | 이동 | 점프 | 발사 |
|---------|------|------|------|
| P1      | A/D  | W    | 음성 키워드 |
| P2      | ←/→  | ↑    | 음성 키워드 |

## 발사 키워드 (speech.js에서 수정 가능)

`빵`, `발사`, `슛`, `쏴`, `fire`, `shoot`, `bang`

## 서버 실행 (Phase 5 멀티플레이)

```bash
pip install fastapi uvicorn python-socketio
cd server
uvicorn main:socket_app --reload --port 8000
```

## 이미지 앵커 포인트

- **Char.png**: `origin(0.5, 0.5)` — 캐릭터 중심
- **Gun.png**: `origin(0.15, 0.6)` — 손잡이 위치 (회전 중심)
  - Gun.png가 오른쪽(→) 방향 기준으로 제작된 이미지라고 가정
  - flipY로 왼쪽 방향 처리

## 탄환 설정 (bullet.js BULLET_CONFIG)

| 항목 | 값 | 설명 |
|------|-----|------|
| SPEED | 18 | 발사 속도 |
| MAX_BOUNCES | 3 | 최대 튕김 횟수 |
| DAMAGE | 20 | 데미지 (HP 100 기준 5발) |
| GRAVITY | 0.3 | 탄환 중력 (낮을수록 직선) |
| RESTITUTION | 0.88 | 튕김 탄성 |