// 여우의 고난길 — 한 프레임 업데이트: 플레이어 물리, 함정, 날아오는 것, 총알, 적, 충돌, 피격, 효과
// 모든 게임 스크립트는 전역 스코프를 공유한다 (index.html 의 <script> 순서대로 불러옴, 빌드 도구 없음).
'use strict';

// ---------------------------------------------------------------- 업데이트
function update(dt) {
    game.anim += dt;
    if (game.state === 'playing') {
        game.time += dt;
        stage.t += dt;
        updateMovers(dt);
        updatePlayer(dt);
        camX = roomCamX();
        updateChase(dt);
        updateTimedTiles(dt);
        updateTraps(dt);
        updateBullets(dt);
        enemies.forEach(e => updateEnemy(e, dt));
        if (boss) updateBoss(boss, dt);
        updateHazards(dt);
        checkCollisions();
    } else if (game.state === 'dead') {
        game.time += dt;
        updateHazards(dt);
    }
    if (game.state !== 'paused') updateEffects(dt);
}

const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

/** 플레이어 몸이 닿아 있는 타일 중 하나라도 t 인지 */
function touchingTile(p, t) {
    for (let r = Math.floor(p.y / TILE); r <= Math.floor((p.y + p.h - 1) / TILE); r++) {
        for (let c = Math.floor(p.x / TILE); c <= Math.floor((p.x + p.w - 1) / TILE); c++) {
            if (tileAt(c, r) === t) return true;
        }
    }
    return false;
}

/** 지금 플레이어를 미는 바람 세기 (돌풍 구역 + 매 장군) */
function windForce() {
    let f = boss && boss.alive ? boss.wind : 0;
    const pc = (player.x + player.w / 2) / TILE;
    for (const w of stage.winds) {
        if (pc >= w.c1 && pc < w.c2 + 1 && windPhase(w) < w.on) f += w.force * windScale();
    }
    return f;
}

