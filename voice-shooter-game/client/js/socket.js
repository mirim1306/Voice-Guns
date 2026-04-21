/**
 * ─────────────────────────────────────────────────────────────────
 * 멀티플레이어 네트워크 동기화
 * - Socket.io 클라이언트
 * - 방(Room) 참가 및 게임 시작 처리
 * - 플레이어 위치/상태 브로드캐스트 (20tick/s)
 * - 탄환 스폰 동기화 (player_fire 이벤트 구독)
 * - 클라이언트 사이드 보간 (Interpolation)
 * ─────────────────────────────────────────────────────────────────
 */

const NET_CONFIG = {
  SERVER_URL:      'http://localhost:8000',
  TICK_RATE:       50,       // ms (= 20tick/s)
  INTERP_BUFFER:   100,      // ms
  SNAP_THRESHOLD:  80,       // px
};

// ═══════════════════════════════════════════════════════════════
//  NetworkManager
// ═══════════════════════════════════════════════════════════════

class NetworkManager {
  /**
   * @param {Phaser.Scene}  scene
   * @param {Player[]}      players
   * @param {BulletSystem}  bulletSystem
   */
  constructor(scene, players, bulletSystem) {
    this.scene        = scene;
    this.players      = players;
    this.bulletSystem = bulletSystem;

    this._socket      = null;
    this._roomId      = null;
    this._localIndex  = null;  // 이 클라이언트의 플레이어 인덱스 (서버 배정)

    this._remoteBuffer = [];   // 보간 버퍼 [{timestamp, snap}]
    this._tickAccum    = 0;
    this.connected     = false;
    this._destroyed    = false;

    this._connect();

    // ── player_fire 이벤트 구독 → 서버로 탄환 전송 ──
    scene.events.on('player_fire', (data) => {
      this._sendBulletSpawn(data);
    });
  }

  // ── 연결 ──────────────────────────────────────────────────────

