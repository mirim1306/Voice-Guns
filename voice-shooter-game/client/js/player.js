/**
 * player.js
 * ─────────────────────────────────────────────────────────────────
 * Phase 4 업데이트:
 * - Char.png 스프라이트 적용 (원형 캐릭터, flipX로 방향 전환)
 * - Gun.png 스프라이트 적용 (캐릭터 손 위치에 앵커, 마우스 방향으로 회전)
 * - 발사 시 반동 강화
 * - 피격 시 색조 플래시 (tint)
 * ─────────────────────────────────────────────────────────────────
 */

// 캐릭터 표시 크기 (Char.png 원본이 크므로 게임 내 표시 크기로 스케일)
const CHAR_DISPLAY_SIZE = 52;   // px (물리 바디와 근사하게 맞춤)
const GUN_DISPLAY_W     = 40;   // px
const GUN_DISPLAY_H     = 28;   // px

// 총이 캐릭터 중심으로부터 얼마나 떨어져 있는지 (손 위치 오프셋)
const GUN_OFFSET_X = 18;  // 캐릭터 반지름 + 약간
const GUN_OFFSET_Y = 6;   // 약간 아래 (손 위치)

class Player {
  /**
   * @param {Phaser.Scene} scene
   * @param {number}       x
   * @param {number}       y
   * @param {object}       opts
   *   opts.playerIndex  0 or 1
   *   opts.isLocal      boolean
   *   opts.tint         색조 (0xRRGGBB) - P2 구분용
   *   opts.controls     { left, right, jump }
   */
  constructor(scene, x, y, opts = {}) {
    this.scene       = scene;
    this.playerIndex = opts.playerIndex ?? 0;
    this.isLocal     = opts.isLocal     ?? true;

    // ── 물리 상수 ──
    this.MOVE_FORCE      = 0.0055;
    this.MAX_SPEED_X     = 5.5;
    this.JUMP_VELOCITY   = -11.5;
    this.GRAVITY_SCALE   = 2.2;
    this.AIR_DAMPING     = 0.015;
    this.GROUND_FRICTION = 0.18;
    this.RECOIL_FORCE    = 0.028;

    // ── 점프 보조 ──
    this.COYOTE_TIME   = 120;
    this.JUMP_BUFFER   = 100;
    this._coyoteTimer  = 0;
    this._jumpBuffer   = 0;
    this._onGround     = false;
    this._groundContacts = 0;

    // ── 상태 ──
    this.hp        = 100;
    this.isDead    = false;
    this.facingDir = this.playerIndex === 0 ? 1 : -1;

    // ── 시각 ──
    // P1은 원본 색조 유지, P2는 주황 계열 tint
    this.tintColor = opts.tint ?? (this.playerIndex === 0 ? 0xffffff : 0xff8c69);

    // ── 빌드 ──
    this._buildBody(x, y);
    this._buildSprites();
    this._buildGroundSensor();

    if (this.isLocal) {
      this._bindControls(opts.controls);
      this._bindAimEvents();
    }

    // 조준 각도 (라디안)
    this._aimAngle = this.facingDir > 0 ? 0 : Math.PI;
  }

  // ═══════════════════════════════════════════════════════════════
  //  초기화
  // ═══════════════════════════════════════════════════════════════