function updatePlayer(dt) {
    const p = player;
    p.invuln = Math.max(0, p.invuln - dt);

    // 움직이는 발판 위에 서 있으면 같이 움직인다
    const m = p.mover >= 0 ? stage.movers[p.mover] : null;
    if (m && !m.gone && p.x + p.w > m.x - m.dx && p.x < m.x - m.dx + m.w) {
        moveX(p, m.dx);
        p.y = m.y - p.h;
    }
    p.mover = -1;

    p.inWeb = touchingTile(p, 'S');   // 거미줄: 느려지고 낮게만 뛴다
    const dir = p.grabbed ? 0 : (rightHeld() ? 1 : 0) - (leftHeld() ? 1 : 0);
    const target = dir * PHYS.run * (p.inWeb ? 0.4 : 1);
    // 얼음 위(또는 얼음에서 뛰어오른 뒤)에서는 관성이 있다
    p.run = p.slide ? approach(p.run, target, (dir ? 650 : 300) * dt) : target;
    const pull = p.grabbed ? p.grabbed * 520 : 0;   // 독두꺼비 혀에 붙잡히면 끌려간다
    p.vx = p.run + windForce() + pull;
    if (dir) p.facing = dir;

    p.coyote = p.onGround ? PHYS.coyoteTime : p.coyote - dt;
    if (p.onGround) p.airJumps = 1;

    const jumpMul = p.inWeb ? 0.55 : 1;
    const groundJump = () => { p.vy = -PHYS.jump * jumpMul; p.coyote = 0; p.buffer = 0; p.onGround = false; sfx('jump'); };
    if (jumpQueued && p.grabbed) {
        // 붙잡혔을 때 점프하면 빠져나온다
        p.grabbed = 0;
        p.vy = -480;
        p.invuln = Math.max(p.invuln, 0.3);
        sfx('jump');
        burst(p.x + p.w / 2, p.y + p.h / 2, 10, ['#ff8ab0', '#ffffff'], 160);
    } else if (jumpQueued) {
        if (p.coyote > 0) groundJump();
        else if (p.airJumps > 0) {
            p.vy = -PHYS.doubleJump * jumpMul;
            p.airJumps--;
            sfx('doubleJump');
            burst(p.x + p.w / 2, p.y + p.h, 6, ['#ffffff', '#dfe8ff'], 120);
        } else p.buffer = PHYS.jumpBuffer;
    } else if (p.buffer > 0) {
        p.buffer -= dt;
        if (p.onGround) groundJump();
    }
    jumpQueued = false;
    if (jumpReleased) {
        if (p.vy < 0) p.vy *= PHYS.jumpCut;
        jumpReleased = false;
    }

    p.vy = Math.min(p.vy + PHYS.gravity * dt, PHYS.maxFall);
    if (p.inWeb) p.vy = clamp(p.vy, -380, 140);
    if (moveX(p, p.vx * dt)) p.run = 0;
    p.prevBottom = p.y + p.h;
    const hit = moveY(p, p.vy * dt);
    p.onGround = hit === 'down';
    if (hit) p.vy = 0;

    // 움직이는 발판에 내려앉기 (위에서만)
    if (!p.onGround && p.vy >= 0) {
        stage.movers.forEach((mv, i) => {
            if (mv.gone || p.onGround) return;
            const prevTop = mv.y - mv.dy;
            if (p.x + p.w > mv.x && p.x < mv.x + mv.w && p.prevBottom <= prevTop + 1 && p.y + p.h >= mv.y) {
                p.y = mv.y - p.h;
                p.vy = 0;
                p.onGround = true;
                p.mover = i;
                if (mv.fall) mv.stepped = true;
            }
        });
    }

    if (p.onGround) {
        const r = Math.floor((p.y + p.h + 1) / TILE);
        const c1 = Math.floor(p.x / TILE), c2 = Math.floor((p.x + p.w - 0.001) / TILE);
        let ice = false, shroom = false;
        for (let c = c1; c <= c2; c++) {
            const t = tileAt(c, r);
            const key = `${c},${r}`;
            if (t === 'X' && !stage.crumbling.has(key)) stage.crumbling.set(key, PHYS.crumbleDelay);
            if (t === 'G') ice = true;
            if (t === 'M') shroom = true;
        }
        if (p.mover < 0) {
            if (!p.slide && ice) p.run = p.vx - windForce();   // 얼음에 올라선 순간의 속도를 이어받는다
            p.slide = ice;
        } else p.slide = false;
        // 두 발이 모두 흙(또는 얼음) 블록 위면 안전한 땅으로 기억
        const solidGround = t => t === '#' || t === 'G';
        if (p.mover < 0 && solidGround(tileAt(c1, r)) && solidGround(tileAt(c2, r))) p.safe = { x: p.x, y: p.y };
        if (shroom) {
            // 버섯 트램펄린: 높이 튕겨 오른다
            p.vy = -1080;
            sfx('bounce');
            p.onGround = false;
            p.coyote = 0;
            p.airJumps = 1;
            burst(p.x + p.w / 2, p.y + p.h, 8, ['#ff5a5a', '#ffffff'], 160);
        }
    }

    // 공격
    p.shootCd -= dt;
    if (shootHeld() && p.shootCd <= 0 && bullets.length < PHYS.maxBullets) {
        bullets.push({ x: p.x + p.w / 2 + p.facing * 12, y: p.y + p.h * 0.5, vx: p.facing * PHYS.bulletSpeed, life: 0.9 });
        p.shootCd = PHYS.bulletCooldown;
        sfx('shoot');
    }

    p.anim += Math.abs(p.vx) * dt * 0.07;
    if (p.y > stage.rows * TILE + 20) {
        p.grabbed = 0;
        if (p.safe) hurtPlayer(true);
        else killPlayer();
    }
}

function updateMovers(dt) {
    for (const m of stage.movers) {
        const ox = m.x, oy = m.y;
        if (m.fall && m.stepped) {
            // 밟으면 잠시 뒤 떨어지는 낙엽
            m.fallT += dt;
            if (m.fallT > 0.45) { m.fallV += 1400 * dt; m.y += m.fallV * dt; }
            if (m.y > stage.rows * TILE + 40) m.gone = true;
        } else if (m.period) {
            const s = Math.sin(((stage.t + (m.phase || 0)) / m.period) * Math.PI * 2);
            m.x = m.bx + m.ax * TILE * s;
            m.y = m.by + m.ay * TILE * s;
        }
        m.dx = m.x - ox;
        m.dy = m.y - oy;
    }
}

