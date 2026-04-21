/**
 * ─────────────────────────────────────────────────────────────────
 * Phase 3: 음성 인식 시스템
 * - P1, P2 각자 독립적인 SpeechRecognition 인스턴스
 * - 발사 키워드 인식 → player.fire() 호출
 * - VU 미터 (음량 시각화)
 * - Web Speech API (Chrome 권장)
 * ─────────────────────────────────────────────────────────────────
 */

// ── 발사 키워드 설정 ───────────────────────────────────────────────
// 키워드는 index.html 시작 화면에서 window.VOICE_KEYWORDS 로 주입됨
// 폴백: 기본값 (직접 실행 시 사용)
const SPEECH_CONFIG = {
  P1_FIRE_KEYWORDS: ['불', 'fire'],
  P2_FIRE_KEYWORDS: ['빵', 'shoot'],

  // 인식 언어
  LANG: 'ko-KR',

  // 연속 인식 여부
  CONTINUOUS: true,
  INTERIM:    true,

  // VU 미터 갱신 주기 (ms)
  VU_UPDATE_MS: 50,

  // 같은 키워드 연속 무시 시간 (ms) - 중복 발사 방지
  FIRE_COOLDOWN: 300,
};

// ═══════════════════════════════════════════════════════════════
//  SpeechManager
// ═══════════════════════════════════════════════════════════════

class SpeechManager {
  /**
   * @param {Phaser.Scene} scene
   * @param {Player[]}     players
   */
  constructor(scene, players) {
    this.scene    = scene;
    this.players  = players;

    this._p1Rec   = null;   // SpeechRecognition (P1)
    this._p2Rec   = null;   // SpeechRecognition (P2)

    this._p1LastFire = 0;
    this._p2LastFire = 0;

    // AudioContext 기반 VU 미터
    this._audioCtx  = null;
    this._analyser  = null;
    this._vuData    = null;
    this._vuGfx     = null;
    this._vuActive  = false;

    // 음성 인식 지원 여부 확인
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[Speech] Web Speech API not supported in this browser.');
      this._supported = false;
      return;
    }

    this._SpeechRecognition = SpeechRecognition;
    this._supported = true;

    // HUD 인디케이터
    this._indicator = document.getElementById('voice-indicator');

