/**
 * game.js
 * ─────────────────────────────────────────────────────────────────
 * Phase 4 업데이트:
 * - BootScene: background/floor/wall/char/gun 에셋 로드
 * - GameScene: 이미지 기반 배경/지형, BulletSystem 통합
 * - 라운드 종료 UI 연동
 * ─────────────────────────────────────────────────────────────────
 */

const GAME_WIDTH  = 960;
const GAME_HEIGHT = 540;
const GRAVITY_Y   = 1.8;

// ═══════════════════════════════════════════════════════════════
//  BootScene
// ═══════════════════════════════════════════════════════════════

class BootScene extends Phaser.Scene {
  constructor() { super({ key: 'BootScene' }); }

  preload() {
    // ── 이미지 에셋 로드 ──
    // 경로는 index.html 기준 상대 경로
    this.load.image('background', 'assets/background.png');
    this.load.image('floor',      'assets/floor.png');
    this.load.image('wall',       'assets/wall.png');
    this.load.image('char',       'assets/Char.png');
    this.load.image('gun',        'assets/Gun.png');

    // 로딩 바 (간단한 텍스트)
    const loadText = this.add.text(
      GAME_WIDTH / 2, GAME_HEIGHT / 2,
      'LOADING...',
      { fontSize: '20px', fontFamily: 'Courier New', color: '#ffffff' }
    ).setOrigin(0.5);

    this.load.on('complete', () => loadText.destroy());
  }

  create() {
    this.scene.start('GameScene');
  }
}

// ═══════════════════════════════════════════════════════════════
//  GameScene
// ═══════════════════════════════════════════════════════════════

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    this.players      = [];
    this._platforms   = [];
    this._bulletSystem = null;
  }

  // ── 씬 생성 ───────────────────────────────────────────────────

  create() {
    this._setupWorld();
    this._buildLevel();
    this._spawnPlayers();
    this._setupBullets();
    this._setupCamera();
    this._setupEvents();
    this._buildHUD();
  }

  // ── 월드 설정 ─────────────────────────────────────────────────

  _setupWorld() {
    this.matter.world.setGravity(0, GRAVITY_Y);

    // 월드 경계 (보이지 않는 벽/천장/바닥)
    this.matter.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT, 32, true, true, false, true);

    // ── 배경 이미지 ──
    // background.png를 전체 화면에 맞춤
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'background')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(0);
  }

  // ── 레벨 지형 ─────────────────────────────────────────────────

  /**
   * 플랫폼 정의: floor.png를 tileSprite로 타일링
   * 좌우 벽은 wall.png 타일링
   */
  _buildLevel() {
    const floorDefs = [
      // { x, y, w, h, angle(도) }  ← 물리 바디 기준
      { x: GAME_WIDTH / 2, y: GAME_HEIGHT - 20, w: GAME_WIDTH, h: 40,  angle: 0  }, // 바닥
      { x: 200,            y: 380,              w: 180,        h: 18,  angle: 0  },
      { x: 760,            y: 380,              w: 180,        h: 18,  angle: 0  },
      { x: GAME_WIDTH / 2, y: 300,              w: 220,        h: 18,  angle: 0  },
      { x: 140,            y: 220,              w: 140,        h: 18,  angle: -8 },
      { x: 820,            y: 220,              w: 140,        h: 18,  angle: 8  },
      { x: GAME_WIDTH / 2, y: 140,              w: 160,        h: 18,  angle: 0  },
    ];

    floorDefs.forEach(p => {
      // 물리 바디
      const body = this.matter.add.rectangle(p.x, p.y, p.w, p.h, {
        isStatic:    true,
        label:       'platform',
        friction:    0.4,
        restitution: 0.1,
        angle:       Phaser.Math.DegToRad(p.angle ?? 0),
        collisionFilter: {
          category: 0x0002,
          mask:     0x0001 | 0x0004,
        },
      });
      this._platforms.push(body);

      // 시각: tileSprite로 floor.png 타일링
      const tile = this.add.tileSprite(p.x, p.y, p.w, p.h, 'floor')
        .setAngle(p.angle ?? 0)
        .setDepth(2);

      // 바닥(첫 번째)은 살짝 어둡게
      if (p.y > GAME_HEIGHT - 50) {
        tile.setAlpha(0.85);
      }
    });

    // ── 좌우 벽 (wall.png) ──
    const wallH = GAME_HEIGHT;
    const wallW = 32;

    // 왼쪽 벽
    this.add.tileSprite(wallW / 2, GAME_HEIGHT / 2, wallW, wallH, 'wall').setDepth(2);
    // 오른쪽 벽
    this.add.tileSprite(GAME_WIDTH - wallW / 2, GAME_HEIGHT / 2, wallW, wallH, 'wall').setDepth(2);
  }

  // ── 플레이어 스폰 ─────────────────────────────────────────────

  _spawnPlayers() {
    // P1: WASD, 원본 색조
    this.players[0] = new Player(this, 200, 300, {
      playerIndex: 0,
      isLocal:     true,
      tint:        0xffffff,      // 원본 색상 유지
      controls:    { left: 'A', right: 'D', jump: 'W' },
    });

    // P2: 방향키, 오렌지 tint
    this.players[1] = new Player(this, 760, 300, {
      playerIndex: 1,
      isLocal:     true,
      tint:        0xff8c69,      // 오렌지 계열
      controls:    { left: 'LEFT', right: 'RIGHT', jump: 'UP' },
    });
  }

  // ── 탄환 시스템 ───────────────────────────────────────────────

  _setupBullets() {
    this._bulletSystem = new BulletSystem(this, this.players);
  }

  // ── 카메라 ────────────────────────────────────────────────────

  _setupCamera() {
    this.cameras.main.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }

  // ── 이벤트 ────────────────────────────────────────────────────

  _setupEvents() {
    this.events.on('player_dead', (data) => {
      this._onPlayerDead(data.playerIndex);
    });
  }

  // ── HUD ───────────────────────────────────────────────────────

  _buildHUD() {
    this._hpBars = this.players.map((player, i) => new HPBar(this, i, player));

    // 음성 인식 시스템
    this._speechManager = new SpeechManager(this, this.players);

    // 마이크 시작 버튼
    this._buildMicStartButton();
  }

  _buildMicStartButton() {
    const btn = document.createElement('button');
    btn.id        = 'mic-start-btn';
    btn.innerText = '🎤 마이크 ON';

    btn.onclick = () => {
      this._speechManager.startAll();   // P1, P2 모두 시작
      btn.innerText   = '🎤 인식 중...';
      btn.style.color = '#4fc3f7';
      btn.style.borderColor = '#4fc3f7';
      btn.disabled    = true;
    };

    document.getElementById('game-container').appendChild(btn);
    this._micBtn = btn;
  }

  // ── 라운드 종료 ───────────────────────────────────────────────

  _onPlayerDead(playerIndex) {
    const winner     = playerIndex === 0 ? 'P2' : 'P1';
    const color      = playerIndex === 0 ? '#ff7043' : '#4fc3f7';
    const resultEl   = document.getElementById('round-result');
    const winnerText = document.getElementById('round-winner-text');

    if (resultEl && winnerText) {
      winnerText.textContent  = `${winner} WINS`;
      winnerText.style.color  = color;
      resultEl.classList.add('active');
    }

    // 3초 후 씬 재시작
    this.time.delayedCall(3000, () => {
      resultEl?.classList.remove('active');
      this.scene.restart();
    });
  }

  // ── 업데이트 루프 ─────────────────────────────────────────────

  update(time, delta) {
    this.players.forEach(p => p.update(delta));
    this._bulletSystem?.update(delta);
    this._hpBars?.forEach(bar => bar.update());
    this._speechManager?.updateVU();
  }

  // ── 씬 종료 시 정리 ───────────────────────────────────────────

  shutdown() {
    this._speechManager?.destroy();
    this._bulletSystem?.destroy();
    this._micBtn?.remove();
  }
}