/** 집 앞 언덕: 뒤에서 늑대 무리가 쫓아온다. 따라잡히면 끝 */
function updateChase(dt) {
    const pc = (player.x + player.w / 2) / TILE;
    const speedMul = diff().boss.hard ? 1 : 0.85;
    for (const ch of stage.chase) {
        if (ch.done) continue;
        if (!ch.on) {
            if (pc >= ch.c1) { ch.on = true; ch.x = ch.c1 * TILE - 300; }
            continue;
        }
        ch.x += ch.speed * speedMul * dt;
        if (ch.x > ch.c2 * TILE) { ch.on = false; ch.done = true; }
    }
}

/** 잠깐 바뀌는 타일: warn 동안 예고 → t 동안 바뀐 타일 → 원래대로 */
function updateTimedTiles(dt) {
    for (const tt of stage.timed) {
        if (tt.warn > 0) {
            tt.warn -= dt;
            if (tt.warn <= 0) tt.cells.forEach(cell => { stage.tiles[cell.r][cell.c] = tt.tile; });
            continue;
        }
        tt.t -= dt;
        if (tt.t <= 0) {
            tt.cells.forEach(cell => { stage.tiles[cell.r][cell.c] = cell.orig; });
            tt.done = true;
        }
    }
    stage.timed = stage.timed.filter(tt => !tt.done);
}

function updateTraps(dt) {
    for (const t of stage.traps) {
        if (t.fired || !playerInCols(t.trigger)) continue;
        t.fired = true;
        t.cells.forEach(({ c, r }) => { stage.tiles[r][c] = t.tile; });
        if (t.tile === '#') shake(0.2);
        sfx('trap');
    }
    for (const [key, left] of stage.crumbling) {
        const remain = left - dt;
        if (remain > 0) { stage.crumbling.set(key, remain); continue; }
        const [c, r] = key.split(',').map(Number);
        stage.tiles[r][c] = '.';
        stage.crumbling.delete(key);
        sfx('crumble');
        burst(c * TILE + TILE / 2, r * TILE + TILE / 2, 8, ['#8d7b68', '#6e5e4e'], 160);
    }
}

function updateHazards(dt) {
    const roomL = camX - 100, roomR = camX + VIEW_W + 100;
    for (const h of hazards) {
        if (!h.active) {
            if (h.trigger && !h.armed && game.state === 'playing' && playerInCols(h.trigger)) {
                h.armed = true;
                h.wait = h.delay || 0;
            }
            if (h.armed) {
                h.wait -= dt;
                if (h.wait <= 0) {
                    h.active = true;
                    if (h.trigger) sfx('trap');
                    Object.assign(h, h.launch);
                }
            }
            continue;
        }
        // 빔(번개, 혀, 불꽃): 예고(warn) 동안은 닿아도 괜찮고, 그 뒤 life 동안 위험하다
        if (h.warn > 0) {
            h.warn -= dt;
            // 어려움 억까: 예고선이 마지막 순간에 다른 높이로 바뀐다
            if (h.switchTo !== undefined && !h.switched && h.warn <= h.switchAt) { h.y = h.switchTo; h.switched = 1; }
            continue;
        }
        if (h.life !== undefined) {
            h.life -= dt;
            if (h.life <= 0) h.dead = true;
        }
        h.vx += (h.ax || 0) * dt;   // 부메랑: 반대쪽으로 가속해서 되돌아온다
        h.vy += (h.ay || 0) * dt;
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        h.spin += dt * 10;
        // 독 방울: 굴러가다 멈추면 독 웅덩이가 되어 3초 동안 남는다
        if (h.toPuddle && h.vx * h.toPuddle <= 0) {
            Object.assign(h, { shape: 'puddle', w: 56, h: 12, y: GROUND_Y - 6, vx: 0, ax: 0, life: 3, toPuddle: 0 });
        }
        if (h.y > stage.rows * TILE + 200 || h.y < -300 || h.x < roomL || h.x > roomR) h.dead = true;
        if ((h.shape === 'wave' || h.shape === 'big' || h.shape === 'lava') && isSolid(tileAt(Math.floor(h.x / TILE), Math.floor(h.y / TILE)))) h.dead = true;
    }
    hazards = hazards.filter(h => !h.dead);
}