  _connect() {
    try {
      this._socket = io(NET_CONFIG.SERVER_URL, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
        timeout: 5000,
      });

      this._socket.on('connect',              () => this._onConnect());
      this._socket.on('disconnect',           () => this._onDisconnect());
      this._socket.on('room_joined',          (d) => this._onRoomJoined(d));
      this._socket.on('room_full',            ()  => this._onRoomFull());
      this._socket.on('game_start',           (d) => this._onGameStart(d));
      this._socket.on('player_update',        (d) => this._onRemotePlayerUpdate(d));
      this._socket.on('bullet_spawn',         (d) => this._onRemoteBulletSpawn(d));
      this._socket.on('player_dead',          (d) => this._onRemotePlayerDead(d));
      this._socket.on('opponent_disconnected',(d) => this._onOpponentDisconnected(d));

    } catch (e) {
      console.warn('[Network] Socket.io 연결 실패 (오프라인 모드):', e);
    }
  }

  // ── 이벤트 핸들러 ─────────────────────────────────────────────

  _onConnect() {
    this.connected = true;
    console.log('[Network] 연결됨:', this._socket.id);

    // URL 파라미터에서 방 ID 읽기 (없으면 'default')
    const roomId = new URLSearchParams(window.location.search).get('room') || 'default';
    this._socket.emit('join_room', { roomId });
  }

  _onDisconnect() {
    this.connected = false;
    console.warn('[Network] 연결 끊김');
    this._showStatusMessage('상대방 연결이 끊어졌습니다.', '#ff7043');
  }

  _onRoomJoined(data) {
    this._roomId     = data.roomId;
    this._localIndex = data.playerIndex;  // 서버가 배정한 인덱스 (0 or 1)

    console.log(`[Network] 방 "${data.roomId}" 참가 → P${data.playerIndex + 1}`);

    // 로컬/원격 플레이어 구분
    this.players.forEach((p, i) => {
      p.isLocal = (i === this._localIndex);
    });

    // 대기 메시지 표시
    if (data.playerCount < 2) {
      this._showStatusMessage('상대방 기다리는 중...', '#4fc3f7');
    }
  }

  _onRoomFull() {
    console.warn('[Network] 방이 가득 찼습니다.');
    this._showStatusMessage('방이 가득 찼습니다. 잠시 후 다시 시도하세요.', '#ff7043');
  }

  _onGameStart(data) {
    console.log('[Network] 게임 시작!', data);
    this._hideStatusMessage();
    this.scene.events.emit('network_game_start');
  }

  _onRemotePlayerUpdate(data) {
    if (data.playerIndex === this._localIndex) return;

    this._remoteBuffer.push({
      timestamp: data.timestamp ?? Date.now(),
      snap:      data,
    });

    // 오래된 버퍼 정리
    const cutoff = Date.now() - NET_CONFIG.INTERP_BUFFER * 4;
    while (this._remoteBuffer.length > 0 && this._remoteBuffer[0].timestamp < cutoff) {
      this._remoteBuffer.shift();
    }
  }

  _onRemoteBulletSpawn(data) {
    if (data.ownerIndex === this._localIndex) return;

    const angle = Math.atan2(data.vy, data.vx);
    this.bulletSystem?.spawnBullet({
      playerIndex: data.ownerIndex,
      x:           data.x,
      y:           data.y,
      angle:       angle,
      bulletId:    data.bulletId,
    });
  }

  _onRemotePlayerDead(data) {
    const player = this.players[data.playerIndex];
    if (player && !player.isDead) {
      player._die();
    }
  }

  _onOpponentDisconnected(data) {
    console.warn('[Network] 상대방 연결 끊김:', data);
    this._showStatusMessage('상대방이 나갔습니다.', '#ff7043');
  }

  // ── 로컬 → 서버 ─────────────────────────────────────────────

  _sendPlayerUpdate() {
    if (!this.connected || this._localIndex === null) return;

    const player = this.players[this._localIndex];
    if (!player || player.isDead) return;

    this._socket.emit('player_update', player.serialize());
  }

  _sendBulletSpawn(data) {
    if (!this.connected || this._localIndex === null) return;
    // 로컬 플레이어가 쏜 것만 전송
    if (data.playerIndex !== this._localIndex) return;

    const angle = data.angle ?? 0;

    this._socket.emit('bullet_spawn', {
      bulletId:   `b_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ownerIndex: data.playerIndex,
      x:          data.x,
      y:          data.y,
      vx:         Math.cos(angle) * 18,
      vy:         Math.sin(angle) * 18,
    });
  }

  // ── 보간 ──────────────────────────────────────────────────────

  _applyInterpolation() {
    if (this._localIndex === null) return;
    if (this._remoteBuffer.length < 1) return;

    const remoteIndex  = this._localIndex === 0 ? 1 : 0;
    const remotePlayer = this.players[remoteIndex];
    if (!remotePlayer) return;

    const renderTime = Date.now() - NET_CONFIG.INTERP_BUFFER;

    let before = null;
    let after  = null;

    for (let i = 0; i < this._remoteBuffer.length - 1; i++) {
      if (
        this._remoteBuffer[i].timestamp     <= renderTime &&
        this._remoteBuffer[i + 1].timestamp >= renderTime
      ) {
        before = this._remoteBuffer[i];
        after  = this._remoteBuffer[i + 1];
        break;
      }
    }

    if (!before || !after) {
      // 최신 스냅 직접 적용
      const latest = this._remoteBuffer[this._remoteBuffer.length - 1];
      this._applySnap(remotePlayer, latest.snap);
      return;
    }

    // 선형 보간
    const t = (renderTime - before.timestamp) / (after.timestamp - before.timestamp);
    const interpolated = {
      x:         before.snap.x  + (after.snap.x  - before.snap.x)  * t,
      y:         before.snap.y  + (after.snap.y  - before.snap.y)  * t,
      vx:        after.snap.vx,
      vy:        after.snap.vy,
      facingDir: after.snap.facingDir,
      aimAngle:  after.snap.aimAngle,
      hp:        after.snap.hp,
    };

    this._applySnap(remotePlayer, interpolated);
  }

  _applySnap(player, snap) {
    const dx   = player.body.position.x - snap.x;
    const dy   = player.body.position.y - snap.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > NET_CONFIG.SNAP_THRESHOLD) {
      player.applySnapshot(snap);
    } else {
      const lf = 0.22;
      player.applySnapshot({
        ...snap,
        x: player.body.position.x + (snap.x - player.body.position.x) * lf,
        y: player.body.position.y + (snap.y - player.body.position.y) * lf,
      });
    }
  }

  // ── UI 헬퍼 ───────────────────────────────────────────────────

  _showStatusMessage(msg, color = '#ffffff') {
    let el = document.getElementById('net-status-msg');
    if (!el) {
      el = document.createElement('div');
      el.id = 'net-status-msg';
      el.style.cssText = `
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        font-family: 'Courier New', monospace;
        font-size: 18px;
        letter-spacing: 0.1em;
        text-align: center;
        pointer-events: none;
        z-index: 100;
        text-shadow: 0 0 12px currentColor;
      `;
      document.getElementById('game-container')?.appendChild(el);
    }
    el.style.color = color;
    el.textContent = msg;
    el.style.display = 'block';
  }

  _hideStatusMessage() {
    const el = document.getElementById('net-status-msg');
    if (el) el.style.display = 'none';
  }

  // ── 업데이트 루프 ─────────────────────────────────────────────

  update(delta) {
    if (!this.connected) return;

    this._tickAccum += delta;
    if (this._tickAccum >= NET_CONFIG.TICK_RATE) {
      this._tickAccum = 0;
      this._sendPlayerUpdate();
    }

    this._applyInterpolation();
  }

  // ── 소멸 ──────────────────────────────────────────────────────

  destroy() {
    this._destroyed = true;
    this._hideStatusMessage();
    try { this._socket?.disconnect(); } catch (_) {}
  }
}