    // VU 그래픽 초기화
    this._buildVUGraphics();
  }

  // ── 시작 ──────────────────────────────────────────────────────

  /** P1, P2 음성 인식 모두 시작 (시작 화면 키워드 반영) */
  startAll() {
    // 시작 화면에서 입력한 키워드가 있으면 덮어씌움
    if (window.VOICE_KEYWORDS) {
      SPEECH_CONFIG.P1_FIRE_KEYWORDS = window.VOICE_KEYWORDS.p1;
      SPEECH_CONFIG.P2_FIRE_KEYWORDS = window.VOICE_KEYWORDS.p2;
      console.log('[Speech] P1 키워드:', SPEECH_CONFIG.P1_FIRE_KEYWORDS);
      console.log('[Speech] P2 키워드:', SPEECH_CONFIG.P2_FIRE_KEYWORDS);
    }
    this.startP1();
    this.startP2();
  }

  /** P1 음성 인식 시작 */
  startP1() {
    if (!this._supported) return;
    this._p1Rec = this._createRecognition(0);
    this._p1Rec.start();
    this._startVU();
    console.log('[Speech] P1 recognition started');
  }

  /** P2 음성 인식 시작 */
  startP2() {
    if (!this._supported) return;
    this._p2Rec = this._createRecognition(1);
    this._p2Rec.start();
    console.log('[Speech] P2 recognition started');
  }

  // ── SpeechRecognition 인스턴스 생성 ───────────────────────────

  /**
   * @param {number} playerIndex  0 or 1
   */
  _createRecognition(playerIndex) {
    const rec = new this._SpeechRecognition();
    rec.lang        = SPEECH_CONFIG.LANG;
    rec.continuous  = SPEECH_CONFIG.CONTINUOUS;
    rec.interimResults = SPEECH_CONFIG.INTERIM;
    rec.maxAlternatives = 2;

    const keywords  = playerIndex === 0
      ? SPEECH_CONFIG.P1_FIRE_KEYWORDS
      : SPEECH_CONFIG.P2_FIRE_KEYWORDS;

    rec.onresult = (event) => {
      this._onResult(event, playerIndex, keywords);
    };

    rec.onerror = (e) => {
      console.warn(`[Speech] P${playerIndex + 1} error: ${e.error}`);
      // not-allowed: 마이크 권한 없음
      if (e.error === 'not-allowed') {
        alert('마이크 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.');
      }
    };

    rec.onend = () => {
      // 자동 재시작 (연속 인식 유지)
      if (!this._destroyed) {
        try { rec.start(); } catch (_) {}
      }
    };

    return rec;
  }

  // ── 인식 결과 처리 ────────────────────────────────────────────

  _onResult(event, playerIndex, keywords) {
    // 가장 최근 결과만 처리
    const result     = event.results[event.results.length - 1];
    const transcript = result[0].transcript.trim().toLowerCase();

    console.log(`[Speech] P${playerIndex + 1} heard: "${transcript}"`);

    const now      = Date.now();
    const cooldown = playerIndex === 0 ? this._p1LastFire : this._p2LastFire;

    if (now - cooldown < SPEECH_CONFIG.FIRE_COOLDOWN) return;

    // 키워드 매칭
    const matched = keywords.some(kw => transcript.includes(kw));
    if (matched) {
      console.log(`[Speech] P${playerIndex + 1} FIRE triggered!`);

      if (playerIndex === 0) this._p1LastFire = now;
      else                   this._p2LastFire = now;

      // 발사 이벤트
      this.players[playerIndex]?.fire();

      // HUD 인디케이터 점등
      this._flashIndicator();
    }
  }

  // ── VU 미터 (음량 시각화) ──────────────────────────────────────

  _buildVUGraphics() {
    this._vuGfx = this.scene.add.graphics().setDepth(25);
  }

  /** 마이크 AudioContext 시작 */
  async _startVU() {
    try {
      const stream     = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
      this._analyser   = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 64;
      this._vuData     = new Uint8Array(this._analyser.frequencyBinCount);

      const src = this._audioCtx.createMediaStreamSource(stream);
      src.connect(this._analyser);
      this._vuActive = true;
    } catch (e) {
      console.warn('[Speech] AudioContext failed:', e);
    }
  }

  /** 매 프레임 GameScene.update()에서 호출 */
  updateVU() {
    if (!this._vuActive || !this._analyser) return;

    this._analyser.getByteFrequencyData(this._vuData);
    const avg = this._vuData.reduce((s, v) => s + v, 0) / this._vuData.length;

    // 화면 하단 중앙 VU 바
    const g     = this._vuGfx;
    const bars  = 12;
    const bw    = 5;
    const gap   = 2;
    const baseX = GAME_WIDTH / 2 - (bars * (bw + gap)) / 2;
    const baseY = GAME_HEIGHT - 10;

    g.clear();
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor((i / bars) * this._vuData.length);
      const val = this._vuData[idx] / 255;
      const h   = Math.max(3, val * 28);
      const a   = 0.4 + val * 0.6;
      g.fillStyle(0x4fc3f7, a);
      g.fillRect(baseX + i * (bw + gap), baseY - h, bw, h);
    }
  }

  // ── HUD 인디케이터 ────────────────────────────────────────────

  _flashIndicator() {
    if (!this._indicator) return;
    this._indicator.classList.add('active');
    clearTimeout(this._indicatorTimer);
    this._indicatorTimer = setTimeout(() => {
      this._indicator.classList.remove('active');
    }, 500);
  }

  // ── 소멸 ──────────────────────────────────────────────────────

  destroy() {
    this._destroyed = true;

    try { this._p1Rec?.stop(); } catch (_) {}
    try { this._p2Rec?.stop(); } catch (_) {}

    this._audioCtx?.close();
    this._vuGfx?.destroy();
  }
}