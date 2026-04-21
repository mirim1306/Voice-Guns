/**
 * ─────────────────────────────────────────────────────────────────
 * Phase 3: 음성 인식 시스템 (개선판)
 * - 음성 인식 정확도 향상: 다양한 키워드 변형 + 음소 유사도 매칭
 * - 발사 딜레이: 1~2초 랜덤 딜레이 + 한 발씩 발사
 * - Web Speech API (Chrome 권장)
 * ─────────────────────────────────────────────────────────────────
 */

const SPEECH_CONFIG = {
  P1_FIRE_KEYWORDS: ['불', 'fire'],
  P2_FIRE_KEYWORDS: ['빵', 'shoot'],
  LANG: 'ko-KR',
  CONTINUOUS: true,
  INTERIM:    true,
  VU_UPDATE_MS: 50,
  FIRE_COOLDOWN: 2500,
};

const FIRE_DELAY_MIN = 1000;
const FIRE_DELAY_MAX = 2000;

// P1 '불' 발음 유사어
const P1_KEYWORD_VARIANTS = [
  '불', '뿔', '풀', '볼', '불꽃', '불이', '불을', '불로', '불이야', '불이요',
  'fire', 'fir', 'far', 'fur', 'fired', 'fires', 'hire', 'higher',
  'buyer', 'five', 'fine', 'file', '파이어', '화이어', '화이',
];

// P2 '빵' 발음 유사어
const P2_KEYWORD_VARIANTS = [
  '빵', '방', '뱅', '팡', '빵야', '빵빵', '방방', '탕', '탕탕',
  'shoot', 'shoo', 'shoe', 'shot', 'short',
  'bang', 'boom', 'bam', 'pang',
  '슛', '슈트', '빵야야', '탕탕',
];

function stringSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const getTrigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ta = getTrigrams(a);
  const tb = getTrigrams(b);
  let intersection = 0;
  ta.forEach(t => { if (tb.has(t)) intersection++; });
  return (2 * intersection) / (ta.size + tb.size);
}

function matchesKeywords(transcript, keywords, threshold) {
  threshold = threshold || 0.55;
  const t = transcript.toLowerCase().trim();
  if (keywords.some(kw => t.includes(kw.toLowerCase()))) return true;
  const tokens = t.split(/[\s,\.!?]+/).filter(Boolean);
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    for (var j = 0; j < keywords.length; j++) {
      var kwLow = keywords[j].toLowerCase();
      if (token === kwLow) return true;
      if (token.length >= 2 && kwLow.length >= 2) {
        var sim = stringSimilarity(token, kwLow);
        if (sim >= threshold) {
          console.log('[Speech] 유사 매칭: "' + token + '" ~ "' + keywords[j] + '" (' + (sim*100).toFixed(0) + '%)');
          return true;
        }
      }
    }
  }
  return false;
}

class SpeechManager {
  constructor(scene, players) {
    this.scene    = scene;
    this.players  = players;

    this._sharedRec  = null;
    this._p1LastFire = 0;
    this._p2LastFire = 0;
    this._p1Pending  = false;
    this._p2Pending  = false;

    this._audioCtx  = null;
    this._analyser  = null;
    this._vuData    = null;
    this._vuGfx     = null;
    this._vuActive  = false;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[Speech] Web Speech API not supported in this browser.');
      this._supported = false;
      return;
    }

    this._SpeechRecognition = SpeechRecognition;
    this._supported = true;

