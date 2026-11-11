// 여우의 고난길 — 그리기 1: 배경, 타일, 스테이지 기믹, 표지판, 저장 지점
// 모든 게임 스크립트는 전역 스코프를 공유한다 (index.html 의 <script> 순서대로 불러옴, 빌드 도구 없음).
'use strict';

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
            if (t === '#') drawDirt(c, r, x, y);
            else if (t === 'F') drawFake(c, r, x, y);
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
    // 여우불은 스스로 빛나서 어둠 속에서도 보인다 (주변을 밝히지는 않음)
    bullets.forEach(drawBullet);
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

/** 가짜 블록: 어려움에서는 흙과 똑같고, 쉬움에서는 반투명 + 점선 테두리로 티가 난다 */
function drawFake(c, r, x, y) {
    if (!diff().fakeHint) { drawDirt(c, r, x, y); return; }
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.08 * Math.sin(performance.now() / 300);   // 살짝 일렁인다
    drawDirt(c, r, x, y);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    // 이웃한 가짜 블록 쪽 변은 그리지 않아 덩어리 하나로 보이게 한다
    const L = x + 1, T = y + 1, R = x + TILE - 1, B = y + TILE - 1;
    const edges = [[0, -1, L, T, R, T], [0, 1, L, B, R, B], [-1, 0, L, T, L, B], [1, 0, R, T, R, B]];
    ctx.beginPath();
    for (const [dc, dr, x0, y0, x1, y1] of edges) {
        if (tileAt(c + dc, r + dr) === 'F') continue;
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.restore();
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
