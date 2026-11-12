// 여우의 고난길 — 그리기 2: 함정·투사체, 여우불, 적, 보스, 여우, 효과, 상단 표시줄, 메뉴 화면
// 모든 게임 스크립트는 전역 스코프를 공유한다 (index.html 의 <script> 순서대로 불러옴, 빌드 도구 없음).
'use strict';

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
        drawShockwave(h, h.shape === 'lava' ? WAVE_COLORS.lava : WAVE_COLORS.wave);
    } else if (h.shape === 'beam') drawBeam(h);
    else drawProjectile(h);
}

const WAVE_COLORS = {
    wave: { core: [255, 250, 225], mid: [255, 205, 95], edge: [255, 150, 40] },
    lava: { core: [255, 235, 150], mid: [255, 120, 40], edge: [220, 40, 20] },
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * 바닥을 타고 가는 충격파.
 * 판정 상자(h.w × h.h)는 빈틈없이 채우고, 앞쪽은 볼록하게 부풀고 뒤쪽은 꼬리처럼 흩어진다.
 * 겹쳐 그리기(lighter)로 빛이 번지는 느낌을 낸다.
 */
function drawShockwave(h, col) {
    const d = Math.sign(h.vx) || 1;
    const top = h.y - h.h / 2, bot = h.y + h.h / 2, H = h.h;
    const front = h.x + d * h.w / 2, back = h.x - d * h.w / 2;
    const t = game.anim;
    const bulge = Math.max(8, Math.min(22, H * 0.09));
    const tail = Math.min(90, 24 + H * 0.3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 1) 뒤로 끌리는 속도선
    ctx.lineCap = 'round';
    const lines = Math.max(3, Math.round(H / 26));
    for (let i = 0; i < lines; i++) {
        const jitter = Math.sin(i * 12.9898) * 0.35;                  // 줄 간격을 일부러 고르지 않게
        const yy = top + H * ((i + 0.5 + jitter) / lines) + Math.sin(t * 17 + i * 2.1) * 3;
        const len = tail * (0.3 + 0.7 * Math.abs(Math.sin(i * 1.7 + t * 9)));
        const g = ctx.createLinearGradient(back, 0, back - d * len, 0);
        g.addColorStop(0, rgba(col.mid, 0.55));
        g.addColorStop(1, rgba(col.mid, 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = 2 + (i % 2) * 2;
        ctx.beginPath(); ctx.moveTo(back, yy); ctx.lineTo(back - d * len, yy); ctx.stroke();
    }

    // 2) 몸통: 뒤(투명) → 앞(밝음) 으로 진해지는 볼록한 벽
    const wobble = y => Math.sin(y * 0.09 + t * 28) * 2.5;
    const body = ctx.createLinearGradient(back - d * tail * 0.6, 0, front + d * bulge, 0);
    body.addColorStop(0, rgba(col.edge, 0));
    body.addColorStop(0.45, rgba(col.edge, 0.45));
    body.addColorStop(0.8, rgba(col.mid, 0.85));
    body.addColorStop(1, rgba(col.core, 0.95));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(back - d * tail * 0.6, bot);
    ctx.lineTo(front, bot);
    const steps = Math.max(4, Math.round(H / 12));
    for (let i = 1; i <= steps; i++) {               // 앞면: 가운데가 가장 볼록, 살짝 일렁인다
        const k = i / steps, y = bot - H * k;
        ctx.lineTo(front + d * (bulge * Math.sin(Math.PI * k) + wobble(y)), y);
    }
    ctx.lineTo(back, top);
    ctx.quadraticCurveTo(back - d * tail * 0.3, top + H * 0.25, back - d * tail * 0.6, top + H * 0.6);
    ctx.closePath();
    ctx.fill();

    // 3) 안쪽 물결 (앞면을 따라 겹쳐진 곡선)
    ctx.lineWidth = 2;
    for (let j = 0; j < 3; j++) {
        const off = ((t * 140 + j * 9) % 27);         // 앞에서 뒤로 흘러간다
        ctx.strokeStyle = rgba(col.core, 0.5 - off / 60);
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const k = i / steps, y = bot - H * k;
            const x = front - d * off + d * (bulge * 0.8 * Math.sin(Math.PI * k) + wobble(y + j * 20));
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
    }

    // 4) 앞면의 하얀 테두리
    ctx.strokeStyle = rgba(col.core, 0.95);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
        const k = i / steps, y = bot - H * k;
        const x = front + d * (bulge * Math.sin(Math.PI * k) + wobble(y));
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    // 5) 바닥이 쓸리며 빛나는 자국
    const glow = ctx.createRadialGradient(h.x, bot, 2, h.x, bot, 40 + bulge);
    glow.addColorStop(0, rgba(col.core, 0.7));
    glow.addColorStop(1, rgba(col.edge, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.ellipse(h.x, bot, 40 + bulge, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
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
    // 켜지는 순간 굵게 번쩍였다가 판정 두께로 가라앉는다
    const age = h.lifeMax ? 1 - h.life / h.lifeMax : 1;
    const pop = Math.max(0, 1 - age * 5);
    const flick = 0.85 + 0.15 * Math.sin(game.anim * 60);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 바깥 번짐 (판정보다 넓다: 보이는 것보다 판정이 작게)
    const half = h.h / 2 + 8 + pop * 14;
    const glow = ctx.createLinearGradient(0, h.y - half, 0, h.y + half);
    glow.addColorStop(0, 'rgba(0,0,0,0)');
    glow.addColorStop(0.5, colors[1]);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.7 * flick;
    ctx.fillStyle = glow;
    ctx.fillRect(x0, h.y - half, h.w, half * 2);
    ctx.globalAlpha = 1;
    if (h.kind === 'lightning') {
        for (const [wdt, c, amp] of [[7, colors[1], 1], [3, '#ffffff', 0.6]]) {
            ctx.strokeStyle = c;
            ctx.lineWidth = wdt;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x0, h.y);
            for (let x = x0 + 20; x <= x0 + h.w; x += 20) ctx.lineTo(x, h.y + (Math.random() - 0.5) * h.h * amp);
            ctx.stroke();
        }
    } else {
        // 판정 두께의 본체 + 하얀 심
        ctx.fillStyle = colors[1];
        ctx.fillRect(x0, h.y - h.h / 2, h.w, h.h);
        ctx.fillStyle = colors[0];
        const core = h.h * (0.25 + 0.1 * Math.sin(game.anim * 40));
        ctx.fillRect(x0, h.y - core, h.w, core * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(x0, h.y - core * 0.35, h.w, core * 0.7);
        // 윗가장자리에서 크기가 제각각인 불꽃 혀가 날름거린다
        if (h.kind === 'fire' || h.kind === 'lava') {
            const topY = h.y - h.h / 2;
            for (let x = x0 + 4; x < x0 + h.w - 4; x += 11) {
                const n = Math.sin(x * 0.17 + game.anim * 19) + Math.sin(x * 0.071 - game.anim * 11);
                const tall = 6 + (n + 2) * 5;
                const lean = Math.sin(x * 0.05 + game.anim * 7) * 4;
                ctx.fillStyle = n > 0.6 ? colors[0] : colors[1];
                ctx.globalAlpha = 0.65 + 0.35 * ((n + 2) / 4);
                ctx.beginPath();
                ctx.moveTo(x - 6, topY + 3);
                ctx.quadraticCurveTo(x - 4 + lean, topY - tall * 0.5, x + lean * 1.5, topY - tall);
                ctx.quadraticCurveTo(x + 4 + lean, topY - tall * 0.4, x + 6, topY + 3);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
    }
    ctx.restore();
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

/** 여우불: 꼬리가 뒤로 흩날리는 푸른 불꽃 */
function drawBullet(b) {
    const dir = Math.sign(b.vx) || 1;
    const flick = Math.sin((b.life + b.x) * 40) * 1.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 바깥 빛
    ctx.fillStyle = 'rgba(80, 170, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 9, 0, Math.PI * 2);
    ctx.fill();
    // 불꽃 몸통 + 꼬리
    ctx.fillStyle = '#4fb4ff';
    ctx.beginPath();
    ctx.moveTo(b.x + dir * 6, b.y);
    ctx.quadraticCurveTo(b.x, b.y - 7, b.x - dir * (14 + flick), b.y - 2 + flick * 0.6);
    ctx.quadraticCurveTo(b.x - dir * 4, b.y, b.x - dir * (12 - flick), b.y + 3);
    ctx.quadraticCurveTo(b.x, b.y + 7, b.x + dir * 6, b.y);
    ctx.fill();
    // 하얀 심지
    ctx.fillStyle = '#e8f6ff';
    ctx.beginPath();
    ctx.arc(b.x + dir * 1.5, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
        const k = Math.max(0, pt.life / pt.max);      // 1 → 0 으로 줄어든다
        ctx.save();
        if (pt.glow || pt.kind === 'ring') ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = ctx.strokeStyle = pt.color;
        switch (pt.kind) {
            case 'spark':
                ctx.globalAlpha = Math.min(1, k * 1.5);
                ctx.lineWidth = pt.size;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(pt.x, pt.y);
                ctx.lineTo(pt.x - pt.vx * 0.035, pt.y - pt.vy * 0.035);
                ctx.stroke();
                break;
            case 'chip':
                ctx.globalAlpha = Math.min(1, k * 3);
                ctx.translate(pt.x, pt.y);
                ctx.rotate(pt.rot);
                ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size * 0.7);
                break;
            case 'dust':
                ctx.globalAlpha = 0.55 * k;
                ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * (1.6 - k * 0.8), 0, Math.PI * 2); ctx.fill();
                break;
            case 'ring': {
                const e = 1 - k * k;                    // 처음에 빠르게 퍼진다
                const r = 4 + (pt.r1 - 4) * e;
                ctx.globalAlpha = k;
                ctx.lineWidth = Math.max(0.5, pt.width * k);
                ctx.beginPath(); ctx.ellipse(pt.x, pt.y, r, pt.flat ? r * 0.22 : r, 0, 0, Math.PI * 2); ctx.stroke();
                break;
            }
            default:
                ctx.globalAlpha = Math.min(1, k * 2);
                ctx.beginPath(); ctx.arc(pt.x, pt.y, Math.max(0.5, pt.size / 2 * (0.4 + 0.6 * k)), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
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
    if (window.Sfx && window.Sfx.muted) ctx.fillText('소리 끔', 500, 31);
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
    const best = game.best ? `최고 기록 (${diff().name}): ${fmtTime(game.best.time)} · ${game.best.deaths}번 죽음` : '';
    const pick = d => (game.difficulty === d ? `▶ ${DIFF[d].name} ◀` : DIFF[d].name);
    const lines = {
        title: [
            ['여우의 고난길', 54],
            ['죽어도 괜찮아요. 원래 그런 게임입니다.', 22],
            ['', 10],
            ['← → 이동   Space 점프 (공중에서 한 번 더)   Z 공격', 18],
            ['R 저장 지점에서 다시   P 일시정지   M 소리 끄기/켜기', 18],
            ['', 10],
            [`난이도   ${pick('easy')}      ${pick('hard')}`, 26],
            [game.difficulty === 'easy'
                ? '하트 3개 · 함정 앞 "!" 경고 · 가짜 바닥 표시 · 보스 체력 절반'
                : '한 번 닿으면 바로 기절', 17],
            ['← → 로 난이도 선택,  Enter 를 눌러 시작', 20],
            [loadReach() > 0 ? `C 를 누르면 ${loadReach() + 1}스테이지부터 이어하기 (기록은 남지 않아요)` : `스테이지 ${STAGES.length}개`, 16],
            [best, 17],
            ...(online() ? [['L 을 누르면 온라인 랭킹', 15]] : []),
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
            ...(game.online ? [[game.online, 18]] : []),
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
