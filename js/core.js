// 여우의 고난길 — 설정값, 입력, 게임 상태, 기록 저장, 온라인 랭킹 연결, 타일 충돌
// 모든 게임 스크립트는 전역 스코프를 공유한다 (index.html 의 <script> 순서대로 불러옴, 빌드 도구 없음).
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
        name: '쉬움', hearts: 3, bossHp: BOSS_HP / 2, warn: true, fakeHint: true, bestKey: 'foxHardBestEasy10', reachKey: 'foxHardReachEasy',
        boss: { speed: 0.85, enrage: false, rest: 1.2, hard: false },
    },
    hard: {
        name: '어려움', hearts: 1, bossHp: BOSS_HP, warn: false, fakeHint: false, bestKey: 'foxHardBest10', reachKey: 'foxHardReach',
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

const sfx = name => window.Sfx && window.Sfx.play(name);

function pressKey(code, repeat = false) {
    if (!repeat && code === 'KeyM' && window.Sfx) window.Sfx.toggleMute();
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

// 로그인·랭킹 창에서 글자를 칠 때는 게임 키로 받지 않는다
const modalOpen = () => !!document.querySelector('.modal:not([hidden])');
window.addEventListener('keydown', e => {
    if (modalOpen()) return;
    // 계정 줄 버튼에 포커스가 남아 있어도 Space / Enter 가 버튼을 누르지 않게
    if (e.target instanceof HTMLButtonElement && (GAME_KEYS.has(e.code) || e.code === 'Enter')) e.target.blur();
    if (GAME_KEYS.has(e.code) || e.code === 'Enter') e.preventDefault();
    pressKey(e.code, e.repeat);
});
window.addEventListener('keyup', e => releaseKey(e.code));
// 플레이 중에 로그인·랭킹 창을 열면 일시정지
document.addEventListener('focusin', e => {
    if (!e.target.closest || !e.target.closest('.modal')) return;
    keys.clear();
    if (game.state === 'playing') game.state = 'paused';
});
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
    online: null,       // 클리어 화면에 보여 줄 랭킹 등록 상태 문구
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
    sfx('select');
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
    // 온라인 랭킹과 같은 기준: 시간이 짧을수록, 같으면 덜 죽을수록 좋은 기록
    game.newRecord = !b || game.time < b.time || (game.time === b.time && game.deaths < b.deaths);
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
    game.online = null;
    sfx('start');
    pendingRun = null;
    buildStage();
    game.state = 'playing';
}

// ---------------------------------------------------------------- 온라인 랭킹 (js/online.js)
const online = () => (window.FoxOnline && window.FoxOnline.enabled ? window.FoxOnline : null);
let pendingRun = null;   // 로그인 안 하고 깬 기록: 클리어 화면에서 로그인하면 그때 올린다

function submitOnline() {
    const on = online();
    if (!on || game.continued) return;
    const run = { difficulty: game.difficulty, time: game.time, deaths: game.deaths };
    if (!on.profile) {
        pendingRun = run;
        game.online = '지금 로그인하면 이 기록이 랭킹에 올라가요';
        return;
    }
    pendingRun = null;
    game.online = '랭킹에 기록을 올리는 중…';
    on.submitScore(run)
        .then(({ rank }) => {
            game.online = rank
                ? `${diff().name} 랭킹 ${rank}위! (내 최고 기록 기준 · L 로 랭킹 보기)`
                : '랭킹에 기록했어요 (50위 밖) · L 로 랭킹 보기';
        })
        .catch(err => { game.online = `랭킹 등록 실패: ${err.message}`; });
}

if (online()) {
    online().onChange(profile => {
        if (profile && pendingRun && game.state === 'win') submitOnline();
    });
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
            else if (code === 'KeyL' && online()) online().openRanking(game.difficulty);
            break;
        case 'clear':
            if (code === 'Enter' || code === 'Space') nextStage();
            break;
        case 'win':
            if (code === 'Enter' || code === 'Space') game.state = 'title';   // 타이틀에서 난이도를 다시 고른다
            else if (code === 'KeyL' && online()) online().openRanking(game.difficulty);
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
