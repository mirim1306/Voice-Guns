/**
 * ─────────────────────────────────────────────────────────────────
 * - BootScene: 에셋 로드
 * - GameScene: 이미지 기반 배경/지형, BulletSystem + NetworkManager 통합
 * - 라운드 종료 UI
 * - 마우스 입력 비활성화 (facingDir 수평 고정 발사)
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
    this.load.image('background', '../assets/images/background.png');
    this.load.image('floor',      '../assets/images/floor.png');
    this.load.image('wall',       '../assets/images/wall.png');
    this.load.image('char',       '../assets/images/Char.png');
    this.load.image('gun',        '../assets/images/Gun.png');

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
    this.players       = [];
    this._platforms    = [];
    this._bulletSystem = null;
    this._netManager   = null;
  }

  create() {
    this._setupWorld();
    this._buildLevel();
    this._spawnPlayers();
    this._setupBullets();
    this._setupNetwork();
    this._setupCamera();
    this._setupEvents();
    this._buildHUD();
  }

  // ── 월드 ──────────────────────────────────────────────────────

  _setupWorld() {
    this.matter.world.setGravity(0, GRAVITY_Y);
    // 아래쪽 경계만 (좌우는 player.js update()에서 클램프 처리)
    this.matter.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT, 32, false, false, false, true);

    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'background')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(0);

    // 마우스 커서 기본값 유지 (조준과 무관)
    this.input.mouse?.disableContextMenu();
  }

  // ── 레벨 ──────────────────────────────────────────────────────

  _buildLevel() {
    const floorDefs = [
      { x: GAME_WIDTH / 2, y: GAME_HEIGHT - 20, w: GAME_WIDTH, h: 40,  angle: 0  },
      { x: 200,            y: 380,              w: 180,        h: 18,  angle: 0  },
      { x: 760,            y: 380,              w: 180,        h: 18,  angle: 0  },
      { x: GAME_WIDTH / 2, y: 300,              w: 220,        h: 18,  angle: 0  },
      { x: 140,            y: 220,              w: 140,        h: 18,  angle: -8 },
      { x: 820,            y: 220,              w: 140,        h: 18,  angle: 8  },
      { x: GAME_WIDTH / 2, y: 140,              w: 160,        h: 18,  angle: 0  },
    ];

    floorDefs.forEach((p, idx) => {
      const body = this.matter.add.rectangle(p.x, p.y, p.w, p.h, {
        isStatic:    true,
        label:       idx === 0 ? 'ground' : 'platform',
        friction:    0.4,
        restitution: 0.1,
        angle:       Phaser.Math.DegToRad(p.angle ?? 0),
        collisionFilter: {
          category: 0x0002,
          mask:     0x0001 | 0x0004,
        },
      });
      // 공중 플랫폼은 단방향 (위에서만 충돌) 플래그 저장
      body.isOneWay = idx !== 0;
      this._platforms.push({ x: p.x, y: p.y, w: p.w, h: p.h, angle: p.angle ?? 0, body, isOneWay: body.isOneWay });

      this.add.tileSprite(p.x, p.y, p.w, p.h, 'floor')
        .setAngle(p.angle ?? 0)
        .setDepth(2)
        .setAlpha(p.y > GAME_HEIGHT - 50 ? 0.85 : 1);
    });

    // 좌우 벽 없음 — player.js update()에서 화면 밖 클램프 처리
  }

  // ── 플레이어 스폰 ─────────────────────────────────────────────

  _spawnPlayers() {
    // 멀티 환경에서는 NetworkManager._onRoomJoined()가 isLocal을 재설정함
    // 초기엔 둘 다 isLocal=true 로 스폰 (오프라인 테스트 호환)
    this.players[0] = new Player(this, 220, 300, {
      playerIndex: 0,
      isLocal:     true,
      tint:        0xffffff,
      controls:    { left: 'A', right: 'D', jump: 'W', down: 'S' },
    });

    this.players[1] = new Player(this, 740, 300, {
      playerIndex: 1,
      isLocal:     true,
      tint:        0xff8c69,
      controls:    { left: 'LEFT', right: 'RIGHT', jump: 'UP', down: 'DOWN' },
    });
  }

  // ── 시스템 설정 ───────────────────────────────────────────────

  _setupBullets() {
    this._bulletSystem = new BulletSystem(this, this.players);
  }

  _setupNetwork() {
    this._netManager = new NetworkManager(this, this.players, this._bulletSystem);
  }

  _setupCamera() {
    this.cameras.main.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }

  _setupEvents() {
    this.events.on('player_dead', (data) => {
      this._onPlayerDead(data.playerIndex);
    });

    // 네트워크 게임 시작 신호 (2명 모두 입장 시)
    this.events.on('network_game_start', () => {
      console.log('[Game] 네트워크 게임 시작!');
    });
  }

  // ── HUD ───────────────────────────────────────────────────────

  _buildHUD() {
    this._hpBars = this.players.map((player, i) => new HPBar(this, i, player));
    this._speechManager = new SpeechManager(this, this.players);
    this._buildMicStartButton();
  }

  _buildMicStartButton() {
    // 씬 재시작 시 중복 방지
    document.getElementById('mic-start-btn')?.remove();

    const btn = document.createElement('button');
    btn.id        = 'mic-start-btn';
    btn.innerText = '🎤 마이크 ON';

    btn.onclick = () => {
      this._speechManager.startAll();
      btn.innerText         = '🎤 인식 중...';
      btn.style.color       = '#4fc3f7';
      btn.style.borderColor = '#4fc3f7';
      btn.disabled          = true;
    };

    document.getElementById('game-container')?.appendChild(btn);
    this._micBtn = btn;
  }

  // ── 라운드 종료 ───────────────────────────────────────────────

  _onPlayerDead(playerIndex) {
    const winner     = playerIndex === 0 ? 'P2' : 'P1';
    const color      = playerIndex === 0 ? '#ff7043' : '#4fc3f7';
    const resultEl   = document.getElementById('round-result');
    const winnerText = document.getElementById('round-winner-text');

    if (resultEl && winnerText) {
      winnerText.textContent = `${winner} WINS`;
      winnerText.style.color = color;
      resultEl.classList.add('active');
    }

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
    this._netManager?.update(delta);
  }

  // ── 씬 종료 정리 ──────────────────────────────────────────────

  shutdown() {
    this._speechManager?.destroy();
    this._bulletSystem?.destroy();
    this._netManager?.destroy();
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

    this.x      = x;
    this.y      = y + 14;
    this.barW   = 120;
    this.barH   = 8;
    this.isLeft = isLeft;
    this._color = playerIndex === 0 ? 0x4fc3f7 : 0xff7043;

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
    mode:       Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width:      GAME_WIDTH,
    height:     GAME_HEIGHT,
  },
};

// initGame()은 index.html 시작 화면에서 호출
function initGame() {
  new Phaser.Game(config);
}