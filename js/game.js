// 여우의 고난길 - 고난도 함정 플랫포머
// 구조: 입력 → 고정 시간 간격(1/60초) 업데이트 → 그리기
(() => {
    'use strict';

    const TILE = 40;
    const VIEW_W = 960;   // = ROOM_COLS * TILE
    const VIEW_H = 560;
    const ROOM_W = ROOM_COLS * TILE;
    const STEP = 1 / 60;

    const PHYS = {
        gravity: 2000,
        maxFall: 900,
        run: 220,               // 관성 없이 바로 이 속도로 움직인다
        jump: 720,
        doubleJump: 600,
        jumpCut: 0.45,          // 점프 키를 떼면 상승 속도를 이만큼 줄인다
        coyoteTime: 0.08,
        jumpBuffer: 0.1,
        stompBounce: 450,
        bulletSpeed: 700,
        bulletCooldown: 0.14,
        maxBullets: 5,
        crumbleDelay: 0.35,
    };

    const BOSS_HP = 70;   // 40이면 Z를 누르고 있기만 해도 패턴을 다 보기 전에 쓰러져서 늘렸다

    // 난이도: 쉬움은 하트 3개, 함정 앞 "!" 경고, 보스 체력 절반
    // boss: 난이도별 보스 설정 (보스별 패턴은 js/bosses.js. 모든 공격은 가로 방향)
    //   speed   투사체, 돌진 속도 배율
    //   enrage  체력 절반 이하에서 더 빨라지는지
    //   rest    공격 사이 쉬는 시간
    //   hard    보스마다 추가 패턴을 쓰는지 (높이 섞기, 연속 공격, 되돌아오기 등)
    const DIFF = {
        easy: {
            name: '쉬움', hearts: 3, bossHp: BOSS_HP / 2, warn: true, bestKey: 'foxHardBestEasy10', reachKey: 'foxHardReachEasy',
            boss: { speed: 0.85, enrage: false, rest: 1.2, hard: false },
        },
        hard: {
            name: '어려움', hearts: 1, bossHp: BOSS_HP, warn: false, bestKey: 'foxHardBest10', reachKey: 'foxHardReach',
            boss: { speed: 1, enrage: true, rest: 0.75, hard: true },
        },
    };
    const MAX_MINIONS = 4;   // 보스가 부르는 졸개 최대 수
    const GROUND_Y = 12 * TILE;   // 보스 방 바닥 높이
    const HURT_INVULN = 1.5;    // 맞은 뒤 무적 시간
    const WARN_COLS = 4;        // 함정 트리거 몇 칸 앞부터 경고할지

    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    // ---------------------------------------------------------------- 입력
    const keys = new Set();
    let jumpQueued = false;
    let jumpReleased = false;
    const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'ShiftLeft', 'ShiftRight'];
    const SHOOT_KEYS = ['KeyZ', 'KeyX', 'KeyJ'];
    const GAME_KEYS = new Set([...JUMP_KEYS, ...SHOOT_KEYS, 'ArrowLeft', 'ArrowRight', 'ArrowDown']);

    const leftHeld = () => keys.has('ArrowLeft') || keys.has('KeyA');
    const rightHeld = () => keys.has('ArrowRight') || keys.has('KeyD');
    const jumpHeld = () => JUMP_KEYS.some(k => keys.has(k));
    const shootHeld = () => SHOOT_KEYS.some(k => keys.has(k));

    function pressKey(code, repeat = false) {
        if (!repeat) {
            if (JUMP_KEYS.includes(code)) jumpQueued = true;
            handleMenuKey(code);
        }
        keys.add(code);
    }

    function releaseKey(code) {
        keys.delete(code);
        if (JUMP_KEYS.includes(code) && !jumpHeld()) jumpReleased = true;
    }

    window.addEventListener('keydown', e => {
        if (GAME_KEYS.has(e.code)) e.preventDefault();
        pressKey(e.code, e.repeat);
    });
    window.addEventListener('keyup', e => releaseKey(e.code));
    window.addEventListener('blur', () => keys.clear());

    document.querySelectorAll('[data-key]').forEach(btn => {
        const code = btn.dataset.key;
        btn.addEventListener('pointerdown', e => { e.preventDefault(); pressKey(code); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, () => releaseKey(code)));
    });
    canvas.addEventListener('pointerdown', () => {
        if (game.state !== 'playing') handleMenuKey('Enter');
    });

    // ---------------------------------------------------------------- 상태
    const game = {
        state: 'title',     // title | playing | paused | dead | clear | win
        stageIndex: 0,
        deaths: 0,
        time: 0,            // 플레이 시간 (죽어도 계속 흐름)
        anim: 0,            // 애니메이션용
        checkpoint: null,   // { x, y, saveIndex }
        difficulty: loadDifficulty(),   // easy | hard
        best: null,
        newRecord: false,
    };
    game.best = loadBest();

    let stage, player, enemies, hazards, bullets, saves, signs, boss, particles, popups;
    let camX = 0;

    const diff = () => DIFF[game.difficulty];

    function loadDifficulty() {
        try {
            const d = localStorage.getItem('foxHardDifficulty');
            return DIFF[d] ? d : 'hard';
        } catch { return 'hard'; }
    }

    function setDifficulty(d) {
        if (game.difficulty === d) return;
        game.difficulty = d;
        game.best = loadBest();
        try { localStorage.setItem('foxHardDifficulty', d); } catch { /* 저장 불가 환경 */ }
    }

    function loadBest() {
        try { return JSON.parse(localStorage.getItem(diff().bestKey)) || null; } catch { return null; }
    }

    /** 이어하기: 이 난이도에서 도착한 가장 먼 스테이지 (0부터) */
    function loadReach() {
        try { return Math.min(STAGES.length - 1, parseInt(localStorage.getItem(diff().reachKey), 10) || 0); } catch { return 0; }
    }

    function saveReach(index) {
        if (index <= loadReach()) return;
        try { localStorage.setItem(diff().reachKey, String(index)); } catch { /* 저장 불가 환경 */ }
    }

    function saveBest() {
        if (game.continued) return;   // 이어하기로 깬 판은 기록에 넣지 않는다
        const b = game.best;
        game.newRecord = !b || game.deaths < b.deaths || (game.deaths === b.deaths && game.time < b.time);
        if (!game.newRecord) return;
        game.best = { deaths: game.deaths, time: game.time };
        try { localStorage.setItem(diff().bestKey, JSON.stringify(game.best)); } catch { /* 저장 불가 환경 */ }
    }

    /** 스테이지를 처음 상태로 되돌리고 체크포인트에서 시작 (죽을 때마다 호출) */
    function buildStage() {
        const def = STAGES[game.stageIndex];
        const hard = diff().boss.hard;
        const keep = x => !x.hard || hard;   // hard: true 인 함정은 어려움에서만
        const tiles = def.tiles.map(row => row.slice());
        if (hard) (def.hardTiles || []).forEach(({ c, r, tile }) => { tiles[r][c] = tile; });
        stage = {
            name: def.name,
            theme: def.theme,
            cols: def.cols,
            rows: def.rows,
            tiles,
            t: 0,                       // 스테이지 시계 (구름, 돌풍, 간헐천 주기). 죽으면 0부터
            crumbling: new Map(),       // "c,r" -> 남은 시간
            revealed: new Set(),        // 드러난 투명 블록
            traps: def.tileTraps.filter(keep).map(t => ({ ...t, fired: false })),
            timed: [],                  // 잠깐 바뀌는 타일 (불타는 발판, 거미줄 덫)
            movers: (def.movers || []).filter(keep).map(m => ({
                ...m, x: m.bx, y: m.by, w: m.w, h: 14, dx: 0, dy: 0, stepped: false, fallT: 0, fallV: 0, gone: false,
            })),
            winds: (def.winds || []).filter(keep).map(w => ({ ...w })),
            geysers: (def.geysers || []).filter(keep).map(g => ({ ...g })),
            chase: (def.chase || []).filter(keep).map(c => ({ ...c, on: false, done: false, x: 0 })),
            goal: def.goal && {
                x: def.goal.c * TILE, y: (def.goal.r - 1) * TILE, w: TILE * 2, h: TILE * 2,
                kind: def.goal.kind, visible: !def.boss,
            },
        };

        const start = game.checkpoint || { x: def.start.c * TILE + 10, y: (def.start.r + 1) * TILE - 30 };
        player = {
            x: start.x, y: start.y, w: 20, h: 30, vx: 0, vy: 0,
            onGround: false, facing: 1, coyote: 0, buffer: 0, airJumps: 1, anim: 0, prevBottom: 0, shootCd: 0,
            hp: diff().hearts, invuln: 0, safe: null,   // safe: 떨어졌을 때 돌아갈 마지막 안전한 땅
            run: 0, slide: false, mover: -1, grabbed: 0, inWeb: false,
            onTile: (c, r, t) => { if (t === 'I') stage.revealed.add(`${c},${r}`); },
        };

        enemies = def.enemies.filter(keep).map(e => ({
            x: e.c * TILE + 5, y: (e.r + 1) * TILE - 24, w: 30, h: 24, kind: 'beetle',
            vx: -70, vy: 0, onGround: false, alive: true, squash: 0, anim: Math.random() * 6,
        }));
        hazards = def.hazards.filter(keep).map(h => ({
            ...h, x: h.x0, y: h.y0, launch: { vx: h.vx, vy: h.vy, ay: h.ay },
            vx: 0, vy: 0, ay: 0, active: false, armed: false, wait: 0, dead: false, spin: 0,
        }));
        saves = def.saves.map((s, i) => ({ x: s.c * TILE + 4, y: (s.r + 1) * TILE - 32, w: 32, h: 32, index: i }));
        signs = def.signs.map(s => ({ x: s.c * TILE + 4, y: (s.r + 1) * TILE - 34, text: s.text }));
        if (def.boss) {
            const type = BOSS_TYPES[def.boss.type];
            // 뒤 스테이지일수록 체력이 조금씩 많다 (스테이지마다 +6%)
            const hp = Math.round(diff().bossHp * type.hp * (1 + 0.06 * game.stageIndex));
            const bx = def.boss.c * TILE;
            boss = {
                type: def.boss.type, name: type.name, fly: !!type.fly,
                x: type.fly ? bx - 20 : bx, y: type.fly ? 8 * TILE - 15 - type.h / 2 : GROUND_Y - type.h,
                w: type.w, h: type.h, vx: 0, vy: 0, onGround: false, landed: false, hitWall: false,
                hp, maxHp: hp, alive: true, active: false, ignorePlanks: true, wake: def.boss.wake,
                arenaX0: (def.cols - ROOM_COLS + 1) * TILE, arenaX1: def.cols * TILE,
                state: 'wait', t: 0, n: 0, k: 0, total: 0, step: 0, dir: -1, side: 1, back: 0, flip: 0,
                lane: 'low', wind: 0, flash: 0, anim: 0,
            };
            type.init?.(boss);
        } else boss = null;
        bullets = [];
        particles = [];
        popups = [];
        jumpQueued = false;
        jumpReleased = false;
        camX = roomCamX();
    }

    function startGame(from = 0) {
        game.deaths = 0;
        game.time = 0;
        game.stageIndex = from;
        game.continued = from > 0;
        game.checkpoint = null;
        game.newRecord = false;
        buildStage();
        game.state = 'playing';
    }

    function nextStage() {
        game.stageIndex++;
        saveReach(game.stageIndex);
        game.checkpoint = null;
        buildStage();
        game.state = 'playing';
    }

    function respawn() {
        buildStage();
        game.state = 'playing';
    }

    function handleMenuKey(code) {
        switch (game.state) {
            case 'title':
                if (code === 'ArrowLeft' || code === 'KeyA' || code === 'Digit1') setDifficulty('easy');
                else if (code === 'ArrowRight' || code === 'KeyD' || code === 'Digit2') setDifficulty('hard');
                else if (code === 'Enter' || code === 'Space') startGame();
                else if (code === 'KeyC' && loadReach() > 0) startGame(loadReach());
                break;
            case 'clear':
                if (code === 'Enter' || code === 'Space') nextStage();
                break;
            case 'win':
                if (code === 'Enter' || code === 'Space') game.state = 'title';   // 타이틀에서 난이도를 다시 고른다
                break;
            case 'playing':
                if (code === 'KeyR') respawn();
                else if (code === 'KeyP' || code === 'Escape') game.state = 'paused';
                break;
            case 'dead':
                if (code === 'KeyR' || code === 'Enter') respawn();
                break;
            case 'paused':
                if (code === 'KeyP' || code === 'Escape' || code === 'Enter') game.state = 'playing';
                break;
        }
    }

    // ---------------------------------------------------------------- 타일 충돌
    function tileAt(c, r) {
        if (c < 0 || c >= stage.cols) return '#';
        if (r < 0 || r >= stage.rows) return '.';
        return stage.tiles[r][c];
    }

    // 하늘 다리의 구름 블록: C 와 D 가 4초 주기로 번갈아 나타난다 (0.4초 겹침, 사라지기 0.5초 전부터 깜빡)
    const CLOUD_PERIOD = 4, CLOUD_ON = 2.4;
    const cloudPhase = t => (stage.t + (t === 'D' ? CLOUD_PERIOD / 2 : 0)) % CLOUD_PERIOD;
    const cloudOn = t => cloudPhase(t) < CLOUD_ON;

    // M 버섯(밟으면 튕김), G 얼음(미끄러짐)도 단단한 블록
    const isSolid = t => t === '#' || t === 'X' || t === 'I' || t === 'M' || t === 'G'
        || ((t === 'C' || t === 'D') && cloudOn(t));

    function moveX(b, dx) {
        if (dx === 0) return false;
        b.x += dx;
        const r1 = Math.floor(b.y / TILE);
        const r2 = Math.floor((b.y + b.h - 0.001) / TILE);
        const c = dx > 0 ? Math.floor((b.x + b.w - 0.001) / TILE) : Math.floor(b.x / TILE);
        for (let r = r1; r <= r2; r++) {
            const t = tileAt(c, r);
            if (isSolid(t)) {
                b.x = dx > 0 ? c * TILE - b.w : (c + 1) * TILE;
                b.onTile?.(c, r, t);
                return true;
            }
        }
        return false;
    }

    function moveY(b, dy) {
        const prevBottom = b.y + b.h;
        b.y += dy;
        const c1 = Math.floor(b.x / TILE);
        const c2 = Math.floor((b.x + b.w - 0.001) / TILE);
        if (dy > 0) {
            const r = Math.floor((b.y + b.h - 0.001) / TILE);
            for (let c = c1; c <= c2; c++) {
                const t = tileAt(c, r);
                if (isSolid(t) || (t === '-' && !b.ignorePlanks && prevBottom <= r * TILE + 0.01)) {
                    b.y = r * TILE - b.h;
                    b.onTile?.(c, r, t);
                    return 'down';
                }
            }
        } else if (dy < 0) {
            const r = Math.floor(b.y / TILE);
            for (let c = c1; c <= c2; c++) {
                const t = tileAt(c, r);
                if (isSolid(t)) {
                    b.y = (r + 1) * TILE;
                    b.onTile?.(c, r, t);
                    return 'up';
                }
            }
        }
        return null;
    }

    const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const centerBox = h => ({ x: h.x - h.w / 2, y: h.y - h.h / 2, w: h.w, h: h.h });

    // 가시는 뾰족한 쪽 일부만 판정해서 억울하지 않게
    const SPIKE_BOX = {
        '^': (x, y) => ({ x: x + 9, y: y + 18, w: TILE - 18, h: TILE - 18 }),
        'v': (x, y) => ({ x: x + 9, y, w: TILE - 18, h: TILE - 18 }),
        'W': (x, y) => ({ x: x + 4, y: y + 14, w: TILE - 8, h: TILE - 14 }),   // 독 늪물
        'L': (x, y) => ({ x: x + 4, y: y + 14, w: TILE - 8, h: TILE - 14 }),   // 용암
    };

    // 간헐천: 주기의 앞 0.9초 동안 솟구치고, 마지막 0.9초 동안 부글부글 예고한다
    const GEYSER_ERUPT = 0.9, GEYSER_WARN = 0.9;
    const geyserPhase = g => (stage.t + g.phase) % g.period;
    const geyserBox = g => ({ x: g.c * TILE + 6, y: g.top * TILE, w: TILE - 12, h: GROUND_Y - g.top * TILE });

    // 돌풍: 주기 중 on 초 동안 분다. 불기 0.8초 전부터 바람 줄로 예고
    const windPhase = w => (stage.t + (w.phase || 0)) % w.period;
    const windScale = () => (diff().boss.hard ? 1 : 0.75);

    function roomCamX() {
        const room = Math.floor((player.x + player.w / 2) / ROOM_W);
        return clamp(room * ROOM_W, 0, stage.cols * TILE - VIEW_W);
    }

    function playerInCols({ c1, c2 }) {
        const pc = (player.x + player.w / 2) / TILE;
        return pc >= c1 && pc < c2 + 1;
    }

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
        const groundJump = () => { p.vy = -PHYS.jump * jumpMul; p.coyote = 0; p.buffer = 0; p.onGround = false; };
        if (jumpQueued && p.grabbed) {
            // 붙잡혔을 때 점프하면 빠져나온다
            p.grabbed = 0;
            p.vy = -480;
            p.invuln = Math.max(p.invuln, 0.3);
            burst(p.x + p.w / 2, p.y + p.h / 2, 10, ['#ff8ab0', '#ffffff'], 160);
        } else if (jumpQueued) {
            if (p.coyote > 0) groundJump();
            else if (p.airJumps > 0) {
                p.vy = -PHYS.doubleJump * jumpMul;
                p.airJumps--;
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
        }
        for (const [key, left] of stage.crumbling) {
            const remain = left - dt;
            if (remain > 0) { stage.crumbling.set(key, remain); continue; }
            const [c, r] = key.split(',').map(Number);
            stage.tiles[r][c] = '.';
            stage.crumbling.delete(key);
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
        if (boss.hp > 0) return;
        // 어려움 억까: 가짜 죽음, 마지막 발악 등 (보스가 true 를 돌려주면 아직 안 죽는다)
        const type = BOSS_TYPES[boss.type];
        if (type.onZero && type.onZero(boss, bossApi(boss, 0))) return;
        killBoss();
    }

    function killBoss() {
        boss.alive = false;
        boss.ghost = 0;
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

    function activateSave(s) {
        if (game.checkpoint?.saveIndex === s.index) return;
        game.checkpoint = { x: s.x + 6, y: s.y + s.h - player.h, saveIndex: s.index };
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
            } else if (p.invuln <= 0) hurtPlayer();
        }
        if (game.state !== 'playing') return;

        for (const s of saves) if (overlap(p, s)) activateSave(s);

        const g = stage.goal;
        if (g && g.visible && overlap(p, { x: g.x + 20, y: g.y + 20, w: g.w - 40, h: g.h - 20 })) {
            if (game.stageIndex < STAGES.length - 1) {
                game.state = 'clear';
            } else {
                saveBest();
                game.state = 'win';
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

    // ---------------------------------------------------------------- 그리기
    const hash = (a, b) => ((a * 73856093) ^ (b * 19349663)) >>> 0;
    const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

    function render() {
        ctx.save();
        if (shakeTime > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);

        drawBackground();
        ctx.save();
        ctx.translate(-Math.round(camX), 0);
        if (boss) BOSS_TYPES[boss.type].drawBack?.(boss, ctx, bossArt(boss));   // 보스 방 배경 (나무 기둥 등)
        drawTiles();
        drawTimedTiles();
        drawMovers();
        drawGeysers();
        drawWinds();
        if (stage.goal?.visible) drawGoal(stage.goal);
        signs.forEach(drawSign);
        saves.forEach(drawSave);
        enemies.forEach(drawBeetle);
        if (boss) drawBoss(boss);
        hazards.forEach(drawHazard);
        bullets.forEach(drawBullet);
        drawTrapWarnings();
        drawGrabTongue();
        const blink = player.invuln > 0 && Math.floor(game.anim * 12) % 2 === 0;   // 무적 중에는 깜빡인다
        if (game.state !== 'dead' && !blink) drawFox(player);
        drawChase();
        drawParticles();
        drawDarkness();
        drawPopups();
        drawSignBubbles();
        ctx.restore();

        ctx.restore();
        if (game.state !== 'title') drawHud();
        drawOverlay();
    }

    function drawBackground() {
        const theme = stage.theme;
        const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
        sky.addColorStop(0, theme.sky[0]);
        sky.addColorStop(0.6, theme.sky[1]);
        sky.addColorStop(1, theme.sky[2]);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);

        const room = Math.round(camX / ROOM_W);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < theme.stars; i++) {
            const h = hash(i, room + 11 + game.stageIndex * 7);
            ctx.fillRect(h % VIEW_W, (h >> 10) % 220, 2, 2);
        }
        if (theme.moon) {
            ctx.fillStyle = theme.moon;
            ctx.beginPath();
            ctx.arc(780, 120, 34, 0, Math.PI * 2);
            ctx.fill();
        }

        drawHills(room * 300, 380, 50, theme.hills[0]);
        drawHills(room * 500 + 77, 440, 32, theme.hills[1]);
    }

    function drawHills(offset, baseY, amp, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, VIEW_H);
        for (let x = 0; x <= VIEW_W; x += 16) {
            const wx = x + offset;
            ctx.lineTo(x, baseY + Math.sin(wx / 170) * amp + Math.sin(wx / 61) * amp * 0.3);
        }
        ctx.lineTo(VIEW_W, VIEW_H);
        ctx.closePath();
        ctx.fill();
    }

    function drawTiles() {
        const cStart = Math.max(0, Math.floor(camX / TILE));
        const cEnd = Math.min(stage.cols - 1, cStart + ROOM_COLS);
        for (let r = 0; r < stage.rows; r++) {
            for (let c = cStart; c <= cEnd; c++) {
                const t = stage.tiles[r][c];
                const x = c * TILE, y = r * TILE;
                if (t === '#' || t === 'F') drawDirt(c, r, x, y);
                else if (t === '-') drawPlank(x, y);
                else if (t === 'X') drawCrumble(c, r, x, y);
                else if (t === 'I' && stage.revealed.has(`${c},${r}`)) drawRevealed(x, y);
                else if (t === '^' || t === 'v') drawSpikeTile(x, y, t);
                else if (t === 'M') drawMushroom(x, y);
                else if (t === 'G') drawIce(c, r, x, y);
                else if (t === 'W' || t === 'L') drawLiquid(c, x, y, t);
                else if (t === 'S') drawWeb(x, y);
                else if (t === 'C' || t === 'D') drawCloudBlock(x, y, t);
            }
        }
    }

    function drawMushroom(x, y) {
        ctx.fillStyle = '#f2e6d0';
        ctx.fillRect(x + 12, y + 16, 16, 24);
        ctx.fillStyle = '#d83a3a';
        ctx.beginPath();
        ctx.ellipse(x + 20, y + 18, 22, 16, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#fff';
        for (const [dx, dy] of [[-10, -6], [4, -10], [12, -4]]) {
            ctx.beginPath(); ctx.arc(x + 20 + dx, y + 18 + dy, 3, 0, Math.PI * 2); ctx.fill();
        }
    }

    function drawIce(c, r, x, y) {
        ctx.fillStyle = '#9fd6f2';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#d8f2ff';
        ctx.fillRect(x, y, TILE, 6);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 6 + (hash(c, r) % 10), y + 12); ctx.lineTo(x + 16 + (hash(c, r) % 10), y + 22);
        ctx.stroke();
    }

    function drawLiquid(c, x, y, t) {
        const wave = Math.sin(game.anim * 3 + c) * 3;
        ctx.fillStyle = t === 'W' ? '#4a8a2a' : '#e8501e';
        ctx.fillRect(x, y + 12 + wave, TILE, TILE - 12 - wave);
        ctx.fillStyle = t === 'W' ? '#8ad04a' : '#ffc84a';
        ctx.fillRect(x, y + 12 + wave, TILE, 4);
        if ((Math.floor(game.anim * 2) + c) % 3 === 0) {
            ctx.beginPath();
            ctx.arc(x + 12 + (c * 7) % 16, y + 24, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawWeb(x, y) {
        ctx.strokeStyle = 'rgba(235,235,245,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + TILE, y + TILE);
        ctx.moveTo(x + TILE, y); ctx.lineTo(x, y + TILE);
        ctx.moveTo(x + TILE / 2, y); ctx.lineTo(x + TILE / 2, y + TILE);
        ctx.moveTo(x, y + TILE / 2); ctx.lineTo(x + TILE, y + TILE / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + TILE / 2, y + TILE / 2, 12, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawCloudBlock(x, y, t) {
        const ph = cloudPhase(t);
        if (ph >= CLOUD_ON) {
            // 사라진 동안: 점선 테두리만
            ctx.setLineDash([4, 5]);
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 14);
            ctx.setLineDash([]);
            return;
        }
        const blinking = ph > CLOUD_ON - 0.5 && Math.floor(game.anim * 14) % 2 === 0;
        ctx.globalAlpha = blinking ? 0.35 : 1;
        ctx.fillStyle = t === 'C' ? '#ffffff' : '#ffc8e4';
        ctx.strokeStyle = t === 'C' ? '#7aa8d0' : '#d07aa8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x + 12, y + 14, 14, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 28, y + 12, 14, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x, y + 12, TILE, 16);
        ctx.strokeRect(x + 1, y + 13, TILE - 2, 15);
        ctx.globalAlpha = 1;
    }

    /** 잠깐 바뀌는 타일의 예고 (불타려는 발판에 연기, 거미줄이 생길 자리) */
    function drawTimedTiles() {
        for (const tt of stage.timed) {
            if (tt.warn <= 0) continue;
            for (const { c, r } of tt.cells) {
                const x = c * TILE, y = r * TILE;
                if (tt.kind === 'burn') {
                    ctx.fillStyle = `rgba(255,${80 + Math.random() * 80},30,0.85)`;
                    ctx.beginPath();
                    ctx.moveTo(x + 6, y + 2); ctx.lineTo(x + 20, y - 14 - Math.random() * 10); ctx.lineTo(x + 34, y + 2);
                    ctx.fill();
                } else {
                    ctx.globalAlpha = 0.5;
                    drawWeb(x, y);
                    ctx.globalAlpha = 1;
                }
            }
        }
    }

    function drawMovers() {
        const theme = stage.theme;
        for (const m of stage.movers) {
            if (m.gone) continue;
            const shakeX = m.fall && m.stepped && m.fallT < 0.45 ? (Math.random() - 0.5) * 4 : 0;
            const x = m.x + shakeX;
            if (theme.mover === 'leaf') {
                ctx.fillStyle = m.fall ? '#e0602a' : '#e8a02a';
                ctx.beginPath();
                ctx.ellipse(x + m.w / 2, m.y + 6, m.w / 2 + 4, 9, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#8a3a14';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x + 4, m.y + 6); ctx.lineTo(x + m.w - 4, m.y + 6); ctx.stroke();
            } else if (theme.mover === 'rock') {
                ctx.fillStyle = '#4a3434';
                ctx.fillRect(x, m.y, m.w, 16);
                ctx.fillStyle = '#ff7a2a';
                ctx.fillRect(x + 4, m.y + 12, m.w - 8, 3);
            } else {
                drawPlank(x, m.y);
                if (m.w > TILE) drawPlank(x + m.w - TILE, m.y);
            }
        }
    }

    function drawGeysers() {
        for (const g of stage.geysers) {
            const ph = geyserPhase(g), box = geyserBox(g);
            if (ph < GEYSER_ERUPT) {
                const grad = ctx.createLinearGradient(0, box.y, 0, GROUND_Y);
                grad.addColorStop(0, 'rgba(255,220,80,0.95)');
                grad.addColorStop(1, 'rgba(255,80,20,0.95)');
                ctx.fillStyle = grad;
                ctx.fillRect(box.x + Math.sin(game.anim * 30) * 2, box.y, box.w, box.h);
            } else if (ph > g.period - GEYSER_WARN) {
                // 예고: 부글부글
                ctx.fillStyle = '#ff7a2a';
                for (let i = 0; i < 3; i++) {
                    ctx.beginPath();
                    ctx.arc(box.x + 6 + i * 10, GROUND_Y - 4 - Math.random() * 14, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.fillStyle = '#2c1e1e';
            ctx.fillRect(g.c * TILE + 4, GROUND_Y - 6, TILE - 8, 6);
        }
    }

    function drawWinds() {
        for (const w of stage.winds) {
            const ph = windPhase(w);
            const blowing = ph < w.on, warning = ph > w.period - 0.8;
            if (!blowing && !warning) continue;
            ctx.strokeStyle = blowing ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 2;
            const d = Math.sign(w.force);
            for (let i = 0; i < 14; i++) {
                const y = 60 + ((i * 97) % 420);
                const len = blowing ? 50 : 24;
                const x0 = w.c1 * TILE, span = (w.c2 - w.c1 + 1) * TILE;
                const x = x0 + ((i * 131 + stage.t * 600 * d) % span + span) % span;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + d * len, y); ctx.stroke();
            }
        }
    }

    /** 뒤에서 쫓아오는 늑대 무리 (그림자 벽) */
    function drawChase() {
        for (const ch of stage.chase) {
            if (!ch.on) continue;
            const grad = ctx.createLinearGradient(ch.x - 200, 0, ch.x + 10, 0);
            grad.addColorStop(0, 'rgba(10,8,20,0.95)');
            grad.addColorStop(1, 'rgba(10,8,20,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(ch.x - 400, 0, 410, VIEW_H);
            for (let i = 0; i < 4; i++) {
                const y = 300 + i * 45 + Math.sin(game.anim * 6 + i) * 6;
                ctx.fillStyle = '#ff3a3a';
                ctx.fillRect(ch.x - 16 - (i % 2) * 30, y, 5, 3);
                ctx.fillRect(ch.x - 6 - (i % 2) * 30, y, 5, 3);
            }
        }
    }

    function drawGrabTongue() {
        if (!player.grabbed || !boss) return;
        const mx = player.grabbed > 0 ? boss.x : boss.x + boss.w;
        ctx.strokeStyle = '#ff8ab0';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(mx, boss.y + boss.h * 0.6);
        ctx.lineTo(player.x + player.w / 2, player.y + player.h / 2);
        ctx.stroke();
    }

    /** 밤의 동굴: 여우 주변만 보인다. 박쥐 여왕이 불을 끄면 더 좁아진다 */
    function drawDarkness() {
        if (!stage.theme.dark) return;
        const narrow = boss && boss.alive && boss.dark;
        const r = narrow ? 70 : diff().boss.hard ? 190 : 260;
        const fx = player.x + player.w / 2, fy = player.y + player.h / 2;
        const grad = ctx.createRadialGradient(fx, fy, r * 0.55, fx, fy, r);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(2,2,8,0.96)');
        ctx.fillStyle = grad;
        ctx.fillRect(camX - 20, -20, VIEW_W + 40, VIEW_H + 40);
        // 어둠 속에서도 보이는 것: 보스의 빛나는 눈, 출구
        if (boss && boss.alive) BOSS_TYPES[boss.type].drawGlow?.(boss, ctx, bossArt(boss));
        if (stage.goal?.visible) {
            ctx.globalAlpha = 0.6;
            drawGoal(stage.goal);
            ctx.globalAlpha = 1;
        }
    }

    const isDirt = t => t === '#' || t === 'F';

    function drawDirt(c, r, x, y) {
        const { dirt, grass } = stage.theme;   // 스테이지마다 땅 색이 다르다
        ctx.fillStyle = dirt[0];
        ctx.fillRect(x, y, TILE, TILE);
        const h = hash(c, r);
        ctx.fillStyle = dirt[1];
        ctx.fillRect(x + 4 + (h % 26), y + 6 + ((h >> 5) % 26), 6, 4);
        ctx.fillRect(x + 4 + ((h >> 10) % 26), y + 6 + ((h >> 15) % 26), 4, 3);
        if (!isDirt(tileAt(c, r - 1))) {
            ctx.fillStyle = grass[0];
            ctx.fillRect(x, y, TILE, 9);
            ctx.fillStyle = grass[1];
            ctx.fillRect(x, y + 9, TILE, 3);
        }
    }

    function drawPlank(x, y) {
        ctx.fillStyle = '#b07a45';
        ctx.fillRect(x, y, TILE, 12);
        ctx.fillStyle = '#80542b';
        ctx.fillRect(x, y + 12, TILE, 3);
        ctx.fillRect(x + TILE - 2, y, 2, 12);
    }

    function drawCrumble(c, r, x, y) {
        const left = stage.crumbling.get(`${c},${r}`);
        const dx = left !== undefined ? (Math.random() - 0.5) * 4 : 0;
        ctx.fillStyle = '#8d7b68';
        ctx.fillRect(x + dx, y, TILE, TILE);
        ctx.strokeStyle = '#5a4b3d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + dx + 8, y + 4); ctx.lineTo(x + dx + 18, y + 18); ctx.lineTo(x + dx + 12, y + 34);
        ctx.moveTo(x + dx + 30, y + 6); ctx.lineTo(x + dx + 24, y + 22);
        ctx.stroke();
        ctx.strokeRect(x + dx + 1, y + 1, TILE - 2, TILE - 2);
    }

    function drawRevealed(x, y) {
        ctx.fillStyle = 'rgba(200,230,255,0.35)';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = 'rgba(230,245,255,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    }

    function drawSpikeTile(x, y, t) {
        ctx.fillStyle = '#c9d0d8';
        ctx.strokeStyle = '#5f6770';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 2; i++) {
            const sx = x + i * (TILE / 2);
            ctx.beginPath();
            if (t === '^') {
                ctx.moveTo(sx, y + TILE); ctx.lineTo(sx + TILE / 4, y + 6); ctx.lineTo(sx + TILE / 2, y + TILE);
            } else {
                ctx.moveTo(sx, y); ctx.lineTo(sx + TILE / 4, y + TILE - 6); ctx.lineTo(sx + TILE / 2, y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    function drawGoal(goal) {
        if (goal.kind === 'flag') return drawFlag(goal);
        const { x, y, w, h } = goal;
        ctx.fillStyle = '#a0683a';
        ctx.fillRect(x + 6, y + 30, w - 12, h - 30);
        ctx.fillStyle = '#b8402f';
        ctx.beginPath();
        ctx.moveTo(x - 4, y + 34); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w + 4, y + 34);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#4a2c17';
        ctx.fillRect(x + w / 2 - 11, y + h - 30, 22, 30);
        ctx.fillStyle = '#ffd966';
        ctx.fillRect(x + 12, y + 42, 12, 10);
        ctx.fillRect(x + w - 24, y + 42, 12, 10);
    }

    /** 다음 스테이지로 가는 출구 깃발 */
    function drawFlag({ x, y, w, h }) {
        const px = x + w / 2 - 4;
        ctx.fillStyle = '#e8e2d0';
        ctx.fillRect(px, y - 10, 6, h + 10);
        const wave = Math.sin(game.anim * 6) * 4;
        ctx.fillStyle = '#e8742a';
        ctx.beginPath();
        ctx.moveTo(px + 6, y - 8);
        ctx.quadraticCurveTo(px + 26, y - 2 + wave, px + 46, y + 4);
        ctx.quadraticCurveTo(px + 26, y + 12 - wave, px + 6, y + 20);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold 12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('출구', px + 3, y + h + 16);
    }

    function drawSign(s) {
        const cx = s.x + 16;
        // 기둥
        ctx.fillStyle = '#5a3a20';
        ctx.fillRect(cx - 3, s.y + 6, 6, 28);
        // 판
        ctx.fillStyle = '#3d2614';
        ctx.fillRect(cx - 25, s.y - 18, 50, 32);
        ctx.fillStyle = '#f0c27a';
        ctx.fillRect(cx - 22, s.y - 15, 44, 26);
        ctx.fillStyle = '#8a5a2c';
        ctx.fillRect(cx - 15, s.y - 8, 30, 3);
        ctx.fillRect(cx - 15, s.y - 1, 22, 3);
        // 아직 안 읽었으면 "!" 표시
        if (!s.read) {
            const bob = Math.sin(game.anim * 5) * 4;
            ctx.font = `bold 24px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#3d2614';
            ctx.strokeText('!', cx, s.y - 26 + bob);
            ctx.fillStyle = '#ffe066';
            ctx.fillText('!', cx, s.y - 26 + bob);
        }
    }

    /** 쉬움: 함정 트리거 몇 칸 앞에 오면 함정 자리에 "!" 경고를 띄운다 */
    function nearTrigger(tr) {
        const pc = (player.x + player.w / 2) / TILE;
        return pc >= tr.c1 - WARN_COLS && pc < tr.c1;
    }

    function drawTrapWarnings() {
        if (!diff().warn || game.state !== 'playing') return;
        const spots = [];
        for (const t of stage.traps) {
            if (t.fired || t.tile === '#' || !nearTrigger(t.trigger)) continue;   // 보스 방 문은 함정이 아니다
            const { c, r } = t.cells[0];
            spots.push([c * TILE + TILE / 2, r * TILE + TILE / 2]);
        }
        for (const h of hazards) {
            if (!h.trigger || h.active || !(h.armed || nearTrigger(h.trigger))) continue;
            // 화면 밖(위, 아래)에서 나오는 함정도 보이도록 화면 안으로 당긴다
            spots.push([clamp(h.x0, camX + 24, camX + VIEW_W - 24), clamp(h.y0, 90, VIEW_H - 50)]);
        }
        const pulse = 1 + Math.sin(game.anim * 12) * 0.12;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold 22px ${FONT}`;
        for (const [x, y] of spots) {
            ctx.fillStyle = 'rgba(230,40,40,0.9)';
            ctx.beginPath();
            ctx.arc(x, y, 15 * pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.fillText('!', x, y + 1);
        }
        ctx.textBaseline = 'alphabetic';
    }

    function drawSignBubbles() {
        ctx.font = `bold 16px ${FONT}`;
        ctx.textAlign = 'center';
        for (const s of signs) {
            if (Math.abs(player.x + player.w / 2 - (s.x + 16)) > 80 || game.state === 'dead') continue;
            s.read = true;
            const w = ctx.measureText(s.text).width + 24;
            const bx = clamp(s.x + 16 - w / 2, camX + 8, camX + VIEW_W - w - 8);
            const by = s.y - 66;
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.beginPath();
            ctx.roundRect(bx, by, w, 32, 8);
            ctx.fill();
            ctx.fillStyle = '#333';
            ctx.fillText(s.text, bx + w / 2, by + 21);
        }
    }

    function drawSave(s) {
        const on = game.checkpoint?.saveIndex === s.index;
        ctx.fillStyle = '#6b4a2e';
        ctx.fillRect(s.x + 4, s.y + 18, s.w - 8, s.h - 18);
        ctx.fillStyle = '#4f3520';
        ctx.fillRect(s.x + 4, s.y + 18, s.w - 8, 3);
        const glow = on ? 0.6 + Math.sin(game.anim * 5) * 0.25 : 0;
        ctx.fillStyle = on ? `rgba(120,255,160,${glow})` : 'rgba(0,0,0,0)';
        ctx.beginPath();
        ctx.arc(s.x + s.w / 2, s.y + 10, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = on ? '#7dffa6' : '#9aa3ad';
        ctx.beginPath();
        ctx.arc(s.x + s.w / 2, s.y + 10, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold 10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('저장', s.x + s.w / 2, s.y + s.h - 2);
    }

    function drawAcorn(x, y, spin) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(spin) * 0.4);
        ctx.fillStyle = '#c47a35';
        ctx.beginPath();
        ctx.ellipse(0, 3, 9, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b3e1e';
        ctx.beginPath();
        ctx.ellipse(0, -6, 11, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-1.5, -15, 3, 6);
        ctx.restore();
    }

    function drawHazard(h) {
        if (!h.active && h.y < 60) return;   // 아직 안 떨어진 도토리가 상단 표시줄에 겹치지 않게 숨긴다
        if (h.shape === 'acorn') drawAcorn(h.x, h.y, h.spin);
        else if (h.shape === 'big') {
            ctx.save();
            ctx.translate(h.x, h.y);
            ctx.scale(1.9, 1.9);
            ctx.rotate(h.spin * Math.sign(h.vx || 1) * 0.6);   // 굴러간다
            drawAcorn(0, 0, 0);
            ctx.restore();
        }
        else if (h.shape === 'spike') {
            const ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[h.dir];
            ctx.save();
            ctx.translate(h.x, h.y);
            ctx.rotate(ang);
            ctx.fillStyle = '#c9d0d8';
            ctx.strokeStyle = '#5f6770';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(18, 0); ctx.lineTo(-16, -16); ctx.lineTo(-16, 16);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else if (h.shape === 'wave' || h.shape === 'lava') {
            const tall = h.h / 2;
            ctx.fillStyle = h.shape === 'lava' ? 'rgba(255,110,40,0.95)' : 'rgba(255,220,120,0.9)';
            ctx.beginPath();
            ctx.moveTo(h.x - 14, h.y + tall);
            ctx.quadraticCurveTo(h.x, h.y - tall * 1.8, h.x + 14, h.y + tall);
            ctx.closePath();
            ctx.fill();
            if (h.shape === 'lava') {
                ctx.fillStyle = '#ffd24a';
                ctx.beginPath();
                ctx.arc(h.x, h.y + 4, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (h.shape === 'beam') drawBeam(h);
        else drawProjectile(h);
    }

    /** 가로 빔: 예고 중에는 깜빡이는 가는 선, 그 뒤에는 굵은 빛 */
    function drawBeam(h) {
        const x0 = h.x - h.w / 2;
        const colors = {
            lightning: ['#fff6a0', '#ffe14d'], tongue: ['#ff8ab0', '#d0406a'], fire: ['#ffd24a', '#ff5a1e'],
            lava: ['#ffc84a', '#e8301a'],
        }[h.kind] || ['#ffffff', '#cccccc'];
        if (h.warn > 0) {
            ctx.globalAlpha = 0.35 + 0.35 * (Math.floor(game.anim * 12) % 2);
            ctx.setLineDash([12, 8]);
            ctx.strokeStyle = h.switched ? '#ff4040' : colors[1];   // 바뀐 예고선은 빨갛고 굵게
            ctx.lineWidth = h.switched ? 5 : 3;
            if (h.switched) ctx.globalAlpha = 0.6 + 0.4 * (Math.floor(game.anim * 20) % 2);
            ctx.beginPath();
            ctx.moveTo(x0, h.y);
            ctx.lineTo(x0 + h.w, h.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            return;
        }
        ctx.fillStyle = colors[1];
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x0, h.y - h.h / 2 - 4, h.w, h.h + 8);
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors[0];
        if (h.kind === 'lightning') {
            ctx.beginPath();
            ctx.moveTo(x0, h.y);
            for (let x = x0; x <= x0 + h.w; x += 24) ctx.lineTo(x, h.y + (Math.random() - 0.5) * h.h);
            ctx.lineWidth = 5;
            ctx.strokeStyle = colors[0];
            ctx.stroke();
        } else {
            ctx.fillRect(x0, h.y - h.h / 4, h.w, h.h / 2);
        }
    }

    /** 보스가 쏘는 여러 가지 투사체 */
    function drawProjectile(h) {
        const d = Math.sign(h.vx) || 1;
        ctx.save();
        ctx.translate(h.x, h.y);
        switch (h.shape) {
            case 'ring':    // 음파
                ctx.strokeStyle = 'rgba(210,170,255,0.95)';
                ctx.lineWidth = 3;
                for (let i = 0; i < 3; i++) {
                    const base = d > 0 ? 0 : Math.PI;   // 날아가는 쪽으로 볼록한 ")))"
                    ctx.beginPath();
                    ctx.arc(-d * i * 7, 0, 13 - i * 2, base - 1.1, base + 1.1);
                    ctx.stroke();
                }
                break;
            case 'puddle':
                ctx.globalAlpha = Math.min(1, h.life * 2);
                ctx.fillStyle = '#5aa03a';
                ctx.beginPath(); ctx.ellipse(0, 2, 30, 8, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#9ae05a';
                ctx.beginPath(); ctx.arc(-8 + Math.sin(h.spin) * 3, -2, 3, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
                break;
            case 'poison':
                ctx.fillStyle = '#7ad04a';
                ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#c8f08a';
                ctx.beginPath(); ctx.arc(-3, -3, 3, 0, Math.PI * 2); ctx.fill();
                break;
            case 'boom':    // 도토리 부메랑 (빙글빙글)
                ctx.rotate(h.spin * 2);
                drawAcorn(0, 0, 0);
                break;
            case 'quill':   // 얼음 가시
                ctx.fillStyle = '#d8f2ff';
                ctx.strokeStyle = '#5a9ac0';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(d * 14, 0); ctx.lineTo(-d * 12, -8); ctx.lineTo(-d * 12, 8);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                break;
            case 'web':
                ctx.strokeStyle = '#f0f0f8';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
                for (let i = 0; i < 4; i++) {
                    const ang = i * Math.PI / 4 + h.spin * 0.2;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(ang) * 11, Math.sin(ang) * 11);
                    ctx.lineTo(-Math.cos(ang) * 11, -Math.sin(ang) * 11);
                    ctx.stroke();
                }
                break;
            case 'ember':   // 불씨
                ctx.fillStyle = '#ff6a1e';
                ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#ffd24a';
                ctx.beginPath(); ctx.arc(d * 2, -1, 5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'rgba(255,106,30,0.5)';
                ctx.beginPath(); ctx.arc(-d * 10, 0, 6, 0, Math.PI * 2); ctx.fill();
                break;
            case 'puff':    // 구름 바람
                ctx.fillStyle = 'rgba(220,220,235,0.9)';
                for (const [dx, dy, r] of [[-6, 2, 8], [4, -3, 9], [8, 4, 7]]) {
                    ctx.beginPath(); ctx.arc(dx, dy, r, 0, Math.PI * 2); ctx.fill();
                }
                break;
            case 'feather':
                ctx.fillStyle = '#f4ead8';
                ctx.beginPath(); ctx.ellipse(0, 0, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#7a5232';
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(-d * 15, 0); ctx.lineTo(d * 15, 0); ctx.stroke();
                ctx.fillStyle = '#7a5232';
                ctx.beginPath(); ctx.moveTo(d * 18, 0); ctx.lineTo(d * 10, -4); ctx.lineTo(d * 10, 4); ctx.fill();
                break;
            case 'slash':   // 발톱 베기
                ctx.strokeStyle = '#e6f0ff';
                ctx.lineWidth = 4;
                for (const off of [-10, 0, 10]) {
                    ctx.beginPath();
                    ctx.arc(-d * 10, off * 0.3, 20, d > 0 ? -0.9 : Math.PI - 0.9, d > 0 ? 0.9 : Math.PI + 0.9);
                    ctx.stroke();
                }
                break;
            case 'wolfrun': {   // 늑대 무리
                const leg = Math.sin(h.spin * 2) * 6;
                ctx.scale(d, 1);
                ctx.fillStyle = '#4a4e5c';
                ctx.fillRect(-14 + leg, 4, 6, 14); ctx.fillRect(8 - leg, 4, 6, 14);
                ctx.beginPath(); ctx.ellipse(0, 0, 24, 11, 0, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.ellipse(22, -8, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.moveTo(18, -14); ctx.lineTo(20, -24); ctx.lineTo(26, -14); ctx.fill();
                ctx.beginPath(); ctx.moveTo(-22, -2); ctx.lineTo(-36, -10); ctx.lineTo(-24, 4); ctx.fill();
                ctx.fillStyle = '#ffd24a';
                ctx.fillRect(25, -11, 3, 3);
                break;
            }
            case 'claw':    // 할퀴기 (짧고 큰 발톱 자국)
                ctx.strokeStyle = 'rgba(255,240,240,0.95)';
                ctx.lineWidth = 6;
                for (const off of [-22, 0, 22]) {
                    ctx.beginPath();
                    ctx.moveTo(-d * 30, off - 20);
                    ctx.quadraticCurveTo(d * 10, off, -d * 20, off + 26);
                    ctx.stroke();
                }
                break;
            case 'minibat': {
                const flap = Math.sin(h.spin * 3) * 6;
                ctx.fillStyle = '#3a2a52';
                ctx.beginPath();
                ctx.moveTo(-14, -2 + flap); ctx.lineTo(0, -4); ctx.lineTo(14, -2 + flap); ctx.lineTo(0, 6);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#ff4a6a';
                ctx.fillRect(d * 3 - 1, -3, 2, 2);
                break;
            }
            default:
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    function drawBullet(b) {
        ctx.fillStyle = '#fff3a0';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawBeetle(e) {
        const cx = e.x + e.w / 2, by = e.y + e.h;
        if (!e.alive) {
            if (e.squash <= 0) return;
            ctx.globalAlpha = Math.min(1, e.squash * 2);
            ctx.fillStyle = '#5b3b8c';
            ctx.beginPath();
            ctx.ellipse(cx, by - 4, 17, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            return;
        }
        if (e.kind === 'spider') return drawSpiderling(e);
        if (e.kind === 'cub') {
            // 새끼 늑대: 늑대 무리 그림을 작게
            drawProjectile({ shape: 'wolfrun', x: cx, y: by - 12, vx: e.vx, spin: e.anim });
            return;
        }
        drawBeetleBody(cx, by, Math.sign(e.vx) || -1, 1, e.anim, '#5b3b8c', false);
    }

    function drawBeetleBody(cx, by, dir, s, anim, shell, angry) {
        ctx.save();
        ctx.translate(cx, by);
        ctx.scale(s, s);
        ctx.strokeStyle = '#2e1f47';
        ctx.lineWidth = 2;
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(i * 8, -8);
            ctx.lineTo(i * 8 + Math.sin(anim + i) * 3, 0);
            ctx.stroke();
        }
        ctx.fillStyle = shell;
        ctx.beginPath();
        ctx.ellipse(0, -12, 15, 11, 0, Math.PI, 0);
        ctx.lineTo(15, -7);
        ctx.lineTo(-15, -7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(0, -23);
        ctx.lineTo(0, -8);
        ctx.stroke();
        ctx.fillStyle = '#2e1f47';
        ctx.beginPath();
        ctx.arc(dir * 15, -10, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = angry ? '#ff4040' : '#fff';
        ctx.beginPath();
        ctx.arc(dir * 17, -12, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawBoss(b) {
        if (!b.alive || b.hidden) return;
        ctx.save();
        if (b.state === 'fakedead') {
            // 가짜 죽음: 뒤집혀 누워 있다
            ctx.translate(0, (b.y + b.h / 2) * 2);
            ctx.scale(1, -1);
            ctx.globalAlpha = 0.8;
        }
        BOSS_TYPES[b.type].draw(b, ctx, bossArt(b));
        ctx.restore();
    }

    function bossArt(b) {
        return {
            anim: game.anim,
            angry: diff().boss.enrage && b.hp <= b.maxHp / 2,   // 쉬움은 화내지(빨라지지) 않는다
            c: color => (b.flash > 0 ? '#ffffff' : color),     // 맞으면 하얗게 번쩍
            beetleBody: drawBeetleBody,
            acorn: drawAcorn,
            hard: diff().boss.hard,
            arena: { x0: b.arenaX0, x1: b.arenaX1 },
        };
    }

    function drawSpiderling(e) {
        const cx = e.x + e.w / 2, by = e.y + e.h;
        ctx.strokeStyle = '#1e1a24';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            for (const d of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(cx + d * 4, by - 10);
                ctx.lineTo(cx + d * (12 + i * 3), by - 16 + i * 3 + Math.sin(e.anim + i) * 2);
                ctx.lineTo(cx + d * (15 + i * 2), by);
                ctx.stroke();
            }
        }
        ctx.fillStyle = '#2a2232';
        ctx.beginPath();
        ctx.ellipse(cx, by - 11, 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff6a8a';
        const d = Math.sign(e.vx) || 1;
        ctx.fillRect(cx + d * 4 - 1, by - 14, 2, 2);
        ctx.fillRect(cx + d * 7 - 1, by - 13, 2, 2);
    }

    function drawFox(p) {
        const cx = p.x + p.w / 2, by = p.y + p.h;
        const running = p.onGround && p.vx !== 0;
        const leg = running ? Math.sin(p.anim) * 5 : 0;

        ctx.save();
        ctx.translate(cx, by);
        ctx.scale(p.facing * 0.78, 0.78);

        const wag = running ? Math.sin(p.anim * 1.3) * 0.15 : Math.sin(game.anim * 3) * 0.08;
        ctx.save();
        ctx.translate(-10, -16);
        ctx.rotate(-0.6 + wag);
        ctx.fillStyle = '#e8742a';
        ctx.beginPath();
        ctx.ellipse(-10, 0, 14, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(-21, 0, 5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#4a2a14';
        if (p.onGround) {
            ctx.fillRect(-9 + leg, -8, 5, 8);
            ctx.fillRect(4 - leg, -8, 5, 8);
        } else {
            ctx.fillRect(-10, -10, 5, 6);
            ctx.fillRect(5, -9, 5, 6);
        }

        ctx.fillStyle = '#e8742a';
        ctx.beginPath();
        ctx.ellipse(0, -16, 13, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fde7cf';
        ctx.beginPath();
        ctx.ellipse(5, -13, 7, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e8742a';
        ctx.beginPath();
        ctx.ellipse(8, -29, 10, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(1, -34); ctx.lineTo(4, -46); ctx.lineTo(9, -36);
        ctx.moveTo(8, -36); ctx.lineTo(14, -46); ctx.lineTo(16, -33);
        ctx.fill();
        ctx.fillStyle = '#fde7cf';
        ctx.beginPath();
        ctx.ellipse(15, -26, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(20, -27, 2, 0, Math.PI * 2);
        ctx.arc(11, -31, 1.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawParticles() {
        for (const pt of particles) {
            ctx.globalAlpha = Math.min(1, pt.life * 2);
            ctx.fillStyle = pt.color;
            ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
        }
        ctx.globalAlpha = 1;
    }

    function drawPopups() {
        ctx.font = `bold 18px ${FONT}`;
        ctx.textAlign = 'center';
        for (const pp of popups) {
            ctx.globalAlpha = Math.min(1, pp.t * 2);
            ctx.strokeStyle = pp.stroke || '#1d3b25';
            ctx.lineWidth = 3;
            ctx.strokeText(pp.text, pp.x, pp.y);
            ctx.fillStyle = pp.fill || '#b6ffca';
            ctx.fillText(pp.text, pp.x, pp.y);
        }
        ctx.globalAlpha = 1;
    }

    const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

    function drawHud() {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.roundRect(12, 12, VIEW_W - 24, 38, 10);
        ctx.fill();
        ctx.font = `bold 18px ${FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(`죽은 횟수 ${game.deaths}`, 28, 31);
        ctx.fillText(`시간 ${fmtTime(game.time)}`, 200, 31);
        ctx.fillText(diff().name, 330, 31);
        if (diff().hearts > 1) {
            const max = diff().hearts;
            ctx.fillStyle = '#ff6b8a';
            ctx.fillText('♥'.repeat(player.hp) + '♡'.repeat(max - player.hp), 385, 32);
            ctx.fillStyle = '#fff';
        }
        ctx.textAlign = 'right';
        const room = Math.floor(camX / ROOM_W) + 1;
        const rooms = stage.cols / ROOM_COLS;
        const areas = boss ? rooms - 1 : rooms;   // 보스 방은 구역 수에서 뺀다
        const where = boss && room === rooms ? `보스: ${boss.name}` : `구역 ${room} / ${areas}`;
        ctx.fillText(`${game.stageIndex + 1}. ${stage.name} · ${where}`, VIEW_W - 28, 31);
        ctx.textBaseline = 'alphabetic';

        if (boss && boss.active && boss.alive) {
            const w = 400, x = (VIEW_W - w) / 2, y = 62;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(x - 3, y - 3, w + 6, 18);
            ctx.fillStyle = '#d8434f';
            ctx.fillRect(x, y, w * (boss.hp / boss.maxHp), 12);
        }
    }

    function drawOverlay() {
        const best = game.best ? `최고 기록 (${diff().name}): ${game.best.deaths}번 죽고 ${fmtTime(game.best.time)}` : '';
        const pick = d => (game.difficulty === d ? `▶ ${DIFF[d].name} ◀` : DIFF[d].name);
        const lines = {
            title: [
                ['여우의 고난길', 54],
                ['죽어도 괜찮아요. 원래 그런 게임입니다.', 22],
                ['', 10],
                ['← → 이동   Space 점프 (공중에서 한 번 더)   Z 공격', 18],
                ['R 저장 지점에서 다시   P 일시정지', 18],
                ['', 10],
                [`난이도   ${pick('easy')}      ${pick('hard')}`, 26],
                [game.difficulty === 'easy'
                    ? '하트 3개 · 함정 앞 "!" 경고 · 보스 체력 절반'
                    : '한 번 닿으면 바로 기절', 17],
                ['← → 로 난이도 선택,  Enter 를 눌러 시작', 20],
                [loadReach() > 0 ? `C 를 누르면 ${loadReach() + 1}스테이지부터 이어하기 (기록은 남지 않아요)` : `스테이지 ${STAGES.length}개`, 16],
                [best, 17],
            ],
            paused: [['일시정지', 44], ['P 또는 Enter 로 계속', 20]],
            clear: [
                [`스테이지 ${game.stageIndex + 1} 클리어!`, 48],
                [`지금까지 ${game.deaths}번 죽고 ${fmtTime(game.time)}`, 22],
                ['', 8],
                [`다음: ${game.stageIndex + 2}. ${STAGES[game.stageIndex + 1]?.name ?? ''}`, 24],
                ['Enter 를 눌러 계속', 20],
            ],
            dead: [['기절!', 64], ['R 을 눌러 다시 시작', 22]],
            win: [
                ['드디어 집에 도착!', 50],
                [`${diff().name} · ${game.deaths}번 죽고 ${fmtTime(game.time)} 만에 클리어`, 24],
                [game.continued ? '이어하기로 클리어해서 기록은 남지 않아요' : game.newRecord ? '신기록!' : best, 20],
                ['Enter 를 눌러 타이틀로', 20],
            ],
        }[game.state];
        if (!lines) return;

        ctx.fillStyle = game.state === 'dead' ? 'rgba(60,0,0,0.35)' : 'rgba(15,10,30,0.65)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.textAlign = 'center';
        const total = lines.reduce((sum, [, size]) => sum + size * 1.6, 0);
        let y = VIEW_H / 2 - total / 2;
        for (const [text, size] of lines) {
            y += size * 1.6;
            ctx.font = `bold ${size}px ${FONT}`;
            ctx.fillStyle = game.state === 'dead' && size > 40 ? '#ff6b5b' : '#fff';
            ctx.fillText(text, VIEW_W / 2, y - size * 0.4);
        }
    }

    // ---------------------------------------------------------------- 메인 루프
    let last = performance.now();
    let acc = 0;
    function frame(now) {
        acc += Math.min(0.1, (now - last) / 1000);
        last = now;
        while (acc >= STEP) {
            update(STEP);
            acc -= STEP;
        }
        render();
        requestAnimationFrame(frame);
    }

    buildStage();
    requestAnimationFrame(frame);
})();
