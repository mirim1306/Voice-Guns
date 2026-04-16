/**
 * socket.js
 * ─────────────────────────────────────────────────────────────────
 * Phase 5: 멀티플레이어 네트워크 동기화
 * - Socket.io 클라이언트
 * - 플레이어 위치/각도 브로드캐스트 (20tick/s)
 * - 탄환 스폰 동기화
 * - 클라이언트 사이드 보간 (Interpolation)
 * ─────────────────────────────────────────────────────────────────
 *
 * 사용법:
 *   GameScene.create() 에서:
 *     this._netManager = new NetworkManager(this, this.players, this._bulletSystem);
 *
 *   GameScene.update() 에서:
 *     this._netManager.update(delta);
 *
 *   GameScene.shutdown() 에서:
 *     this._netManager.destroy();
 * ─────────────────────────────────────────────────────────────────
 */

// ── 네트워크 설정 ──────────────────────────────────────────────────
const NET_CONFIG = {
  SERVER_URL:        'http://localhost:8000',   // FastAPI 서버 주소
  TICK_RATE:         50,      // 전송 주기 (ms) = 20tick/s
  INTERP_BUFFER:     100,     // 보간 버퍼 시간 (ms)
  SNAP_THRESHOLD:    80,      // 이 거리(px) 이상 차이 나면 즉시 스냅
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

    this._socket       = null;
    this._roomId       = null;
    this._localIndex   = null;   // 이 클라이언트의 플레이어 인덱스

    // 보간용 상태 버퍼 [{timestamp, snap}]
    this._remoteBuffer = [];

    // 전송 타이머
    this._tickAccum    = 0;

    // 연결 상태
    this.connected     = false;
    this._destroyed    = false;

    // 연결 시작
    this._connect();
  }

  // ── 연결 ──────────────────────────────────────────────────────

  _connect() {
    try {
      this._socket = io(NET_CONFIG.SERVER_URL, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
      });

      this._socket.on('connect',    () => this._onConnect());
      this._socket.on('disconnect', () => this._onDisconnect());
      this._socket.on('room_joined',   (data) => this._onRoomJoined(data));
      this._socket.on('player_update', (data) => this._onRemotePlayerUpdate(data));
      this._socket.on('bullet_spawn',  (data) => this._onRemoteBulletSpawn(data));
      this._socket.on('player_dead',   (data) => this._onRemotePlayerDead(data));

    } catch (e) {
      console.warn('[Network] Socket.io 연결 실패 (로컬 2P 모드로 계속):', e);
    }
  }

  // ── 이벤트 핸들러 ─────────────────────────────────────────────

  _onConnect() {
    this.connected = true;
    console.log('[Network] Connected:', this._socket.id);

    // 방 참가 요청 (URL 파라미터 또는 기본 방)
    const roomId = new URLSearchParams(window.location.search).get('room') || 'default';
    this._socket.emit('join_room', { roomId });
  }

  _onDisconnect() {
    this.connected = false;
    console.warn('[Network] Disconnected');
  }

  /**
   * 서버로부터 방 참가 확인
   * data: { roomId, playerIndex, players }
   */
  _onRoomJoined(data) {
    this._roomId     = data.roomId;
    this._localIndex = data.playerIndex;   // 0 or 1
    console.log(`[Network] Joined room "${data.roomId}" as P${data.playerIndex + 1}`);

    // 로컬 플레이어 인덱스 설정
    // Phase 5에서는 한 클라이언트가 한 플레이어만 제어
    this.players.forEach((p, i) => {
      p.isLocal = (i === this._localIndex);
    });
  }

  /**
   * 원격 플레이어 상태 수신
   * data: { playerIndex, x, y, vx, vy, facingDir, aimAngle, hp, timestamp }
   */
  _onRemotePlayerUpdate(data) {
    if (data.playerIndex === this._localIndex) return; // 자신의 에코 무시

    // 보간 버퍼에 추가
    this._remoteBuffer.push({
      timestamp: data.timestamp ?? Date.now(),
      snap:      data,
    });

    // 버퍼 최대 크기 제한 (오래된 것 제거)
    const cutoff = Date.now() - NET_CONFIG.INTERP_BUFFER * 4;
    while (this._remoteBuffer.length > 0 && this._remoteBuffer[0].timestamp < cutoff) {
      this._remoteBuffer.shift();
    }
  }

  /**
   * 원격 탄환 스폰 수신
   * data: { bulletId, ownerIndex, x, y, vx, vy }
   */
  _onRemoteBulletSpawn(data) {
    if (data.ownerIndex === this._localIndex) return; // 자신의 에코 무시

    const angle = Math.atan2(data.vy, data.vx);
    this.bulletSystem?.spawnBullet({
      playerIndex: data.ownerIndex,
      x:           data.x,
      y:           data.y,
      angle:       angle,
      bulletId:    data.bulletId,
    });
  }

  /**
   * 원격 플레이어 사망
   * data: { playerIndex }
   */
  _onRemotePlayerDead(data) {
    this.players[data.playerIndex]?._die();
  }

  // ── 로컬 → 서버 전송 ─────────────────────────────────────────

  _sendPlayerUpdate() {
    if (!this.connected || this._localIndex === null) return;

    const player = this.players[this._localIndex];
    if (!player || player.isDead) return;

    const snap = {
      ...player.serialize(),
      timestamp: Date.now(),
    };

    this._socket.emit('player_update', snap);
  }

  /**
   * 탄환 발사 시 서버에 전송
   * GameScene의 player_fire 이벤트를 구독하여 호출
   */
  sendBulletSpawn(data) {
    if (!this.connected) return;
    this._socket.emit('bullet_spawn', data);
  }

  // ── 보간 처리 ─────────────────────────────────────────────────

  _applyInterpolation() {
    if (this._remoteBuffer.length < 2) return;

    const remoteIndex = this._localIndex === 0 ? 1 : 0;
    const remotePlayer = this.players[remoteIndex];
    if (!remotePlayer) return;

    // 렌더 타임 = 현재 시간 - 버퍼 딜레이
    const renderTime = Date.now() - NET_CONFIG.INTERP_BUFFER;

    // 버퍼에서 renderTime을 감싸는 두 스냅샷 찾기
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
      // 버퍼에 최신 스냅샷만 있으면 그것을 직접 적용
      const latest = this._remoteBuffer[this._remoteBuffer.length - 1];
      this._applySnap(remotePlayer, latest.snap);
      return;
    }

    // 두 스냅샷 사이를 선형 보간
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
    const dx = player.body.position.x - snap.x;
    const dy = player.body.position.y - snap.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > NET_CONFIG.SNAP_THRESHOLD) {
      // 차이가 크면 즉시 스냅
      player.applySnapshot(snap);
    } else {
      // 부드러운 보간 (러프)
      const lerpFactor = 0.22;
      const lerpedSnap = {
        ...snap,
        x:  player.body.position.x + (snap.x - player.body.position.x) * lerpFactor,
        y:  player.body.position.y + (snap.y - player.body.position.y) * lerpFactor,
      };
      player.applySnapshot(lerpedSnap);
    }
  }

  // ── 업데이트 루프 ─────────────────────────────────────────────

  update(delta) {
    if (!this.connected) return;

    // 전송 타이머
    this._tickAccum += delta;
    if (this._tickAccum >= NET_CONFIG.TICK_RATE) {
      this._tickAccum = 0;
      this._sendPlayerUpdate();
    }

    // 원격 플레이어 보간
    this._applyInterpolation();
  }

  // ── 소멸 ──────────────────────────────────────────────────────

  destroy() {
    this._destroyed = true;
    this._socket?.disconnect();
  }
}