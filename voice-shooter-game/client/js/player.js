const CHAR_DISPLAY_SIZE = 52;
const GUN_DISPLAY_W     = 40;
const GUN_DISPLAY_H     = 28;
const GUN_OFFSET_X      = 20;
const GUN_OFFSET_Y      = 4;

class Player {
  constructor(scene, x, y, opts = {}) {
    this.scene       = scene;
    this.playerIndex = opts.playerIndex ?? 0;
    this.isLocal     = opts.isLocal ?? true;

    // ── 물리 상수 ──
    this.MOVE_FORCE      = 0.013;   // 이동력
    this.MAX_SPEED_X     = 10.0;    // 최대 이동속도
    this.JUMP_VELOCITY   = -14.5;   // 점프력
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
    this._onGroundFloor  = false;  // 최하단 바닥 위에 있는지
    this._fallingThrough = false;  // 플랫폼 내려가기 중

    // ── 상태 ──
    this.hp        = 100;
    this.isDead    = false;
    this.facingDir = this.playerIndex === 0 ? 1 : -1;
    this._aimAngle = this.facingDir > 0 ? 0 : Math.PI;
    this.tintColor = opts.tint ?? (this.playerIndex === 0 ? 0xffffff : 0xff8c69);

    this._buildBody(x, y);
    this._buildSprites();
    this._setupCollision();

    if (this.isLocal) {
      this._bindControls(opts.controls);
    }
  }

  // ── 물리 바디 ────────────────────────────────────────────────

  _buildBody(x, y) {
    const r = CHAR_DISPLAY_SIZE / 2 - 2;
    this.body = this.scene.matter.add.circle(x, y, r, {
      label:          `player_${this.playerIndex}`,
      frictionAir:    this.AIR_DAMPING,
      friction:       this.GROUND_FRICTION,
      restitution:    0.0,
      density:        0.004,
      gravityScale:   { x: 0, y: this.GRAVITY_SCALE },
      inertia:        Infinity,
      inverseInertia: 0,
      collisionFilter: {
        category: 0x0001,
        mask:     0x0002 | 0x0004,
      },
    });
  }

  // ── 스프라이트 ───────────────────────────────────────────────

  _buildSprites() {
    const x = this.body.position.x;
    const y = this.body.position.y;

    this.charSprite = this.scene.add.image(x, y, 'char')
      .setDisplaySize(CHAR_DISPLAY_SIZE, CHAR_DISPLAY_SIZE)
      .setOrigin(0.5, 0.5).setDepth(10).setTint(this.tintColor);

    this.gunSprite = this.scene.add.image(x, y, 'gun')
      .setDisplaySize(GUN_DISPLAY_W, GUN_DISPLAY_H)
      .setOrigin(0.15, 0.6).setDepth(11).setTint(this.tintColor);
  }

  // ── 충돌 감지 ────────────────────────────────────────────────

  _setupCollision() {
    // 단방향 플랫폼 통과: collisionstart에서 pair.isActive = false
    this.scene.matter.world.on('collisionstart', (event) => {
      event.pairs.forEach((pair) => {
        const isMe  = pair.bodyA === this.body || pair.bodyB === this.body;
        if (!isMe) return;
        const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
        if (!other.isStatic) return;

        const label = other.label ?? '';

        // 공중 플랫폼 처리
        if (other.isOneWay) {
          const playerBottom = this.body.position.y + CHAR_DISPLAY_SIZE / 2;
          const platformTop  = other.position.y - 9;
          const risingUp     = this.body.velocity.y < 0;
          const comingBelow  = playerBottom > platformTop + 5;

          // 아래서 올라오는 중이거나 내려가기 모드면 통과
          if (risingUp || comingBelow || this._fallingThrough) {
            pair.isActive = false;
            return;
          }
        }

        // 내려가기 모드면 플랫폼 충돌 무시
        if (this._fallingThrough && label !== 'ground') {
          pair.isActive = false;
          return;
        }

        // groundContacts 카운트 (아래쪽 바닥만)
        const dy = other.position.y - this.body.position.y;
        if (dy > 0) {
          this._groundContacts++;
          if (label === 'ground') this._onGroundFloor = true;
        }
      });
    });

    this.scene.matter.world.on('collisionend', (event) => {
      event.pairs.forEach((pair) => {
        const isMe  = pair.bodyA === this.body || pair.bodyB === this.body;
        if (!isMe) return;
        const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
        if (!other.isStatic) return;
        const dy = other.position.y - this.body.position.y;
        if (dy > 0) {
          this._groundContacts = Math.max(0, this._groundContacts - 1);
          if ((other.label ?? '') === 'ground') this._onGroundFloor = false;
        }
      });
    });
  }

  // ── 컨트롤 ───────────────────────────────────────────────────

  _bindControls(controlMap) {
    const defaults = [
      { left: 'A',    right: 'D',     jump: 'W',  down: 'S'    },
      { left: 'LEFT', right: 'RIGHT', jump: 'UP', down: 'DOWN' },
    ];
    const map = controlMap ?? defaults[this.playerIndex];
    this.keys = this.scene.input.keyboard.addKeys({
      left:  map.left,
      right: map.right,
      jump:  map.jump,
      down:  map.down,
    });
  }

