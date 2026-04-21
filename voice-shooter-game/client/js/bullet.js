/**
 * ─────────────────────────────────────────────────────────────────
 * - Matter.js 물리 기반 탄환
 * - 벽/바닥/플랫폼 튕김 (최대 MAX_BOUNCES 회)
 * - 트레일 이펙트
 * - 히트 판정 및 데미지
 * - 네트워크 직렬화 지원
 * ─────────────────────────────────────────────────────────────────
 */

const BULLET_CONFIG = {
  SPEED:       18,
  MAX_BOUNCES: 3,
  RADIUS:      5,
  DAMAGE:      20,
  LIFETIME:    5000,
  GRAVITY:     0.3,
  RESTITUTION: 0.88,
  TRAIL_LEN:   14,
  COLORS: [0x4fc3f7, 0xff7043],
};

// ═══════════════════════════════════════════════════════════════
//  BulletSystem
// ═══════════════════════════════════════════════════════════════

class BulletSystem {
  constructor(scene, players) {
    this.scene   = scene;
    this.players = players;
    this.bullets = [];

    this._setupCollision();

    scene.events.on('player_fire', (data) => {
      this.spawnBullet(data);
    });
  }

  _setupCollision() {
    this.scene.matter.world.on('collisionstart', (event) => {
      event.pairs.forEach((pair) => {
        this._handleCollisionPair(pair.bodyA, pair.bodyB);
        this._handleCollisionPair(pair.bodyB, pair.bodyA);
      });
    });
  }

  _handleCollisionPair(bodyA, bodyB) {
    if (!bodyA.label || !bodyA.label.startsWith('bullet_')) return;

    const bullet = this.bullets.find(b => b.physBody === bodyA);
    if (!bullet || bullet.isDead) return;

    // ── 플레이어 히트 ──
    if (bodyB.label && bodyB.label.startsWith('player_')) {
      const targetIndex = parseInt(bodyB.label.split('_')[1]);
      // 자기 발사 직후 무적 처리
      if (targetIndex === bullet.ownerIndex && bullet.isOwnerImmune) return;
      this.players[targetIndex]?.takeDamage(BULLET_CONFIG.DAMAGE);
      bullet.destroy();
      return;
    }

    // ── 플랫폼/벽 히트 → 튕김 ──
    // setBounds()가 생성하는 바디는 label이 없거나 다양함
    // → player/bullet 이 아닌 모든 정적 바디에 튕김 적용
    const isStatic = bodyB.isStatic;
    const label    = bodyB.label ?? '';
    const isBounceTarget =
      label === 'platform' ||
      label === 'wall_body' ||
      label.startsWith('wall') ||
      label === '' && isStatic ||
      isStatic;

    if (isBounceTarget) {
      bullet.bounceCount++;
      bullet._spawnBounceEffect();
      if (bullet.bounceCount > BULLET_CONFIG.MAX_BOUNCES) {
        bullet.destroy();
      }
    }
  }

  spawnBullet(data) {
    const bullet = new Bullet(this.scene, {
      x:          data.x,
      y:          data.y,
      angle:      data.angle,
      ownerIndex: data.playerIndex,
      bulletId:   data.bulletId,
    });
    this.bullets.push(bullet);
    return bullet;
  }

  update(delta) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.update(delta);
      if (b.isDead) {
        this.bullets.splice(i, 1);
      }
    }
  }

  destroy() {
    this.bullets.forEach(b => b.destroy());
    this.bullets = [];
  }
}

// ═══════════════════════════════════════════════════════════════
//  Bullet
// ═══════════════════════════════════════════════════════════════