  _buildBody(x, y) {
    const r = CHAR_DISPLAY_SIZE / 2 - 2;   // 물리 반지름

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

  /** Char.png + Gun.png 스프라이트 생성 */
  _buildSprites() {
    const x = this.body.position.x;
    const y = this.body.position.y;

    // ── 캐릭터 스프라이트 ──
    this.charSprite = this.scene.add.image(x, y, 'char')
      .setDisplaySize(CHAR_DISPLAY_SIZE, CHAR_DISPLAY_SIZE)
      .setOrigin(0.5, 0.5)   // 중심 앵커
      .setDepth(10)
      .setTint(this.tintColor);

    // ── 총 스프라이트 ──
    // 원점(origin)을 손잡이 쪽으로 설정 → 회전 시 캐릭터 손 중심으로 회전
    // Gun.png가 오른쪽(→) 방향이므로 origin.x = 0.15 (손잡이 왼쪽)
    this.gunSprite = this.scene.add.image(x, y, 'gun')
      .setDisplaySize(GUN_DISPLAY_W, GUN_DISPLAY_H)
      .setOrigin(0.15, 0.6)  // 손잡이 위치 앵커
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

  /** 마우스 포인터로 총 조준 방향 계산 */
  _bindAimEvents() {
    // pointermove 는 update()에서 매 프레임 처리 (더 부드러움)
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
      this._updateAim();
    }

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
  //  조준 (마우스)
  // ═══════════════════════════════════════════════════════════════

  _updateAim() {
    const ptr = this.scene.input.activePointer;
    const px  = this.body.position.x;
    const py  = this.body.position.y;

    // 마우스 → 캐릭터 방향 벡터
    this._aimAngle = Math.atan2(ptr.y - py, ptr.x - px);

    // 조준 방향에 따라 캐릭터 flip
    this.facingDir = Math.cos(this._aimAngle) >= 0 ? 1 : -1;
  }

  // ═══════════════════════════════════════════════════════════════
  //  스프라이트 동기화
  // ═══════════════════════════════════════════════════════════════

  _syncSprites() {
    const px = this.body.position.x;
    const py = this.body.position.y;

    // 캐릭터 스프라이트
    this.charSprite.setPosition(px, py);
    this.charSprite.setFlipX(this.facingDir < 0);

    // 총 위치: 캐릭터 손 오프셋 (조준 각도에 따라 회전)
    const gunX = px + Math.cos(this._aimAngle) * GUN_OFFSET_X;
    const gunY = py + Math.sin(this._aimAngle) * GUN_OFFSET_X + GUN_OFFSET_Y;

    this.gunSprite.setPosition(gunX, gunY);
    // 총 회전: 조준 각도 적용 (Gun.png가 →이므로 그대로)
    this.gunSprite.setRotation(this._aimAngle);
    // 총도 위아래 flip (총구가 항상 올바른 방향)
    this.gunSprite.setFlipY(this.facingDir < 0);
  }

  // ═══════════════════════════════════════════════════════════════
  //  전투
  // ═══════════════════════════════════════════════════════════════

  /**
   * 음성 인식 / 네트워크에서 호출
   * @param {number|null} angle  라디안 (null이면 현재 _aimAngle 사용)
   */
  fire(angle) {
    if (this.isDead) return;

    const fireAngle = angle ?? this._aimAngle;

    // 반동 (발사 반대 방향)
    const recoilX = -Math.cos(fireAngle) * this.RECOIL_FORCE;
    const recoilY = -Math.sin(fireAngle) * this.RECOIL_FORCE;
    Phaser.Physics.Matter.Matter.Body.applyForce(
      this.body, this.body.position, { x: recoilX, y: recoilY }
    );

    // 발사 이벤트 → BulletSystem이 수신
    this.scene.events.emit('player_fire', {
      playerIndex: this.playerIndex,
      x:           this.body.position.x + Math.cos(fireAngle) * (CHAR_DISPLAY_SIZE / 2 + 6),
      y:           this.body.position.y + Math.sin(fireAngle) * (CHAR_DISPLAY_SIZE / 2 + 6),
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
    this.isDead = true;
    this.charSprite.setAlpha(0.3);
    this.gunSprite.setAlpha(0);
    this.scene.events.emit('player_dead', { playerIndex: this.playerIndex });
  }

  // ═══════════════════════════════════════════════════════════════
  //  시각 이펙트
  // ═══════════════════════════════════════════════════════════════

  /** 발사 시 반짝임 */
  _flashEffect() {
    this.charSprite.setAlpha(0.4);
    this.scene.time.delayedCall(60, () => {
      if (!this.isDead) this.charSprite.setAlpha(1);
    });
  }

  /** 피격 시 빨간 tint 플래시 */
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
  //  네트워크 직렬화 (Phase 5)
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
    };
  }

  applySnapshot(snap) {
    Phaser.Physics.Matter.Matter.Body.setPosition(this.body, { x: snap.x, y: snap.y });
    Phaser.Physics.Matter.Matter.Body.setVelocity(this.body, { x: snap.vx, y: snap.vy });
    this.facingDir  = snap.facingDir;
    this._aimAngle  = snap.aimAngle;
    this.hp         = snap.hp;
  }

  // ═══════════════════════════════════════════════════════════════
  //  소멸
  // ═══════════════════════════════════════════════════════════════

  destroy() {
    this.scene.matter.world.remove(this.body);
    this.scene.matter.world.remove(this._groundSensor);
    this.charSprite.destroy();
    this.gunSprite.destroy();
  }
}