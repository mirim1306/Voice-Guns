/**
 * player.js
 * ─────────────────────────────────────────────────────────────────
 * - Char.png 스프라이트 (flipX로 방향 전환)
 * - Gun.png 스프라이트 (facingDir 방향 수평 고정)
 * - 마우스 조준 제거 → facingDir 방향으로 수평 발사
 * - 발사 시 반동
 * - 피격 시 tint 플래시
 * - Phase 5: 네트워크 직렬화 완성
 * ─────────────────────────────────────────────────────────────────
 */

const CHAR_DISPLAY_SIZE = 52;
const GUN_DISPLAY_W     = 40;
const GUN_DISPLAY_H     = 28;
const GUN_OFFSET_X      = 20;
const GUN_OFFSET_Y      = 4;

class Player {
  /**
   * @param {Phaser.Scene} scene
   * @param {number}       x
   * @param {number}       y
   * @param {object}       opts
   *   opts.playerIndex  0 or 1
   *   opts.isLocal      boolean
   *   opts.tint         색조
   *   opts.controls     { left, right, jump }
   */
  constructor(scene, x, y, opts = {}) {
    this.scene       = scene;
    this.playerIndex = opts.playerIndex ?? 0;
    this.isLocal     = opts.isLocal ?? true;

    // ── 물리 상수 ──
    this.MOVE_FORCE      = 0.0055;
    this.MAX_SPEED_X     = 5.5;
    this.JUMP_VELOCITY   = -11.5;
    this.GRAVITY_SCALE   = 2.2;
    this.AIR_DAMPING     = 0.015;
    this.GROUND_FRICTION = 0.18;
    this.RECOIL_FORCE    = 0.028;

    // ── 점프 보조 ──
    this.COYOTE_TIME     = 120;
    this.JUMP_BUFFER     = 100;
    this._coyoteTimer    = 0;
    this._jumpBuffer     = 0;
    this._onGround       = false;
    this._groundContacts = 0;

    // ── 상태 ──
    this.hp        = 100;
    this.isDead    = false;
    this.facingDir = this.playerIndex === 0 ? 1 : -1;

    // ── 조준각: 항상 facingDir 수평 ──
    this._aimAngle = this.facingDir > 0 ? 0 : Math.PI;

    // ── 시각 ──
    this.tintColor = opts.tint ?? (this.playerIndex === 0 ? 0xffffff : 0xff8c69);

    // ── 빌드 ──
    this._buildBody(x, y);
    this._buildSprites();
    this._buildGroundSensor();

    if (this.isLocal) {
      this._bindControls(opts.controls);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  초기화
  // ═══════════════════════════════════════════════════════════════

  _buildBody(x, y) {
    const r = CHAR_DISPLAY_SIZE / 2 - 2;

    this.body = this.scene.matter.add.circle(x, y, r, {
      label:          `player_${this.playerIndex}`,
      frictionAir:    this.AIR_DAMPING,
      friction:       this.GROUND_FRICTION,
      restitution:    0.05,
      density:        0.004,
      gravityScale:   { x: 0, y: this.GRAVITY_SCALE },
      inertia:        Infinity,
      inverseInertia: 0,
      collisionFilter: {
        category: 0x0001,
        mask:     0x0002 | 0x0004,
      },
    });

    this.body.gameObject = this;
  }

  _buildSprites() {
    const x = this.body.position.x;
    const y = this.body.position.y;

    this.charSprite = this.scene.add.image(x, y, 'char')
      .setDisplaySize(CHAR_DISPLAY_SIZE, CHAR_DISPLAY_SIZE)
      .setOrigin(0.5, 0.5)
      .setDepth(10)
      .setTint(this.tintColor);

    this.gunSprite = this.scene.add.image(x, y, 'gun')
      .setDisplaySize(GUN_DISPLAY_W, GUN_DISPLAY_H)
      .setOrigin(0.15, 0.6)
      .setDepth(11)
      .setTint(this.tintColor);
  }

  _buildGroundSensor() {
    const r = CHAR_DISPLAY_SIZE / 2 - 2;

    this._groundSensor = this.scene.matter.add.rectangle(
      this.body.position.x,
      this.body.position.y + r + 3,
      r * 1.5, 6,
      {
        isSensor: true,
        label:    `ground_sensor_${this.playerIndex}`,
        collisionFilter: { category: 0x0001, mask: 0x0002 },
      }
    );

    this.scene.matter.add.constraint(this.body, this._groundSensor, 0, 1);

    this.scene.matter.world.on('collisionstart', (event) => {
      event.pairs.forEach((pair) => {
        if (pair.bodyA === this._groundSensor || pair.bodyB === this._groundSensor) {
          this._groundContacts++;
        }
      });
    });

    this.scene.matter.world.on('collisionend', (event) => {
      event.pairs.forEach((pair) => {
        if (pair.bodyA === this._groundSensor || pair.bodyB === this._groundSensor) {
          this._groundContacts = Math.max(0, this._groundContacts - 1);
        }
      });
    });
  }

  _bindControls(controlMap) {
    const defaults = [
      { left: 'A',    right: 'D',     jump: 'W'  },
      { left: 'LEFT', right: 'RIGHT', jump: 'UP' },
    ];
    const map = controlMap ?? defaults[this.playerIndex];

    this.keys = this.scene.input.keyboard.addKeys({
      left:  map.left,
      right: map.right,
      jump:  map.jump,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  메인 업데이트
  // ═══════════════════════════════════════════════════════════════

  update(delta) {
    if (this.isDead) return;

    this._updateGroundState(delta);

    if (this.isLocal) {
      this._handleMovement();
      this._handleJump();
    }

    // 항상 facingDir에 따라 조준각 동기화
    this._aimAngle = this.facingDir > 0 ? 0 : Math.PI;

    this._syncSprites();
  }

  // ═══════════════════════════════════════════════════════════════
  //  물리 / 이동
  // ═══════════════════════════════════════════════════════════════

  _updateGroundState(delta) {
    const wasOnGround = this._onGround;
    this._onGround    = this._groundContacts > 0;

    if (wasOnGround && !this._onGround) {
      this._coyoteTimer = this.COYOTE_TIME;
    } else if (this._onGround) {
      this._coyoteTimer = 0;
      if (this._jumpBuffer > 0) {
        this._doJump();
        this._jumpBuffer = 0;
      }
    } else {
      this._coyoteTimer = Math.max(0, this._coyoteTimer - delta);
    }
    this._jumpBuffer = Math.max(0, this._jumpBuffer - delta);
  }

  _handleMovement() {
    const { left, right } = this.keys;
    const vel = this.body.velocity;

    if (left.isDown) {
      this.facingDir = -1;
      if (vel.x > -this.MAX_SPEED_X) {
        Phaser.Physics.Matter.Matter.Body.applyForce(
          this.body, this.body.position, { x: -this.MOVE_FORCE, y: 0 }
        );
      }
    } else if (right.isDown) {
      this.facingDir = 1;
      if (vel.x < this.MAX_SPEED_X) {
        Phaser.Physics.Matter.Matter.Body.applyForce(
          this.body, this.body.position, { x: this.MOVE_FORCE, y: 0 }
        );
      }
    } else {
      Phaser.Physics.Matter.Matter.Body.setVelocity(this.body, {
        x: vel.x * (this._onGround ? 0.78 : 0.92),
        y: vel.y,
      });
    }
  }

  _handleJump() {
    const jumpPressed = Phaser.Input.Keyboard.JustDown(this.keys.jump);
    if (jumpPressed) {
      const canJump = this._onGround || this._coyoteTimer > 0;
      if (canJump) {
        this._doJump();
        this._coyoteTimer = 0;
      } else {
        this._jumpBuffer = this.JUMP_BUFFER;
      }
    }
  }

  _doJump() {
    Phaser.Physics.Matter.Matter.Body.setVelocity(this.body, {
      x: this.body.velocity.x,
      y: this.JUMP_VELOCITY,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  스프라이트 동기화
  // ═══════════════════════════════════════════════════════════════

  _syncSprites() {
    const px = this.body.position.x;
    const py = this.body.position.y;

    this.charSprite.setPosition(px, py);
    this.charSprite.setFlipX(this.facingDir < 0);

    // 총 위치: 수평 오프셋만 적용
    const gunX = px + this.facingDir * GUN_OFFSET_X;
    const gunY = py + GUN_OFFSET_Y;

    this.gunSprite.setPosition(gunX, gunY);
    this.gunSprite.setRotation(this._aimAngle);
    this.gunSprite.setFlipY(this.facingDir < 0);
  }

  // ═══════════════════════════════════════════════════════════════
  //  전투
  // ═══════════════════════════════════════════════════════════════

  /**
   * 음성 인식 / 네트워크에서 호출
   */
  fire() {
    if (this.isDead) return;

    const fireAngle = this._aimAngle;

    // 반동 (발사 반대 방향)
    const recoilX = -Math.cos(fireAngle) * this.RECOIL_FORCE;
    Phaser.Physics.Matter.Matter.Body.applyForce(
      this.body, this.body.position, { x: recoilX, y: 0 }
    );

    // 탄환 발사 위치: 캐릭터 앞쪽
    const spawnX = this.body.position.x + Math.cos(fireAngle) * (CHAR_DISPLAY_SIZE / 2 + 6);
    const spawnY = this.body.position.y;

    this.scene.events.emit('player_fire', {
      playerIndex: this.playerIndex,
      x:           spawnX,
      y:           spawnY,
      angle:       fireAngle,
    });

    this._flashEffect();
  }

  takeDamage(amount) {
    if (this.isDead) return;
    this.hp = Math.max(0, this.hp - amount);
    this._hitFlash();
    if (this.hp === 0) this._die();
  }

  _die() {
    if (this.isDead) return;
    this.isDead = true;
    this.charSprite.setAlpha(0.3);
    this.gunSprite.setAlpha(0);
    this.scene.events.emit('player_dead', { playerIndex: this.playerIndex });
  }

  // ═══════════════════════════════════════════════════════════════
  //  시각 이펙트
  // ═══════════════════════════════════════════════════════════════

  _flashEffect() {
    this.charSprite.setAlpha(0.4);
    this.scene.time.delayedCall(60, () => {
      if (!this.isDead) this.charSprite.setAlpha(1);
    });
  }

  _hitFlash() {
    this.charSprite.setTint(0xff4444);
    this.gunSprite.setTint(0xff4444);
    this.scene.time.delayedCall(120, () => {
      if (!this.isDead) {
        this.charSprite.setTint(this.tintColor);
        this.gunSprite.setTint(this.tintColor);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  네트워크 직렬화
  // ═══════════════════════════════════════════════════════════════

  serialize() {
    return {
      playerIndex: this.playerIndex,
      x:           this.body.position.x,
      y:           this.body.position.y,
      vx:          this.body.velocity.x,
      vy:          this.body.velocity.y,
      facingDir:   this.facingDir,
      aimAngle:    this._aimAngle,
      hp:          this.hp,
      timestamp:   Date.now(),
    };
  }

  applySnapshot(snap) {
    Phaser.Physics.Matter.Matter.Body.setPosition(this.body, { x: snap.x, y: snap.y });
    Phaser.Physics.Matter.Matter.Body.setVelocity(this.body, { x: snap.vx, y: snap.vy });
    this.facingDir = snap.facingDir;
    this._aimAngle = snap.aimAngle;
    if (snap.hp !== undefined) this.hp = snap.hp;
  }

  // ═══════════════════════════════════════════════════════════════
  //  소멸
  // ═══════════════════════════════════════════════════════════════

  destroy() {
    try { this.scene.matter.world.remove(this.body); } catch (_) {}
    try { this.scene.matter.world.remove(this._groundSensor); } catch (_) {}
    this.charSprite?.destroy();
    this.gunSprite?.destroy();
  }
}