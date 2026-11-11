// 여우의 고난길 — 보스 실행: js/bosses.js 의 보스 정의(BOSS_TYPES)를 상태 기계로 돌린다
// 모든 게임 스크립트는 전역 스코프를 공유한다 (index.html 의 <script> 순서대로 불러옴, 빌드 도구 없음).
'use strict';

const LANES = { low: GROUND_Y - 16, high: GROUND_Y - 62, plank: 8 * TILE - 15 };

function bossApi(b, dt) {
    const style = diff().boss;
    const fast = style.speed * (style.enrage && b.hp <= b.maxHp / 2 ? 1.35 : 1);
    return {
        dt, fast, hard: style.hard, player, LANES, GROUND: GROUND_Y, TILE,
        arena: { x0: b.arenaX0, x1: b.arenaX1, mid: (b.arenaX0 + b.arenaX1) / 2 },
        goal: stage.goal,
        toPlayer: Math.sign(player.x + player.w / 2 - (b.x + b.w / 2)) || -1,
        playerOnPlank: player.y + player.h < 8 * TILE + 10,
        rest(bb, mul = 1) { bb.state = 'rest'; bb.t = style.rest * mul / fast; bb.vx = 0; },
        shake, burst,
        popup(text, x, y, fill = '#ffe14d') { popups.push({ x, y, text, t: 1.6, fill, stroke: '#2a1a00' }); },
        spawn(h) { hazards.push({ vy: 0, ay: 0, ax: 0, spin: 0, active: true, ...h }); },
        /** 보스 앞에서 가로로 쏜다 (lane: low | high | plank) */
        shot(bb, { lane, y, speed, dir = bb.dir, ...rest }) {
            this.spawn({
                x: dir > 0 ? bb.x + bb.w + 10 : bb.x - 10, y: y ?? LANES[lane],
                vx: dir * speed * fast, ...rest,
            });
        },
        /** 방 벽에서 여우 쪽으로 쏜다 (등 뒤 기습). side: -1 왼쪽 벽, 1 오른쪽 벽 */
        wallShot(side, { lane, y, speed, ...rest }) {
            this.spawn({
                x: side < 0 ? b.arenaX0 + 6 : b.arenaX1 - 6, y: y ?? LANES[lane],
                vx: -side * speed * fast, ...rest,
            });
        },
        /** 가로 빔: warn 동안 예고선만, 그 뒤 life 동안 위험 */
        beam({ x0, x1, y, h, warn, life, kind, ...rest }) {
            this.spawn({ shape: 'beam', kind, x: (x0 + x1) / 2, y, w: x1 - x0, h, vx: 0, warn, warnMax: warn, life, ...rest });
        },
        /** 보스 입(from)에서 dir 쪽 벽까지 닿는 빔 */
        beamToWall(from, dir, opts) {
            const x0 = dir > 0 ? from : b.arenaX0, x1 = dir > 0 ? b.arenaX1 : from;
            this.beam({ x0, x1, ...opts });
        },
        /** 빈틈 하나만 남긴 가시 벽 (gap: low = 바닥에 서 있으면 안전, plank = 발판 위가 안전) */
        wall(x, dir, gap, speed, shape) {
            const free = gap === 'low' ? [372, GROUND_Y] : [250, 350];
            for (let y = 72; y < GROUND_Y; y += 34) {
                if (y + 12 > free[0] && y - 12 < free[1]) continue;
                this.spawn({ shape, x, y, w: 22, h: 22, vx: dir * speed * fast });
            }
        },
        minion(x, kind) {
            if (enemies.filter(e => e.alive && e.minion).length >= MAX_MINIONS) return;
            const dir = Math.sign(player.x - x) || 1;
            enemies.push({
                x, y: GROUND_Y - 24, w: 30, h: 24, kind, minion: true,
                vx: dir * 90, vy: 0, onGround: false, alive: true, squash: 0, anim: 0,
            });
            burst(x + 15, GROUND_Y - 12, 8, ['#ffffff', '#cfc6d8'], 140);
        },
        /** 타일을 잠깐 바꾼다 (warn 동안 예고 → secs 동안 tile) */
        timedTiles(cells, tile, warn, secs, kind) {
            const list = cells
                .filter(({ c, r }) => r >= 0 && r < stage.rows && c >= 0 && c < stage.cols)
                .filter(({ c, r }) => !stage.timed.some(tt => tt.cells.some(x => x.c === c && x.r === r)))
                .map(({ c, r }) => ({ c, r, orig: stage.tiles[r][c] }));
            if (list.length) stage.timed.push({ cells: list, tile, warn, t: secs, kind });
        },
        /** x 근처의 발판(-) 한 덩어리를 찾는다 */
        plankAt(x) {
            const c0 = Math.floor(x / TILE);
            for (const r of [8, 9]) {
                for (const dc of [0, -1, 1, -2, 2]) {
                    if (tileAt(c0 + dc, r) !== '-') continue;
                    let c1 = c0 + dc, c2 = c0 + dc;
                    while (tileAt(c1 - 1, r) === '-') c1--;
                    while (tileAt(c2 + 1, r) === '-') c2++;
                    const cells = [];
                    for (let c = c1; c <= c2; c++) cells.push({ c, r });
                    return cells;
                }
            }
            return null;
        },
        showGoal(v) { stage.goal.visible = v; },
        clearShots() { hazards = hazards.filter(h => h.trigger); player.grabbed = 0; },
        kill() { killBoss(); },
        /** 날아다니는 보스를 목표 지점으로 움직인다. 도착하면 true */
        fly(bb, tx, ty, speed) {
            const dx = tx - bb.x, dy = ty - bb.y, d = Math.hypot(dx, dy);
            if (d <= speed * dt + 0.5) { bb.x = tx; bb.y = ty; bb.vx = 0; bb.vy = 0; return true; }
            bb.vx = dx / d * speed; bb.vy = dy / d * speed;
            return false;
        },
        /** 순간이동 (다람쥐 구멍 등) */
        place(bb, x, y) { bb.x = x; bb.y = y; bb.vx = 0; bb.vy = 0; },
    };
}