    this._indicator = document.getElementById('voice-indicator');
    this._buildVUGraphics();
  }

  startAll() {
    if (!this._supported) return;

    if (window.VOICE_KEYWORDS) {
      SPEECH_CONFIG.P1_FIRE_KEYWORDS = window.VOICE_KEYWORDS.p1;
      SPEECH_CONFIG.P2_FIRE_KEYWORDS = window.VOICE_KEYWORDS.p2;
    }

    this._p1Keywords = SPEECH_CONFIG.P1_FIRE_KEYWORDS.concat(P1_KEYWORD_VARIANTS);
    this._p2Keywords = SPEECH_CONFIG.P2_FIRE_KEYWORDS.concat(P2_KEYWORD_VARIANTS);

    console.log('[Speech] P1 키워드:', this._p1Keywords);
    console.log('[Speech] P2 키워드:', this._p2Keywords);

    this._sharedRec = this._createSharedRecognition();
    this._sharedRec.start();
    this._startVU();
  }

  startP1() {}
  startP2() {}

  _createSharedRecognition() {
    const rec = new this._SpeechRecognition();
    rec.lang             = SPEECH_CONFIG.LANG;
    rec.continuous       = true;
    rec.interimResults   = true;
    rec.maxAlternatives  = 8;

    rec.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcripts = [];
      for (let i = 0; i < result.length; i++) {
        transcripts.push(result[i].transcript.trim().toLowerCase());
      }
      console.log('[Speech] 인식 후보:', transcripts);

      const now = Date.now();

      if (!this._p1Pending && now - this._p1LastFire >= SPEECH_CONFIG.FIRE_COOLDOWN) {
        const p1matched = transcripts.some(t => matchesKeywords(t, this._p1Keywords));
        if (p1matched) {
          console.log('[Speech] P1 발사 대기중...');
          this._p1LastFire = now;
          this._p1Pending  = true;
          this._flashIndicator('P1 준비중...');

          const delay = FIRE_DELAY_MIN + Math.random() * (FIRE_DELAY_MAX - FIRE_DELAY_MIN);
          this.scene.time.delayedCall(delay, () => {
            this.players[0] && this.players[0].fire();
            this._p1Pending = false;
            this._flashIndicator('P1 발사!');
            console.log('[Speech] P1 발사! (' + delay.toFixed(0) + 'ms 딜레이)');
          });
        }
      }

      if (!this._p2Pending && now - this._p2LastFire >= SPEECH_CONFIG.FIRE_COOLDOWN) {
        const p2matched = transcripts.some(t => matchesKeywords(t, this._p2Keywords));
        if (p2matched) {
          console.log('[Speech] P2 발사 대기중...');
          this._p2LastFire = now;
          this._p2Pending  = true;
          this._flashIndicator('P2 준비중...');

          const delay = FIRE_DELAY_MIN + Math.random() * (FIRE_DELAY_MAX - FIRE_DELAY_MIN);
          this.scene.time.delayedCall(delay, () => {
            this.players[1] && this.players[1].fire();
            this._p2Pending = false;
            this._flashIndicator('P2 발사!');
            console.log('[Speech] P2 발사! (' + delay.toFixed(0) + 'ms 딜레이)');
          });
        }
      }
    };

    rec.onerror = (e) => {
      console.warn('[Speech] error:', e.error);
      if (e.error === 'not-allowed') {
        alert('마이크 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.');
      }
    };

    rec.onend = () => {
      if (!this._destroyed) {
        try { rec.start(); } catch (_) {}
      }
    };

    return rec;
  }

  _buildVUGraphics() {
    this._vuGfx = this.scene.add.graphics().setDepth(25);
  }

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

  updateVU() {
    if (!this._vuActive || !this._analyser) return;
    this._analyser.getByteFrequencyData(this._vuData);

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
      const col = (this._p1Pending || this._p2Pending) ? 0xffa726 : 0x4fc3f7;
      g.fillStyle(col, a);
      g.fillRect(baseX + i * (bw + gap), baseY - h, bw, h);
    }
  }

  _flashIndicator(who) {
    who = who || '';
    if (!this._indicator) return;
    this._indicator.textContent = who ? ('🎤 ' + who) : '🎤 FIRE';
    this._indicator.classList.add('active');
    clearTimeout(this._indicatorTimer);
    this._indicatorTimer = setTimeout(() => {
      this._indicator.classList.remove('active');
    }, 800);
  }

  destroy() {
    this._destroyed = true;
    try { this._sharedRec && this._sharedRec.stop(); } catch (_) {}
    this._audioCtx && this._audioCtx.close();
    this._vuGfx && this._vuGfx.destroy();
  }
}