class Bullet {
  constructor(scene, opts = {}) {
    this.scene       = scene;
    this.ownerIndex  = opts.ownerIndex ?? 0;
    this.bulletId    = opts.bulletId ?? `b_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.bounceCount = 0;
    this.isDead      = false;
    this._age        = 0;
    this._trail      = [];

    this.isOwnerImmune = true;
    scene.time.delayedCall(200, () => { this.isOwnerImmune = false; });

    this._buildBody(opts.x, opts.y, opts.angle ?? 0);
    this._buildGraphics();
  }

  _buildBody(x, y, angle) {
    const vx = Math.cos(angle) * BULLET_CONFIG.SPEED;
    const vy = Math.sin(angle) * BULLET_CONFIG.SPEED;

    this.physBody = this.scene.matter.add.circle(x, y, BULLET_CONFIG.RADIUS, {
      label:        `bullet_${this.bulletId}`,
      restitution:  BULLET_CONFIG.RESTITUTION,
      friction:     0,
      frictionAir:  0,
      density:      0.001,
      gravityScale: { x: 0, y: BULLET_CONFIG.GRAVITY },
      collisionFilter: {
        category: 0x0004,
        mask:     0x0001 | 0x0002,
      },
    });

    Phaser.Physics.Matter.Matter.Body.setVelocity(this.physBody, { x: vx, y: vy });
  }

  _buildGraphics() {
    this.trailGfx = this.scene.add.graphics().setDepth(4);
    this.gfx      = this.scene.add.graphics().setDepth(5);
    this._color   = BULLET_CONFIG.COLORS[this.ownerIndex] ?? 0xffffff;
  }

  update(delta) {
    if (this.isDead) return;

    this._age += delta;
    if (this._age > BULLET_CONFIG.LIFETIME) {
      this.destroy();
      return;
    }

    const px = this.physBody.position.x;
    const py = this.physBody.position.y;

    this._trail.push({ x: px, y: py });
    if (this._trail.length > BULLET_CONFIG.TRAIL_LEN) {
      this._trail.shift();
    }

    this._draw(px, py);
  }

  _draw(px, py) {
    const c = this._color;
    const r = BULLET_CONFIG.RADIUS;

    this.trailGfx.clear();
    for (let i = 1; i < this._trail.length; i++) {
      const t    = i / this._trail.length;
      const pt   = this._trail[i];
      const prev = this._trail[i - 1];
      this.trailGfx.lineStyle(r * 2 * t, c, t * 0.6);
      this.trailGfx.beginPath();
      this.trailGfx.moveTo(prev.x, prev.y);
      this.trailGfx.lineTo(pt.x, pt.y);
      this.trailGfx.strokePath();
    }

    this.gfx.clear();
    this.gfx.fillStyle(c, 0.25);
    this.gfx.fillCircle(px, py, r * 2.5);
    this.gfx.fillStyle(c, 1);
    this.gfx.fillCircle(px, py, r);
    this.gfx.fillStyle(0xffffff, 0.9);
    this.gfx.fillCircle(px, py, r * 0.45);
  }

  _spawnBounceEffect() {
    const px    = this.physBody.position.x;
    const py    = this.physBody.position.y;
    const color = this._color;
    const spark = this.scene.add.graphics().setDepth(6);
    const pts   = Array.from({ length: 6 }, () => ({
      x: px, y: py,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5 - 1.5,
    }));
    let life = 0;

    const timer = this.scene.time.addEvent({
      delay: 16, repeat: 10,
      callback: () => {
        life++;
        spark.clear();
        pts.forEach(s => {
          s.x += s.vx; s.y += s.vy; s.vy += 0.35;
          spark.fillStyle(color, 1 - life / 10);
          spark.fillCircle(s.x, s.y, 2.5);
        });
        if (life >= 10) { spark.destroy(); timer.remove(); }
      },
    });
  }

  destroy() {
    if (this.isDead) return;
    this.isDead = true;
    this._spawnHitEffect();
    try { this.scene.matter.world.remove(this.physBody); } catch (_) {}
    this.scene.time.delayedCall(100, () => {
      this.gfx?.destroy();
      this.trailGfx?.destroy();
    });
  }

  _spawnHitEffect() {
    const px    = this.physBody.position.x;
    const py    = this.physBody.position.y;
    const color = this._color;
    const g     = this.scene.add.graphics().setDepth(7);
    let r = BULLET_CONFIG.RADIUS;
    let a = 1.0;

    const ev = this.scene.time.addEvent({
      delay: 16, repeat: 8,
      callback: () => {
        g.clear(); r += 3; a -= 0.13;
        if (a <= 0) { g.destroy(); ev.remove(); return; }
        g.lineStyle(2, color, a);
        g.strokeCircle(px, py, r);
        g.fillStyle(color, a * 0.25);
        g.fillCircle(px, py, r * 0.5);
      },
    });
  }

  serialize() {
    return {
      bulletId:    this.bulletId,
      ownerIndex:  this.ownerIndex,
      x:           this.physBody.position.x,
      y:           this.physBody.position.y,
      vx:          this.physBody.velocity.x,
      vy:          this.physBody.velocity.y,
      bounceCount: this.bounceCount,
    };
  }

  applySnapshot(snap) {
    Phaser.Physics.Matter.Matter.Body.setPosition(this.physBody, { x: snap.x, y: snap.y });
    Phaser.Physics.Matter.Matter.Body.setVelocity(this.physBody, { x: snap.vx, y: snap.vy });
    this.bounceCount = snap.bounceCount;
  }
}