function updateBullets(dt) {
    for (const b of bullets) {
        b.x += b.vx * dt;
        b.life -= dt;
        if (b.life <= 0 || isSolid(tileAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE)))
            || b.x < camX || b.x > camX + VIEW_W) {
            b.dead = true;
            continue;
        }
        const pt = { x: b.x - 4, y: b.y - 4, w: 8, h: 8 };
        for (const e of enemies) {
            if (e.alive && overlap(pt, e)) {
                e.alive = false;
                e.squash = 0.6;
                b.dead = true;
                sfx('enemyHit');
                burst(e.x + e.w / 2, e.y + e.h / 2, 10, ['#5b3b8c', '#2e1f47'], 200);
            }
        }
        for (const s of saves) {
            if (!b.dead && overlap(pt, s)) { activateSave(s); b.dead = true; }
        }
        if (!b.dead && boss && boss.alive && boss.active && !boss.ghost && !boss.hidden && overlap(pt, boss)) {
            b.dead = true;
            damageBoss();
        }
    }
    bullets = bullets.filter(b => !b.dead);
}

function updateEnemy(e, dt) {
    if (!e.alive) { e.squash -= dt; return; }
    if (e.x + e.w < camX || e.x > camX + VIEW_W) return;   // 지금 방에 있는 적만 움직인다
    e.vy = Math.min(e.vy + PHYS.gravity * dt, PHYS.maxFall);
    if (moveX(e, e.vx * dt)) e.vx = -e.vx;
    else if (e.onGround) {
        const frontX = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
        const t = tileAt(Math.floor(frontX / TILE), Math.floor((e.y + e.h + 1) / TILE));
        if (!(isSolid(t) || t === '-')) e.vx = -e.vx;
    }
    const hit = moveY(e, e.vy * dt);
    e.onGround = hit === 'down';
    if (hit) e.vy = 0;
    e.anim += dt * 10;
}

// ---- 보스 (종류별 패턴은 js/bosses.js)

function activateSave(s) {
    if (game.checkpoint?.saveIndex === s.index) return;
    game.checkpoint = { x: s.x + 6, y: s.y + s.h - player.h, saveIndex: s.index };
    sfx('save');
    popups.push({ x: s.x + s.w / 2, y: s.y - 8, text: '저장!', t: 1 });
}

function checkCollisions() {
    if (game.state !== 'playing') return;
    const p = player;

    checkGrab();
    if (p.invuln <= 0 && touchingDanger()) hurtPlayer();

    for (const e of enemies) {
        if (game.state !== 'playing') return;
        if (!e.alive || !overlap(p, e)) continue;
        if (p.vy > 0 && p.prevBottom <= e.y + 10) {
            e.alive = false;
            e.squash = 0.6;
            p.vy = -PHYS.stompBounce;
            p.airJumps = 1;
            sfx('stomp');
        } else if (p.invuln <= 0) hurtPlayer();
    }
    if (game.state !== 'playing') return;

    for (const s of saves) if (overlap(p, s)) activateSave(s);

    const g = stage.goal;
    if (g && g.visible && overlap(p, { x: g.x + 20, y: g.y + 20, w: g.w - 40, h: g.h - 20 })) {
        if (game.stageIndex < STAGES.length - 1) {
            game.state = 'clear';
            sfx('clear');
        } else {
            saveBest();
            game.state = 'win';
            sfx('win');
            submitOnline();
        }
    }
}