// ═══════════════════════════════════════════════════════════════
//  HPBar
// ═══════════════════════════════════════════════════════════════

class HPBar {
  constructor(scene, playerIndex, player) {
    this.scene       = scene;
    this.player      = player;
    this.playerIndex = playerIndex;

    const isLeft = playerIndex === 0;
    const x      = isLeft ? 24 : GAME_WIDTH - 24;
    const y      = 24;
    const color  = playerIndex === 0 ? '#4fc3f7' : '#ff7043';

    this.label = scene.add.text(x, y, `P${playerIndex + 1}`, {
      fontSize:   '12px',
      fontFamily: 'Courier New',
      color,
    }).setOrigin(isLeft ? 0 : 1, 0.5).setDepth(20);

    this.bgBar = scene.add.graphics().setDepth(20);
    this.fgBar = scene.add.graphics().setDepth(20);

    this.x        = x;
    this.y        = y + 14;
    this.barW     = 120;
    this.barH     = 8;
    this.isLeft   = isLeft;
    this._color   = playerIndex === 0 ? 0x4fc3f7 : 0xff7043;

    this.update();
  }

  update() {
    const ratio = this.player.hp / 100;
    const x     = this.isLeft ? this.x : this.x - this.barW;

    this.bgBar.clear();
    this.bgBar.fillStyle(0x222222, 0.8);
    this.bgBar.fillRoundedRect(x, this.y, this.barW, this.barH, 3);

    this.fgBar.clear();
    this.fgBar.fillStyle(this._color, 1);
    this.fgBar.fillRoundedRect(x, this.y, this.barW * ratio, this.barH, 3);
  }
}

// ═══════════════════════════════════════════════════════════════
//  Phaser 게임 인스턴스
// ═══════════════════════════════════════════════════════════════

const config = {
  type:            Phaser.AUTO,
  width:           GAME_WIDTH,
  height:          GAME_HEIGHT,
  parent:          'game-container',
  backgroundColor: '#0a0a0a',

  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: GRAVITY_Y },
      debug:   false,
      positionIterations: 10,
      velocityIterations: 10,
    },
  },

  scene: [BootScene, GameScene],

  pixelArt:    false,
  roundPixels: true,

  scale: {
    mode:      Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width:     GAME_WIDTH,
    height:    GAME_HEIGHT,
  },
};

const game = new Phaser.Game(config);