function updateBoss(b, dt) {
    if (!b.alive) return;
    if (!b.active) {
        if (player.x > b.wake * TILE) {
            b.active = true; b.state = 'rest'; b.t = 1.2;
            sfx('bossWake');
            // 보스가 깨어나면 뒤의 문은 무조건 닫힌다 (보스가 방 밖으로 나가지 않게)
            for (const t of stage.traps) {
                if (t.tile === '#' && !t.fired) { t.fired = true; t.cells.forEach(({ c, r }) => { stage.tiles[r][c] = '#'; }); }
            }
        }
        return;
    }
    const type = BOSS_TYPES[b.type];
    const a = bossApi(b, dt);
    b.flash = Math.max(0, b.flash - dt);
    b.anim += dt * (b.state === 'charge' || b.state === 'spin' ? 20 : 8);
    b.t -= dt;
    b.wind = 0;

    if (b.fly) {
        b.x = clamp(b.x + b.vx * dt, b.arenaX0, b.arenaX1 - b.w);
        b.y = clamp(b.y + b.vy * dt, 30, GROUND_Y - b.h);
        b.hitWall = false;
        b.landed = false;
    } else {
        const wasAir = !b.onGround;
        b.vy = Math.min(b.vy + PHYS.gravity * dt, PHYS.maxFall);
        b.hitWall = moveX(b, b.vx * dt);
        const hitY = moveY(b, b.vy * dt);
        b.onGround = hitY === 'down';
        if (hitY) b.vy = 0;
        b.landed = b.onGround && wasAir;
    }

    if (b.state === 'rest') {
        if (!b.fly) { b.vx = 0; b.dir = a.toPlayer; }
        if (type.idle) type.idle(b, a);
        if (b.t <= 0) {
            const order = type.order2 && b.hp <= b.maxHp / 2 ? type.order2 : type.order;
            type.start(b, a, order[b.step++ % order.length]);
        }
    } else {
        type.think(b, a);
    }
}

function damageBoss() {
    boss.hp--;
    boss.flash = 0.08;
    sfx('bossHit');
    if (boss.hp > 0) return;
    // 어려움 억까: 가짜 죽음, 마지막 발악 등 (보스가 true 를 돌려주면 아직 안 죽는다)
    const type = BOSS_TYPES[boss.type];
    if (type.onZero && type.onZero(boss, bossApi(boss, 0))) return;
    killBoss();
}

function killBoss() {
    boss.alive = false;
    boss.ghost = 0;
    sfx('bossDie');
    player.grabbed = 0;
    shake(0.6);
    burst(boss.x + boss.w / 2, boss.y + boss.h / 2, 60, ['#5b3b8c', '#ffd34d', '#ffffff', '#2e1f47'], 420);
    hazards = hazards.filter(h => h.trigger);   // 보스가 쏜 것들은 사라진다
    boss.wind = 0;
    for (const e of enemies) {
        if (e.minion && e.alive) { e.alive = false; e.squash = 0.6; }   // 졸개도 함께 사라진다
    }
    stage.goal.visible = true;
    const text = stage.goal.kind === 'house' ? '집이 나타났다!' : '출구가 나타났다!';
    popups.push({ x: stage.goal.x + 40, y: stage.goal.y - 10, text, t: 2 });
}