/** 가시, 날아오는 함정, 보스에 닿았는지 */
function touchingDanger() {
    const p = player;
    for (let r = Math.floor(p.y / TILE); r <= Math.floor((p.y + p.h) / TILE); r++) {
        for (let c = Math.floor(p.x / TILE); c <= Math.floor((p.x + p.w) / TILE); c++) {
            const t = tileAt(c, r);
            if (SPIKE_BOX[t] && overlap(p, SPIKE_BOX[t](c * TILE, r * TILE))) return true;
        }
    }
    if (hazards.some(h => !h.grab && !(h.warn > 0) && overlap(p, centerBox(h)))) return true;
    // 간헐천이 솟구치는 중
    if (stage.geysers.some(g => geyserPhase(g) < GEYSER_ERUPT && overlap(p, geyserBox(g)))) return true;
    // 뒤에서 쫓아오는 늑대 무리에게 따라잡힘
    if (stage.chase.some(ch => ch.on && p.x < ch.x)) return true;
    return !!(boss && boss.alive && !boss.ghost && !boss.hidden
        && overlap(p, { x: boss.x + 8, y: boss.y + 10, w: boss.w - 16, h: boss.h - 10 }));
}

/** 독두꺼비 혀(grab 빔)에 닿으면 붙잡혀 보스 쪽으로 끌려간다 */
function checkGrab() {
    const p = player;
    if (p.grabbed || p.invuln > 0 || !boss) return;
    for (const h of hazards) {
        if (h.grab && !(h.warn > 0) && overlap(p, centerBox(h))) {
            p.grabbed = Math.sign(boss.x + boss.w / 2 - (p.x + p.w / 2)) || 1;
            popups.push({ x: p.x + p.w / 2, y: p.y - 14, text: '붙잡혔다! 점프로 탈출', t: 1, fill: '#ff8ab0', stroke: '#3a0612' });
            sfx('grab');
            return;
        }
    }
}

/** 하트를 하나 잃는다. 마지막 하트면 기절 (어려움은 하트가 1개라 바로 기절) */
function hurtPlayer(fell = false) {
    const p = player;
    if (game.state !== 'playing') return;
    p.grabbed = 0;   // 맞으면 혀에서 풀려난다
    if (p.hp <= 1) return killPlayer();
    p.hp--;
    p.invuln = HURT_INVULN;
    sfx('hurt');
    if (fell) {
        // 떨어지면 마지막으로 밟은 안전한 땅으로 돌아온다
        p.x = p.safe.x;
        p.y = p.safe.y;
        p.vx = 0;
        p.vy = 0;
        camX = roomCamX();
    } else {
        p.vy = Math.min(p.vy, -300);   // 살짝 튕겨서 맞았다는 걸 알린다
    }
    shake(0.15);
    burst(p.x + p.w / 2, p.y + p.h / 2, 14, ['#ff6b8a', '#ffffff'], 220);
    popups.push({ x: p.x + p.w / 2, y: p.y - 12, text: `하트 ${p.hp}개 남음`, t: 1.2, fill: '#ff6b8a', stroke: '#3a0612' });
}

function killPlayer() {
    if (game.state !== 'playing') return;
    game.deaths++;
    game.state = 'dead';
    sfx('die');
    player.hp = 0;   // 기절하면 하트가 모두 빈 칸으로 보이게
    shake(0.25);
    burst(player.x + player.w / 2, player.y + player.h / 2, 36, ['#e8742a', '#fde7cf', '#ffffff', '#b8401f'], 380);
}

// ---- 효과
let shakeTime = 0;
const shake = t => { shakeTime = Math.max(shakeTime, t); };

function burst(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = speed * (0.3 + Math.random() * 0.7);
        particles.push({
            x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3,
            life: 0.6 + Math.random() * 0.6, size: 3 + Math.random() * 4,
            color: colors[i % colors.length],
        });
    }
}

function updateEffects(dt) {
    shakeTime = Math.max(0, shakeTime - dt);
    for (const pt of particles) {
        pt.vy += PHYS.gravity * 0.6 * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.life -= dt;
    }
    particles = particles.filter(pt => pt.life > 0);
    popups.forEach(pp => { pp.t -= dt; pp.y -= 30 * dt; });
    popups = popups.filter(pp => pp.t > 0);
}