  // ── 업데이트 ─────────────────────────────────────────────────

  update(delta) {
    if (this.isDead) return;

    // 화면 밖으로 나가지 못하게 클램프
    const r  = CHAR_DISPLAY_SIZE / 2;
    const px = this.body.position.x;
    const py = this.body.position.y;
    if (px < r || px > GAME_WIDTH - r || py < r || py > GAME_HEIGHT - r) {
      Phaser.Physics.Matter.Matter.Body.setPosition(this.body, {
        x: Phaser.Math.Clamp(px, r, GAME_WIDTH  - r),
        y: Phaser.Math.Clamp(py, r, GAME_HEIGHT - r),
      });
      Phaser.Physics.Matter.Matter.Body.setVelocity(this.body, {
        x: px < r || px > GAME_WIDTH  - r ? 0 : this.body.velocity.x,
        y: py < r || py > GAME_HEIGHT - r ? 0 : this.body.velocity.y,
      });
    }

    this._updateGroundState(delta);

    if (this.isLocal) {
      this._handleMovement();
      this._handleJump();
    }

    this._aimAngle = this.facingDir > 0 ? 0 : Math.PI;
    this._syncSprites();
  }

  // ── 지면 상태 ────────────────────────────────────────────────

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

  // ── 이동 ─────────────────────────────────────────────────────

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

  // ── 점프 / 내려가기 ──────────────────────────────────────────

  _handleJump() {
    // 점프
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

    // 내려가기: 공중 플랫폼 위에 있을 때만 (최하단 바닥은 제외)
    const downPressed = Phaser.Input.Keyboard.JustDown(this.keys.down);
    if (downPressed && this._onGround && !this._onGroundFloor) {
      this._fallThrough();
    }
  }

  _doJump() {
    Phaser.Physics.Matter.Matter.Body.setVelocity(this.body, {
      x: this.body.velocity.x,
      y: this.JUMP_VELOCITY,
    });
  }

  _fallThrough() {
    if (this._fallingThrough) return;
    this._fallingThrough = true;
    this._groundContacts = 0;
    this._onGroundFloor  = false;

    // 아래 방향 속도 주어서 플랫폼 아래로 통과
    Phaser.Physics.Matter.Matter.Body.setVelocity(this.body, {
      x: this.body.velocity.x,
      y: 8,
    });

    // 250ms 후 플래그 해제 (충분히 내려간 뒤)
    this.scene.time.delayedCall(250, () => {
      this._fallingThrough = false;
    });
  }

  // ── 스프라이트 동기화 ────────────────────────────────────────

  _syncSprites() {
    const px = this.body.position.x;
    const py = this.body.position.y;

    this.charSprite.setPosition(px, py);
    this.charSprite.setFlipX(this.facingDir < 0);

    const gunX = px + this.facingDir * GUN_OFFSET_X;
    const gunY = py + GUN_OFFSET_Y;
    this.gunSprite.setPosition(gunX, gunY);
    this.gunSprite.setRotation(this._aimAngle);
    this.gunSprite.setFlipY(this.facingDir < 0);
  }

  // ── 전투 ─────────────────────────────────────────────────────

  fire() {
    if (this.isDead) return;
    const fireAngle = this._aimAngle;
    const recoilX   = -Math.cos(fireAngle) * this.RECOIL_FORCE;
    Phaser.Physics.Matter.Matter.Body.applyForce(
      this.body, this.body.position, { x: recoilX, y: 0 }
    );
    this.scene.events.emit('player_fire', {
      playerIndex: this.playerIndex,
      x:           this.body.position.x + Math.cos(fireAngle) * (CHAR_DISPLAY_SIZE / 2 + 6),
      y:           this.body.position.y,
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

  // ── 이펙트 ───────────────────────────────────────────────────

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

  // ── 직렬화 ───────────────────────────────────────────────────

  serialize() {
    return {
      playerIndex: this.playerIndex,
      x: this.body.position.x, y: this.body.position.y,
      vx: this.body.velocity.x, vy: this.body.velocity.y,
      facingDir: this.facingDir, aimAngle: this._aimAngle,
      hp: this.hp, timestamp: Date.now(),
    };
  }

  applySnapshot(snap) {
    Phaser.Physics.Matter.Matter.Body.setPosition(this.body, { x: snap.x, y: snap.y });
    Phaser.Physics.Matter.Matter.Body.setVelocity(this.body, { x: snap.vx, y: snap.vy });
    this.facingDir = snap.facingDir;
    this._aimAngle = snap.aimAngle;
    if (snap.hp !== undefined) this.hp = snap.hp;
  }

  destroy() {
    try { this.scene.matter.world.remove(this.body); } catch (_) {}
    this.charSprite?.destroy();
    this.gunSprite?.destroy();
  }
}