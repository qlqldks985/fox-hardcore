// 보스 정의
// 원칙: 보스의 공격은 "가로 방향"으로만 날아간다 (위에서 덮치거나 떨어뜨리지 않는다).
// 높이(low 바닥 / high 점프 높이 / plank 발판 높이)에 따라 피하는 법이 달라진다.
//   low   : 점프로 넘거나 발판 위로
//   high  : 바닥에 가만히 서 있으면 머리 위로 지나간다 (점프하면 맞음)
//   plank : 발판에서 내려오거나 그 자리에서 점프
// 보스마다 고유 기술이 하나씩 있고, 어려움(a.hard)에서는 "억까" 패턴이 추가된다.
//
// 보스 상태는 숫자/문자열만 쓴다 (탐색 봇이 상태를 복사할 수 있게). 각 보스는
//   start(b, a, pattern) : 다음 패턴 시작
//   think(b, a)          : 패턴 진행 (끝나면 a.rest(b))
//   idle(b, a)           : 쉬는 동안
//   onZero(b, a)         : 체력이 0 이 됐을 때. true 를 돌려주면 아직 죽지 않는다 (가짜 죽음 등)
//   draw / drawBack / drawGlow : 그리기 (drawBack 은 타일보다 먼저, drawGlow 는 어둠 위에)

const BOSS_TYPES = (() => {
    const T = 40;
    const GROUND = 12 * T;
    const LANE = { low: GROUND - 16, high: GROUND - 62, plank: 8 * T - 15 };
    const other = lane => (lane === 'low' ? 'plank' : 'low');

    // ---- 공통 패턴 조각
    function startCharge(b, a, windup = 0.6) {
        b.state = 'windup';
        b.back = 0;
        b.feint = 0;
        b.dir = a.toPlayer;
        b.t = windup / a.fast;
    }
    /** 돌진. 어려움: 중간에 멈칫했다가(페이크) 다시 달리고, 벽에 부딪히면 되돌아온다 */
    function chargeThink(b, a, speed) {
        if (b.state === 'windup') {
            b.vx = 0;
            if (b.t <= 0) { b.state = 'charge'; b.vx = b.dir * speed * a.fast; b.t = 0.3; }
        } else if (b.state === 'feint') {
            b.vx = 0;
            if (b.t <= 0) { b.state = 'charge'; b.vx = b.dir * speed * 1.15 * a.fast; b.t = 99; }
        } else if (b.state === 'charge') {
            if (a.hard && !b.feint && b.t <= 0) { b.feint = 1; b.state = 'feint'; b.t = 0.4; b.vx = 0; return; }
            if (b.hitWall) {
                b.vx = 0;
                a.shake(0.25);
                if (a.hard && !b.back) { b.back = 1; b.feint = 1; b.dir = -b.dir; b.state = 'windup'; b.t = 0.45 / a.fast; }
                else a.rest(b);
            }
        }
    }
    /** 보스 양옆으로 바닥을 따라 퍼지는 파도.
     *  tall 을 주면 그 높이의 큰 충격파가 된다: 발판 밑을 지날 때만 발판 아래까지 낮아진다 (world.js 의 waveTop) */
    function groundWaves(b, a, shape, speed, h, tall = 0) {
        for (const d of [-1, 1]) {
            a.spawn({ shape, x: d > 0 ? b.x + b.w + 15 : b.x - 15, y: GROUND - h / 2, w: 26, h, vx: d * speed * a.fast, tall });
        }
    }
    const shaking = () => (Math.random() - 0.5) * 6;
    const sideX = (b, a) => (b.side > 0 ? a.arena.x1 - 50 - b.w : a.arena.x0 + 50);
    const midX = (b, a) => a.arena.mid - b.w / 2;
    const reachedSide = (b, a, margin = 50) =>
        (b.side > 0 && b.x <= a.arena.x0 + margin) || (b.side < 0 && b.x + b.w >= a.arena.x1 - margin);

    // ---- 그리기 도우미
    function eye(ctx, x, y, r, color) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
    function crown(ctx, cx, top, s = 1) {
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath();
        ctx.moveTo(cx - 22 * s, top + 10 * s);
        ctx.lineTo(cx - 22 * s, top - 8 * s);
        ctx.lineTo(cx - 11 * s, top + 2 * s);
        ctx.lineTo(cx, top - 14 * s);
        ctx.lineTo(cx + 11 * s, top + 2 * s);
        ctx.lineTo(cx + 22 * s, top - 8 * s);
        ctx.lineTo(cx + 22 * s, top + 10 * s);
        ctx.closePath();
        ctx.fill();
    }
    function ellipse(ctx, x, y, rx, ry, color, rot = 0) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
    }

    // ---- 다람쥐 대장의 나무 구멍 (방 기준 위치)
    function holes(a) {
        const x0 = a.arena.x0, x1 = a.arena.x1;
        return [
            { x: x0 + 40, lane: 'low' }, { x: x0 + 40, lane: 'plank' },
            { x: x1 - 104, lane: 'low' }, { x: x1 - 104, lane: 'plank' },
            { x: a.arena.mid - 32, lane: 'low' },
        ];
    }
    const holeY = (h, bh) => (h.lane === 'low' ? GROUND - bh : LANE.plank - bh / 2);

    return {
        // ================================================================ 1. 딱정벌레 대왕
        // 기본기: 도토리 연사, 충격파(발판 위로 피한다), 돌진.
        // 억까: 돌진 중 멈칫(페이크), 쓰러진 척하다가 출구에 다가가면 벌떡 일어난다.
        beetle: {
            name: '딱정벌레 대왕', w: 110, h: 80, hp: 1,
            order: ['volley', 'jump', 'volley', 'charge'],
            start(b, a, p) {
                if (p === 'volley') {
                    b.state = 'volley'; b.n = a.fast > 1 ? 4 : 3; b.total = b.n; b.k = 0; b.t = 0.6;
                } else if (p === 'jump') {
                    b.state = 'jump'; b.vy = -950; b.vx = 0; b.onGround = false; b.n = a.hard ? 2 : 1;
                } else startCharge(b, a);
            },
            think(b, a) {
                switch (b.state) {
                    case 'volley':
                        b.vx = 0; b.dir = a.toPlayer;
                        if (b.t <= 0) {
                            a.shot(b, { shape: 'acorn', lane: a.hard && b.k % 2 ? 'high' : 'low', speed: 360, w: 18, h: 22 });
                            b.k++; b.n--; b.t = 0.8;
                            if (b.n <= 0) a.rest(b);
                        }
                        break;
                    case 'jump':
                        if (b.landed) {
                            b.vx = 0; a.shake(0.3);
                            a.impact(b.x + b.w / 2, GROUND, b.w);
                            // 이단 점프로도 못 넘는 높이 (최대 약 220px) → 발판 위로 올라가야만 피할 수 있다
                            groundWaves(b, a, 'wave', 420, 24, 240);
                            if (--b.n > 0) { b.vy = -760; b.onGround = false; } else a.rest(b);
                        }
                        break;
                    case 'fakedead': {
                        b.vx = 0;
                        const g = a.goal;
                        const px = a.player.x + a.player.w / 2;
                        if (Math.abs(px - (g.x + g.w / 2)) < 170) {
                            b.revived = 1; b.ghost = 0;
                            b.hp = Math.ceil(b.maxHp * 0.35);
                            a.showGoal(false);
                            a.popup('속았지?', b.x + b.w / 2, b.y - 30);
                            a.shake(0.5);
                            startCharge(b, a, 0.35);
                        }
                        break;
                    }
                    default: chargeThink(b, a, 520);
                }
            },
            onZero(b, a) {
                if (!a.hard || b.revived) return false;
                b.state = 'fakedead'; b.ghost = 1; b.vx = 0;
                a.clearShots();
                a.showGoal(true);
                return true;
            },
            draw(b, ctx, g) {
                const aiming = b.state === 'volley' && (b.n === b.total || b.t < 0.35);
                const sx = b.state === 'windup' || b.state === 'feint' || aiming ? shaking() : 0;
                const cx = b.x + b.w / 2 + sx, by = b.y + b.h;
                g.beetleBody(cx, by, b.dir, 3.6, b.anim, g.c(g.angry || b.revived ? '#8c3b5b' : '#5b3b8c'), g.angry || b.revived);
                crown(ctx, cx, by - 3.6 * 23 - 4);
            },
        },

        // ================================================================ 2. 박쥐 여왕 (어두운 동굴)
        // 고유: 박쥐 떼(세 높이 중 한 곳만 비운 무리), 바닥 활강.
        // 억까: 활강할 때 불을 꺼서 눈만 보인다, 음파 일부가 등 뒤 벽에서 날아온다.
        bat: {
            name: '박쥐 여왕', w: 84, h: 56, hp: 0.8, fly: true,
            order: ['rings', 'swarm', 'swoop', 'swarm', 'rings', 'swoop'],
            init(b) { b.side = 1; },
            home(b, a) { return [sideX(b, a), LANE.plank - b.h / 2]; },
            idle(b, a) { a.fly(b, ...this.home(b, a), 260); b.dir = a.toPlayer; b.dark = 0; },
            start(b, a, p) {
                if (p === 'rings') { b.state = 'rings'; b.n = a.hard ? 5 : 3; b.k = 0; b.t = 0.5; }
                else if (p === 'swarm') { b.state = 'swarm'; b.n = a.hard ? 4 : 2; b.k = b.flip ^= 1; b.t = 0.7; }
                else { b.state = 'dive'; b.back = 0; }
            },
            think(b, a) {
                switch (b.state) {
                    case 'rings':
                        if (!a.fly(b, ...this.home(b, a), 300)) { b.t = Math.max(b.t, 0.5); return; }
                        b.dir = a.toPlayer;
                        if (b.t <= 0) {
                            const lane = a.hard && b.k % 2 ? 'low' : 'plank';
                            if (a.hard && b.k % 3 === 2) {
                                // 억까: 등 뒤 벽에서 날아오는 음파
                                a.wallShot(-b.side, { shape: 'ring', lane: other(lane), speed: 300, w: 26, h: 30 });
                            } else a.shot(b, { shape: 'ring', lane, speed: 330, w: 26, h: 30 });
                            b.k++; b.n--; b.t = 0.7;
                            if (b.n <= 0) a.rest(b);
                        }
                        break;
                    case 'swarm':
                        // 박쥐 떼: 세 높이 중 한 곳만 비어 있다
                        if (!a.fly(b, ...this.home(b, a), 300)) { b.t = Math.max(b.t, 0.6); return; }
                        b.dir = -b.side;
                        if (b.t <= 0) {
                            const gaps = ['high', 'low', 'plank'];
                            const gap = gaps[b.k % 3];
                            for (const lane of ['low', 'high', 'plank']) {
                                if (lane === gap) continue;
                                for (const dy of [-8, 8]) {
                                    a.spawn({ shape: 'minibat', x: b.side > 0 ? a.arena.x1 - 10 : a.arena.x0 + 10, y: LANE[lane] + dy,
                                        w: 24, h: 12, vx: -b.side * 300 * a.fast });
                                }
                            }
                            b.k++; b.n--; b.t = 1.0;
                            if (b.n <= 0) a.rest(b);
                        }
                        break;
                    case 'dive':
                        if (a.fly(b, sideX(b, a), GROUND - b.h, 320)) { b.state = 'cry'; b.t = 0.55; }
                        break;
                    case 'cry':
                        b.vx = 0; b.vy = 0; b.dir = -b.side;
                        if (a.hard) b.dark = 1;   // 억까: 불이 꺼진다
                        if (b.t <= 0) { b.state = 'dash'; b.vx = -b.side * 560 * a.fast; }
                        break;
                    case 'dash':
                        if (reachedSide(b, a)) {
                            b.side = -b.side; b.vx = 0;
                            if (a.hard && !b.back) { b.back = 1; b.state = 'cry'; b.t = 0.4; }
                            else { b.dark = 0; a.rest(b); }
                        }
                        break;
                }
            },
            draw(b, ctx, g) {
                const sx = b.state === 'cry' ? shaking() : 0;
                const cx = b.x + b.w / 2 + sx, cy = b.y + b.h / 2;
                const flap = Math.sin(b.anim * 2.2) * 14;
                ctx.fillStyle = g.c('#3a2a52');
                for (const d of [-1, 1]) {
                    ctx.beginPath();
                    ctx.moveTo(cx + d * 12, cy - 6);
                    ctx.lineTo(cx + d * 58, cy - 20 + flap);
                    ctx.lineTo(cx + d * 48, cy + 6 + flap * 0.5);
                    ctx.lineTo(cx + d * 36, cy + 2 + flap * 0.3);
                    ctx.lineTo(cx + d * 24, cy + 12);
                    ctx.closePath();
                    ctx.fill();
                }
                ellipse(ctx, cx, cy, 22, 24, g.c('#4b3768'));
                ctx.fillStyle = g.c('#4b3768');
                ctx.beginPath();
                ctx.moveTo(cx - 16, cy - 16); ctx.lineTo(cx - 12, cy - 36); ctx.lineTo(cx - 4, cy - 20);
                ctx.moveTo(cx + 16, cy - 16); ctx.lineTo(cx + 12, cy - 36); ctx.lineTo(cx + 4, cy - 20);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillRect(cx - 5, cy + 8, 3, 5); ctx.fillRect(cx + 2, cy + 8, 3, 5);
                crown(ctx, cx, cy - 30, 0.6);
            },
            drawGlow(b, ctx) {
                // 어둠 속에서도 붉은 눈은 보인다
                const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
                for (const d of [-1, 1]) {
                    ctx.fillStyle = 'rgba(255,40,60,0.35)';
                    ctx.beginPath(); ctx.arc(cx + d * 8 + b.dir * 3, cy - 6, 10, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#ff3a4a';
                    ctx.beginPath(); ctx.arc(cx + d * 8 + b.dir * 3, cy - 6, 4, 0, Math.PI * 2); ctx.fill();
                }
            },
        },

        // ================================================================ 3. 천둥 구름 (돌풍 언덕)
        // 고유: 방 끝까지 닿는 가로 번개, 돌풍(밀어내기 + 맞바람 구름 덩이), 발판 높이로 내려와 떠다니기.
        // 억까: 번개 예고선이 마지막 순간에 다른 높이로 바뀐다, 발판 번개는 발판을 태운다, 돌풍 방향이 갑자기 뒤집힌다.
        cloud: {
            name: '천둥 구름', w: 140, h: 70, hp: 0.75, fly: true,
            order: ['bolt', 'gust', 'drift', 'bolt', 'drift'],
            init(b) { b.flip = 0; },
            idle(b, a) {
                const tx = Math.max(a.arena.x0 + 20, Math.min(a.arena.x1 - b.w - 20, a.player.x - b.w / 2));
                a.fly(b, tx, 50, 120);
            },
            start(b, a, p) {
                if (p === 'bolt') { b.state = 'bolt'; b.flip ^= 1; b.n = a.hard ? 3 : 2; b.total = b.n; b.t = 0.2; }
                else if (p === 'gust') {
                    b.state = 'gust'; b.t = 2.6; b.k = 0; b.n = 0.5;
                    b.side = a.player.x + 10 < a.arena.mid ? -1 : 1;   // 여우를 벽 쪽으로 민다
                } else {
                    b.state = 'drift_go';
                    b.side = a.player.x + 10 < a.arena.mid ? 1 : -1;
                }
            },
            think(b, a) {
                const warn = a.hard ? 0.75 : 1.0, life = 0.45;
                switch (b.state) {
                    case 'bolt':
                        this.idle(b, a);
                        if (b.t > 0) break;
                        if (b.n > 0) {
                            const i = b.total - b.n;
                            const lane = (i + b.flip) % 2 ? 'low' : 'plank';
                            // 억까: 두 번째 번개는 반대 높이에 예고했다가 막판에 진짜 높이로 바뀐다.
                            // 번개가 치는 높이는 항상 위/아래 번갈아 (예고선만 속임수).
                            const fake = a.hard && i === 1;
                            a.beam({
                                x0: a.arena.x0, x1: a.arena.x1, y: LANE[fake ? other(lane) : lane], h: 26, warn, life, kind: 'lightning',
                                ...(fake ? { switchTo: LANE[lane], switchAt: 0.45 } : {}),
                            });
                            const strikesPlank = lane === 'plank';
                            if (a.hard && strikesPlank) {
                                // 발판 번개는 발판을 잠깐 태워 없앤다
                                for (const x of [a.arena.x0 + 6 * T, a.arena.x1 - 7 * T]) {
                                    const cells = a.plankAt(x);
                                    if (cells) a.timedTiles(cells, '.', warn, 2.5, 'burn');
                                }
                            }
                            b.n--;
                            b.t = b.n > 0 ? 0.7 : warn + life;
                        } else a.rest(b);
                        break;
                    case 'gust':
                        // 돌풍: 여우를 벽 쪽으로 밀고, 맞바람으로 구름 덩이가 날아온다
                        a.fly(b, b.side > 0 ? a.arena.x0 + 20 : a.arena.x1 - b.w - 20, 50, 200);
                        b.wind = b.side * 170 * (a.hard && b.t < 1.3 ? -1.2 : 1);   // 억까: 갑자기 반대로
                        b.n -= a.dt;
                        if (b.n <= 0) {
                            a.wallShot(b.side, { shape: 'puff', lane: a.hard && b.k % 2 ? 'high' : 'low', speed: 230, w: 24, h: 24 });
                            b.k++; b.n = 0.75;
                        }
                        if (b.t <= 0) a.rest(b);
                        break;
                    case 'drift_go':
                        if (a.fly(b, b.side > 0 ? a.arena.x1 - b.w - 20 : a.arena.x0 + 20, 50, 260)) b.state = 'drift_down';
                        break;
                    case 'drift_down':
                        if (a.fly(b, b.x, LANE.plank - b.h / 2, 170)) { b.state = 'drift'; b.t = 1.2; }
                        break;
                    case 'drift':
                        // 발판 높이로 천천히 가로질러 간다 (발판 위에서 쏘면 맞는다, 닿으면 아프다)
                        b.vy = 0; b.vx = -b.side * 110 * a.fast; b.dir = a.toPlayer;
                        if (a.hard && b.t <= 0) { a.shot(b, { shape: 'puff', lane: 'plank', speed: 260, w: 24, h: 24 }); b.t = 1.2; }
                        if (reachedSide(b, a, 20)) { b.vx = 0; b.state = 'drift_up'; }
                        break;
                    case 'drift_up':
                        if (a.fly(b, b.x, 50, 200)) a.rest(b);
                        break;
                }
            },
            draw(b, ctx, g) {
                const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
                const charging = b.state === 'bolt';
                const col = g.c(charging ? '#5a5a78' : '#7a7a96');
                for (const [dx, dy, r] of [[-44, 8, 26], [-18, -10, 32], [16, -6, 34], [46, 8, 26], [0, 14, 30]]) {
                    ellipse(ctx, cx + dx, cy + dy, r, r * 0.85, col);
                }
                ellipse(ctx, cx, cy + 20, 60, 12, g.c('#5c5c76'));
                ctx.fillStyle = charging || g.angry ? '#ffe14d' : '#2a2a3a';
                ctx.beginPath();
                ctx.moveTo(cx - 28, cy - 4); ctx.lineTo(cx - 10, cy + 2); ctx.lineTo(cx - 26, cy + 6); ctx.closePath();
                ctx.moveTo(cx + 28, cy - 4); ctx.lineTo(cx + 10, cy + 2); ctx.lineTo(cx + 26, cy + 6); ctx.closePath();
                ctx.fill();
                if (b.state === 'gust') {
                    // 볼을 부풀려 바람을 분다
                    ellipse(ctx, cx - b.side * 70, cy + 6, 14, 10, '#c8c8dc');
                }
                if (charging && Math.floor(g.anim * 10) % 2) {
                    ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(cx - 6, cy + 26); ctx.lineTo(cx + 4, cy + 38); ctx.lineTo(cx - 2, cy + 40); ctx.lineTo(cx + 8, cy + 54);
                    ctx.stroke();
                }
            },
        },

        // ================================================================ 4. 독두꺼비 (버섯 늪)
        // 고유: 혀로 붙잡아 끌어당기기(점프로 탈출), 독 방울이 멈추면 독 웅덩이가 된다, 버섯 트램펄린 방.
        // 억까: 앞으로 혀를 뻗은 직후 뒤쪽으로도 혀를 휘두른다.
        toad: {
            name: '독두꺼비', w: 100, h: 66, hp: 1,
            order: ['tongue', 'spit', 'tongue', 'walk'],
            tongue(b, a, dir, warn) {
                const lane = a.playerOnPlank ? 'plank' : 'low';   // 여우가 있는 높이를 노린다
                const mouth = dir > 0 ? b.x + b.w - 6 : b.x + 6;
                a.beamToWall(mouth, dir, { y: LANE[lane], h: 22, warn, life: 0.4, kind: 'tongue', grab: true });
            },
            start(b, a, p) {
                b.dir = a.toPlayer;
                if (p === 'tongue') {
                    b.state = 'tongue';
                    const warn = a.hard ? 0.5 : 0.7;
                    this.tongue(b, a, b.dir, warn);
                    b.t = warn + 0.4;
                    b.k = 0;
                    if (a.hard) b.t += 0.1;
                } else if (p === 'spit') {
                    b.state = 'spit'; b.n = a.hard ? 4 : 3; b.k = 0; b.t = 0.5;
                } else {
                    b.state = 'walk'; b.t = 0.45; b.back = 0;
                }
            },
            think(b, a) {
                switch (b.state) {
                    case 'tongue':
                        b.vx = 0;
                        if (b.t <= 0) {
                            if (a.hard && !b.k) {
                                // 억까: 뒤로 한 번 더 (방금 뒤로 피한 여우를 노린다)
                                b.k = 1; b.dir = -b.dir;
                                this.tongue(b, a, b.dir, 0.3);
                                b.t = 0.75;
                            } else a.rest(b);
                        }
                        break;
                    case 'spit':
                        // 독 방울: 굴러가다 멈추면 3초 동안 독 웅덩이
                        b.vx = 0; b.dir = a.toPlayer;
                        if (b.t <= 0) {
                            const lane = a.hard && b.k % 2 ? 'high' : 'low';
                            a.shot(b, {
                                shape: 'poison', lane, speed: 330, w: 20, h: 20,
                                ...(lane === 'low' ? { ax: -b.dir * 260 * a.fast * a.fast, toPuddle: b.dir } : {}),
                            });
                            b.k++; b.n--; b.t = 0.8;
                            if (b.n <= 0) a.rest(b);
                        }
                        break;
                    case 'walk':
                        if (b.t > 0) { b.vx = 0; break; }
                        b.vx = b.dir * (a.hard ? 240 : 170) * a.fast;
                        if (b.hitWall) {
                            b.vx = 0;
                            if (a.hard && !b.back) { b.back = 1; b.dir = -b.dir; b.t = 0.25; } else a.rest(b);
                        }
                        break;
                }
            },
            draw(b, ctx, g) {
                const cx = b.x + b.w / 2, by = b.y + b.h;
                const squat = b.state === 'walk' && b.t > 0 ? 6 : 0;
                const hop = b.state === 'walk' && b.t <= 0 ? Math.abs(Math.sin(b.anim * 1.5)) * 6 : 0;
                const y = by - hop;
                ellipse(ctx, cx, y - 26 + squat / 2, 50, 28 - squat / 2, g.c(g.angry ? '#6a8a2a' : '#4f8a3a'));
                ellipse(ctx, cx, y - 16, 40, 14, g.c('#c8d890'));
                for (const [dx, dy] of [[-24, -40], [8, -46], [26, -32], [-6, -30]]) ellipse(ctx, cx + dx, y + dy, 6, 4, g.c('#8a5aa8'));
                for (const d of [-1, 1]) {
                    ellipse(ctx, cx + d * 22 + b.dir * 8, y - 52, 12, 12, g.c('#4f8a3a'));
                    eye(ctx, cx + d * 22 + b.dir * 10, y - 54, 7, g.angry ? '#ff3030' : '#222');
                }
                const open = b.state === 'tongue' ? 10 : 2;
                ctx.fillStyle = '#7a1e3a';
                ctx.beginPath();
                ctx.ellipse(cx + b.dir * 40, y - 24, 12, open, 0, 0, Math.PI * 2);
                ctx.fill();
                crown(ctx, cx, y - 66, 0.7);
            },
        },

        // ================================================================ 5. 다람쥐 대장 (단풍 숲)
        // 고유: 나무 구멍 숨바꼭질 (구멍에서 나왔을 때만 맞는다, 나오기 전에 그 구멍 낙엽이 흔들린다),
        //       도토리 부메랑, 가운데 구멍에서 큰 도토리 굴리기.
        // 억까: 가짜 다람쥐가 다른 구멍에서 같이 나와 진짜처럼 던진다 (맞혀도 소용없음).
        squirrel: {
            name: '다람쥐 대장', w: 64, h: 80, hp: 0.9, fly: true,
            order: ['peek', 'peek', 'roll', 'peek', 'boom'],
            init(b) { b.hidden = 1; b.hole = -1; b.decoy = -1; b.k = 0; },
            idle(b) { b.hidden = 1; b.decoy = -1; },
            pick(b, a) {
                // 여우와 가장 먼 구멍 두 개 중 하나 (번갈아)
                const hs = holes(a).map((h, i) => ({ i, d: Math.abs(h.x - a.player.x) }));
                hs.sort((p, q) => q.d - p.d);
                b.k++;
                return hs[b.k % 2].i;
            },
            start(b, a, p) {
                const hs = holes(a);
                b.hole = p === 'roll' ? 4 : this.pick(b, a);
                b.decoy = a.hard && p !== 'roll' ? (b.hole + 2) % 4 : -1;
                b.mode = p;
                b.state = 'rustle'; b.t = 0.55;
                const h = hs[b.hole];
                a.place(b, h.x, holeY(h, b.h));
            },
            think(b, a) {
                const hs = holes(a);
                const h = hs[b.hole];
                switch (b.state) {
                    case 'rustle':   // 구멍 낙엽이 흔들린다 (예고)
                        if (b.t <= 0) {
                            b.hidden = 0; b.state = 'out'; b.t = 0.35;
                            b.n = b.mode === 'peek' ? (a.hard ? 3 : 2) : b.mode === 'roll' ? (a.hard ? 3 : 2) : 1;
                        }
                        break;
                    case 'out':
                        b.dir = a.toPlayer;
                        if (b.t > 0) break;
                        if (b.mode === 'roll') {
                            a.spawn({ shape: 'big', x: b.x + b.w / 2 + b.dir * 40, y: GROUND - 20, w: 34, h: 36, vx: b.dir * 300 * a.fast });
                            b.t = 1.0;
                        } else {
                            const throwFrom = (x, lane) => {
                                const dir = Math.sign(a.player.x - x) || 1;
                                const opts = b.mode === 'boom'
                                    ? { shape: 'boom', w: 22, h: 22, ax: -dir * 290 * a.fast * a.fast, speed: 540 }
                                    : { shape: 'acorn', w: 18, h: 22, speed: 380 };
                                a.spawn({ ...opts, x: x + 32 + dir * 40, y: LANE[lane], vx: dir * opts.speed * a.fast });
                            };
                            const lane = a.hard && b.n % 2 === 0 ? (h.lane === 'low' ? 'high' : 'plank') : h.lane;
                            throwFrom(b.x, lane);
                            if (b.decoy >= 0) throwFrom(hs[b.decoy].x, hs[b.decoy].lane);   // 가짜도 던진다
                            b.t = b.mode === 'boom' ? 1.6 : 0.75;
                        }
                        if (--b.n <= 0) { b.state = 'stay'; b.t = 0.6; }
                        break;
                    case 'stay':     // 던지고 잠깐 머문다 (이때 맞히기)
                        if (b.t <= 0) { b.hidden = 1; b.decoy = -1; a.rest(b, 0.8); }
                        break;
                }
            },
            drawBack(b, ctx, g) {
                // 나무 기둥 세 개와 구멍
                const x0 = g.arena.x0, x1 = g.arena.x1, mid = (x0 + x1) / 2;
                for (const tx of [x0 + 30, x1 - 114, mid - 42]) {
                    ctx.fillStyle = '#6a3e20';
                    ctx.fillRect(tx, 120, 84, GROUND - 120);
                    ctx.fillStyle = '#5a321a';
                    ctx.fillRect(tx + 10, 120, 8, GROUND - 120);
                    ctx.fillStyle = '#d0702a';
                    ctx.beginPath(); ctx.ellipse(tx + 42, 120, 70, 40, 0, 0, Math.PI * 2); ctx.fill();
                }
                const fakeA = { arena: { x0, x1, mid } };
                holes(fakeA).forEach((h, i) => {
                    const y = holeY(h, 80);
                    const rustling = b.alive && b.state === 'rustle' && (i === b.hole || i === b.decoy);
                    ctx.fillStyle = '#1e120a';
                    ctx.beginPath(); ctx.ellipse(h.x + 32 + (rustling ? shaking() : 0), y + 40, 26, 34, 0, 0, Math.PI * 2); ctx.fill();
                    if (rustling) {
                        ctx.fillStyle = '#f0a03a';
                        for (let k = 0; k < 4; k++) {
                            ctx.beginPath();
                            ctx.ellipse(h.x + 32 + shaking() * 3, y + 10 + k * 18, 6, 3, k, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                });
            },
            drawOne(ctx, g, x, y, d, angry, flashC) {
                const cx = x + 32, by = y + 80;
                ctx.fillStyle = flashC('#b8642a');
                ctx.beginPath(); ctx.ellipse(cx - d * 26, by - 50, 18, 34, -d * 0.4, 0, Math.PI * 2); ctx.fill();
                ellipse(ctx, cx + d * 4, by - 30, 22, 28, flashC(angry ? '#a8442a' : '#c0702e'));
                ellipse(ctx, cx + d * 8, by - 26, 12, 18, flashC('#f2d2a6'));
                ellipse(ctx, cx + d * 12, by - 62, 17, 15, flashC('#c0702e'));
                eye(ctx, cx + d * 18, by - 66, 4, angry ? '#ff3030' : '#222');
                ellipse(ctx, cx + d * 28, by - 60, 4, 3, '#3a2010');
                ctx.fillStyle = '#6b3e1e';
                ctx.beginPath(); ctx.ellipse(cx + d * 10, by - 74, 17, 8, 0, Math.PI, 0); ctx.fill();
                ctx.fillRect(cx + d * 10 - 2, by - 86, 4, 8);
            },
            draw(b, ctx, g) {
                this.drawOne(ctx, g, b.x, b.y, b.dir, g.angry, g.c);
                if (b.decoy >= 0 && b.state !== 'rustle') {
                    // 가짜 다람쥐 (진짜와 똑같이 생겼다)
                    const fakeA = { arena: g.arena };
                    fakeA.arena.mid = (g.arena.x0 + g.arena.x1) / 2;
                    const h = holes(fakeA)[b.decoy];
                    this.drawOne(ctx, g, h.x, holeY(h, b.h), b.dir, g.angry, c => c);
                }
            },
        },

        // ================================================================ 6. 얼음 고슴도치 (얼음 동굴, 미끄러운 바닥)
        // 고유: 공처럼 말려 얼음 위를 튕겨 다니며 굴러갈 때마다 빨라진다, 빈틈 하나뿐인 가시 벽.
        // 억까: 가시 벽이 반대편 벽에 부딪혀 "다른 빈틈"으로 되돌아온다.
        hedgehog: {
            name: '얼음 고슴도치', w: 92, h: 66, hp: 1,
            order: ['spin', 'quills', 'spin', 'quills'],
            init(b) { b.flip = 0; },
            start(b, a, p) {
                b.dir = a.toPlayer;
                if (p === 'spin') { b.state = 'curl'; b.t = 0.6; b.n = a.hard ? 4 : 2; b.k = 0; }
                else { b.state = 'quills'; b.flip ^= 1; b.n = 1; b.t = 0.55; }
            },
            think(b, a) {
                switch (b.state) {
                    case 'curl':
                        b.vx = 0;
                        if (b.t <= 0) { b.state = 'spin'; b.vx = b.dir * 420 * a.fast; }
                        break;
                    case 'spin':
                        if (b.hitWall) {
                            b.n--; b.k++; a.shake(0.15);
                            if (b.n <= 0) { b.vx = 0; a.rest(b); }
                            else { b.dir = -b.dir; b.vx = b.dir * (420 + b.k * 60) * a.fast; }   // 튕길 때마다 빨라진다
                        }
                        break;
                    case 'quills':
                        b.vx = 0; b.dir = a.toPlayer;
                        if (b.t <= 0 && b.n > 0) {
                            const gap = b.flip ? 'low' : 'plank';
                            const x = b.dir > 0 ? b.x + b.w + 16 : b.x - 16;
                            a.wall(x, b.dir, gap, 240, 'quill');
                            b.n = 0;
                            // 반대편 벽까지 가는 시간
                            const far = b.dir > 0 ? a.arena.x1 - x : x - a.arena.x0;
                            b.t = far / (240 * a.fast);
                            b.k = a.hard ? 1 : 0;
                        } else if (b.t <= 0 && b.k) {
                            // 억까: 반대편 벽에서 다른 빈틈으로 되돌아온다
                            b.k = 0;
                            const gap = b.flip ? 'plank' : 'low';
                            a.wall(b.dir > 0 ? a.arena.x1 - 16 : a.arena.x0 + 16, -b.dir, gap, 260, 'quill');
                            b.t = 1.0;
                        } else if (b.t <= 0) a.rest(b);
                        break;
                }
            },
            draw(b, ctx, g) {
                const cx = b.x + b.w / 2, by = b.y + b.h, d = b.dir;
                const ball = b.state === 'spin' || (b.state === 'curl' && b.t < 0.3);
                if (ball) {
                    const r = 32, cy = by - r;
                    ctx.save();
                    ctx.translate(cx, cy);
                    ctx.rotate(b.x / 25);
                    ctx.fillStyle = g.c('#bfe6ff');
                    for (let i = 0; i < 12; i++) {
                        const ang = (i / 12) * Math.PI * 2;
                        ctx.beginPath();
                        ctx.moveTo(Math.cos(ang - 0.2) * r, Math.sin(ang - 0.2) * r);
                        ctx.lineTo(Math.cos(ang) * (r + 12), Math.sin(ang) * (r + 12));
                        ctx.lineTo(Math.cos(ang + 0.2) * r, Math.sin(ang + 0.2) * r);
                        ctx.fill();
                    }
                    ellipse(ctx, 0, 0, r, r, g.c('#6aa6cc'));
                    ctx.restore();
                    return;
                }
                const sx = b.state === 'curl' || (b.state === 'quills' && b.t < 0.3 && b.n) ? shaking() : 0;
                ctx.fillStyle = g.c('#bfe6ff');
                for (let i = 0; i < 9; i++) {
                    const ang = Math.PI + (i / 8) * Math.PI;
                    const bx = cx + sx - d * 6 + Math.cos(ang) * 40, byy = by - 22 + Math.sin(ang) * 36;
                    ctx.beginPath();
                    ctx.moveTo(bx - 7, byy + 4);
                    ctx.lineTo(cx + sx - d * 6 + Math.cos(ang) * 56, by - 22 + Math.sin(ang) * 52);
                    ctx.lineTo(bx + 7, byy + 4);
                    ctx.fill();
                }
                ellipse(ctx, cx + sx - d * 6, by - 24, 42, 26, g.c(g.angry ? '#4a7ab0' : '#6aa6cc'));
                ellipse(ctx, cx + sx + d * 30, by - 20, 20, 15, g.c('#e8d8c8'));
                ellipse(ctx, cx + sx + d * 48, by - 22, 5, 5, '#222');
                eye(ctx, cx + sx + d * 32, by - 28, 4, g.angry ? '#ff3030' : '#222');
                crown(ctx, cx + sx - d * 6, by - 70, 0.6);
            },
        },

        // ================================================================ 7. 거미 여왕 (거미 숲)
        // 고유: 여우 발밑에 끈적한 거미줄 덫을 깐다 (느려짐), 새끼 거미 소환, 바닥 질주.
        // 억까: 새끼 거미가 등 뒤 벽에서 나온다, 서 있는 발판까지 거미줄로 덮는다.
        spider: {
            name: '거미 여왕', w: 90, h: 60, hp: 0.85, fly: true,
            order: ['trap', 'web', 'minions', 'scuttle', 'trap', 'web'],
            idle(b, a) { a.fly(b, midX(b, a), 100, 200); b.dir = a.toPlayer; },
            start(b, a, p) {
                if (p === 'web') { b.state = 'web_go'; b.n = a.hard ? 5 : 3; b.k = 0; }
                else if (p === 'trap') { b.state = 'trap'; b.t = 0.5; }
                else if (p === 'minions') { b.state = 'summon'; b.t = 0.6; }
                else {
                    b.state = 'sc_go'; b.back = 0;
                    b.side = a.player.x + 10 < a.arena.mid ? 1 : -1;
                }
            },
            think(b, a) {
                switch (b.state) {
                    case 'trap':
                        // 여우 발밑과 양옆에 거미줄 (0.6초 예고 후 5초)
                        if (b.t <= 0) {
                            const pc = Math.floor((a.player.x + a.player.w / 2) / T);
                            const cells = [];
                            for (let c = pc - 1; c <= pc + 1; c++) for (const r of [10, 11]) cells.push({ c, r });
                            if (a.hard) for (let c = pc - 2; c <= pc + 2; c++) for (const r of [6, 7]) cells.push({ c, r });
                            a.timedTiles(cells, 'S', 0.6, 5, 'web');
                            b.state = 'web_go'; b.n = a.hard ? 3 : 2; b.k = 0;
                        }
                        break;
                    case 'web_go':
                        if (a.fly(b, midX(b, a), LANE.plank - b.h / 2, 180)) { b.state = 'web'; b.t = 0.45; }
                        break;
                    case 'web':
                        b.dir = a.toPlayer;
                        if (b.t <= 0) {
                            a.shot(b, { shape: 'web', lane: a.playerOnPlank ? 'plank' : (a.hard && b.k % 2 ? 'high' : 'low'), speed: 300, w: 24, h: 24 });
                            b.k++; b.n--; b.t = 0.75;
                            if (b.n <= 0) a.rest(b);
                        }
                        break;
                    case 'summon':
                        b.vx = 0; b.vy = 0;
                        if (b.t <= 0) {
                            if (a.hard) {
                                // 억까: 등 뒤 벽에서도 나온다
                                const behind = a.player.x < b.x ? a.arena.x0 + 10 : a.arena.x1 - 40;
                                a.minion(behind, 'spider');
                                a.minion(behind === a.arena.x0 + 10 ? a.arena.x0 + 60 : a.arena.x1 - 90, 'spider');
                            }
                            a.minion(a.arena.x0 + 30, 'spider');
                            a.minion(a.arena.x1 - 60, 'spider');
                            a.rest(b, 1.4);
                        }
                        break;
                    case 'sc_go':
                        if (a.fly(b, b.side > 0 ? a.arena.x1 - b.w - 20 : a.arena.x0 + 20, 100, 260)) b.state = 'sc_down';
                        break;
                    case 'sc_down':
                        if (a.fly(b, b.x, GROUND - b.h, 260)) { b.state = 'sc_wait'; b.t = 0.5; }
                        break;
                    case 'sc_wait':
                        b.vx = 0; b.vy = 0; b.dir = -b.side;
                        if (b.t <= 0) { b.state = 'sc_run'; b.vx = -b.side * 520 * a.fast; }
                        break;
                    case 'sc_run':
                        if (reachedSide(b, a, 20)) {
                            b.side = -b.side; b.vx = 0;
                            if (a.hard && !b.back) { b.back = 1; b.state = 'sc_wait'; b.t = 0.35; } else b.state = 'sc_up';
                        }
                        break;
                    case 'sc_up':
                        if (a.fly(b, b.x, 100, 240)) a.rest(b);
                        break;
                }
            },
            draw(b, ctx, g) {
                const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
                const sx = b.state === 'sc_wait' || b.state === 'summon' || b.state === 'trap' ? shaking() : 0;
                if (b.state !== 'sc_run' && b.state !== 'sc_wait') {
                    ctx.strokeStyle = 'rgba(230,230,240,0.7)'; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, cy - 20); ctx.stroke();
                }
                ctx.strokeStyle = g.c('#8a7898'); ctx.lineWidth = 4;
                for (let i = 0; i < 4; i++) {
                    const wig = Math.sin(b.anim * 2 + i) * 5;
                    for (const d of [-1, 1]) {
                        ctx.beginPath();
                        ctx.moveTo(cx + sx + d * 14, cy + i * 4 - 4);
                        ctx.lineTo(cx + sx + d * (36 + i * 4), cy - 18 + i * 8 + wig);
                        ctx.lineTo(cx + sx + d * (46 + i * 3), cy + 26 + i * 2);
                        ctx.stroke();
                    }
                }
                ellipse(ctx, cx + sx - b.dir * 14, cy - 2, 26, 22, g.c('#5a4468'));
                ctx.fillStyle = '#c0304a';
                ctx.beginPath();
                ctx.moveTo(cx + sx - b.dir * 14, cy - 12); ctx.lineTo(cx + sx - b.dir * 6, cy - 2);
                ctx.lineTo(cx + sx - b.dir * 14, cy + 8); ctx.lineTo(cx + sx - b.dir * 22, cy - 2);
                ctx.fill();
                ellipse(ctx, cx + sx + b.dir * 16, cy + 4, 15, 13, g.c('#6e5a7c'));
                for (const [dx, dy] of [[-5, -2], [5, -2], [-8, 4], [8, 4]]) {
                    ellipse(ctx, cx + sx + b.dir * 18 + dx, cy + 2 + dy, 2.6, 2.6, g.angry ? '#ff3030' : '#ff6a8a');
                }
                crown(ctx, cx + sx - b.dir * 14, cy - 28, 0.55);
            },
        },

        // ================================================================ 8. 불도마뱀 (불의 산)
        // 고유: 벽까지 닿는 불꽃 숨결(오래 감), 바닥 전체가 용암으로 차오른다(발판 위로 피하기), 불씨.
        // 억까: 숨결 때 꼬리에서도 불이 뿜어진다, 용암이 차오르기 직전 여우와 가장 가까운 발판이 불타 없어진다.
        salamander: {
            name: '불도마뱀', w: 124, h: 64, hp: 1.1,
            order: ['breath', 'flood', 'embers', 'breath', 'flood'],
            start(b, a, p) {
                b.dir = a.toPlayer;
                if (p === 'breath') {
                    const warn = a.hard ? 0.65 : 0.85;
                    const mouth = b.dir > 0 ? b.x + b.w : b.x;
                    a.beamToWall(mouth, b.dir, { y: GROUND - 18, h: 34, warn, life: 0.9, kind: 'fire' });
                    b.t = warn + 0.9;
                    if (a.hard) {
                        // 고개를 들어 발판 높이까지, 꼬리에서도 불
                        a.beamToWall(mouth, b.dir, { y: LANE.plank, h: 30, warn: warn + 0.9, life: 0.7, kind: 'fire' });
                        const tail = b.dir > 0 ? b.x - 10 : b.x + b.w + 10;
                        a.beamToWall(tail, -b.dir, { y: GROUND - 18, h: 34, warn: warn + 0.35, life: 0.6, kind: 'fire' });
                        b.t += 0.7;
                    }
                    b.state = 'breath';
                } else if (p === 'flood') {
                    // 바닥 전체가 용암으로 (예고 후). 발판 위로 피해야 한다
                    const warn = a.hard ? 1.4 : 1.6, life = a.hard ? 2.2 : 1.7;
                    a.beam({ x0: a.arena.x0, x1: a.arena.x1, y: GROUND - 14, h: 28, warn, life, kind: 'lava' });
                    if (a.hard) {
                        const cells = a.plankAt(a.player.x + a.player.w / 2);
                        if (cells) a.timedTiles(cells, '.', 1.1, 3.2, 'burn');
                    }
                    b.state = 'flood'; b.t = warn + life;
                } else {
                    b.state = 'embers'; b.n = 4; b.k = 0; b.t = 0.5;
                }
            },
            think(b, a) {
                switch (b.state) {
                    case 'breath':
                    case 'flood':
                        b.vx = 0;
                        if (b.t <= 0) a.rest(b);
                        break;
                    case 'embers':
                        b.vx = 0; b.dir = a.toPlayer;
                        if (b.t <= 0) {
                            a.shot(b, { shape: 'ember', lane: a.hard && b.k % 2 ? 'low' : 'high', speed: 380, w: 20, h: 20 });
                            b.k++; b.n--; b.t = 0.8;
                            if (b.n <= 0) a.rest(b);
                        }
                        break;
                }
            },
            draw(b, ctx, g) {
                const cx = b.x + b.w / 2, by = b.y + b.h, d = b.dir;
                const glow = b.state === 'breath' || b.state === 'flood';
                ctx.fillStyle = g.c('#c8401e');
                ctx.beginPath();
                ctx.moveTo(cx - d * 40, by - 30);
                ctx.quadraticCurveTo(cx - d * 80, by - 40 + Math.sin(b.anim) * 6, cx - d * 70, by - 10);
                ctx.lineTo(cx - d * 36, by - 16);
                ctx.fill();
                if (glow && g.hard) ellipse(ctx, cx - d * 72, by - 14, 7, 6, '#ffd24a');   // 꼬리 불
                ctx.fillStyle = g.c('#a83218');
                for (const dx of [-30, -6, 18, 38]) ctx.fillRect(cx + dx - 5, by - 16, 10, 16);
                ellipse(ctx, cx, by - 28, 50, 20, g.c(g.angry ? '#e02a10' : '#d84a20'));
                for (const dx of [-30, -10, 10]) ellipse(ctx, cx + dx * d, by - 38, 6, 4, '#ffc84a');
                ellipse(ctx, cx + d * 52, by - 34, 22, 16, g.c('#d84a20'));
                eye(ctx, cx + d * 56, by - 42, 5, g.angry ? '#ffe14d' : '#222');
                if (glow) ellipse(ctx, cx + d * 72, by - 30, 8 + Math.random() * 3, 6, '#ffd24a');
                crown(ctx, cx + d * 50, by - 54, 0.55);
            },
        },

        // ================================================================ 9. 매 장군 (하늘 다리, 깜빡이는 구름 바닥)
        // 고유: 날갯짓 돌풍으로 여우를 구름 구멍 쪽으로 민다, 여우가 있는 높이로 가로 비행, 깃털 화살.
        // 억까: 돌풍 방향이 갑자기 뒤집힌다, 비행이 다른 높이로 한 번 더 온다.
        hawk: {
            name: '매 장군', w: 104, h: 58, hp: 0.85, fly: true,
            order: ['gust', 'flyby', 'feathers', 'gust', 'flyby'],
            init(b) { b.side = 1; },
            idle(b, a) { a.fly(b, sideX(b, a), 70, 280); b.dir = -b.side; },
            start(b, a, p) {
                if (p === 'flyby') {
                    b.lane = a.playerOnPlank ? 'plank' : 'low';
                    b.n = a.hard ? 2 : 1;
                    b.state = 'fb_go';
                } else if (p === 'feathers') {
                    b.state = 'ft_go'; b.n = a.hard ? 4 : 3; b.k = 0;
                } else {
                    b.state = 'gust'; b.t = 2.6; b.k = 0; b.n = 0.6;
                }
            },
            think(b, a) {
                switch (b.state) {
                    case 'fb_go': {
                        const y = b.lane === 'plank' ? LANE.plank - b.h / 2 : GROUND - b.h - 2;
                        if (a.fly(b, sideX(b, a), y, 380)) { b.state = 'fb_cry'; b.t = 0.45; }
                        break;
                    }
                    case 'fb_cry':
                        b.vx = 0; b.vy = 0; b.dir = -b.side;
                        if (b.t <= 0) { b.state = 'fb_dash'; b.vx = -b.side * 620 * a.fast; }
                        break;
                    case 'fb_dash':
                        if (reachedSide(b, a)) {
                            b.side = -b.side; b.vx = 0; b.n--;
                            if (b.n > 0) { b.lane = other(b.lane); b.state = 'fb_go'; } else a.rest(b);
                        }
                        break;
                    case 'ft_go':
                        if (a.fly(b, sideX(b, a), LANE.plank - b.h / 2, 320)) { b.state = 'feathers'; b.t = 0.45; }
                        break;
                    case 'feathers':
                        b.dir = -b.side;
                        if (b.t <= 0) {
                            const lanes = a.hard ? (b.k % 2 ? ['high', 'plank'] : ['low', 'plank']) : [b.k % 2 ? 'plank' : 'low'];
                            lanes.forEach(lane => a.shot(b, { shape: 'feather', lane, speed: 360, w: 30, h: 14 }));
                            b.k++; b.n--; b.t = 0.95;
                            if (b.n <= 0) a.rest(b);
                        }
                        break;
                    case 'gust':
                        // 날갯짓 돌풍: 여우를 반대쪽으로 민다 (바닥의 구름 구멍 조심)
                        a.fly(b, sideX(b, a), LANE.plank - b.h / 2, 300);
                        b.dir = -b.side;
                        b.wind = -b.side * 160 * (a.hard && b.t < 1.2 ? -1.15 : 1);   // 억까: 갑자기 반대로
                        b.n -= a.dt;
                        if (b.n <= 0) {
                            a.shot(b, { shape: 'feather', lane: a.hard && b.k % 2 ? 'high' : 'low', speed: 340, w: 30, h: 14 });
                            b.k++; b.n = 0.85;
                        }
                        if (b.t <= 0) a.rest(b);
                        break;
                }
            },
            draw(b, ctx, g) {
                const sx = b.state === 'fb_cry' ? shaking() : 0;
                const cx = b.x + b.w / 2 + sx, cy = b.y + b.h / 2, d = b.dir;
                const flap = Math.sin(b.anim * (b.state === 'gust' ? 3.5 : 1.6)) * 16;
                ctx.fillStyle = g.c('#7a5232');
                for (const s of [-1, 1]) {
                    ctx.beginPath();
                    ctx.moveTo(cx + s * 10, cy - 4);
                    ctx.lineTo(cx + s * 60, cy - 16 + flap);
                    ctx.lineTo(cx + s * 52, cy + 4 + flap * 0.6);
                    ctx.lineTo(cx + s * 20, cy + 10);
                    ctx.closePath();
                    ctx.fill();
                }
                ellipse(ctx, cx, cy + 2, 30, 18, g.c(g.angry ? '#8a3a22' : '#6a4428'));
                ctx.fillStyle = g.c('#5a3a20');
                ctx.beginPath();
                ctx.moveTo(cx - d * 26, cy); ctx.lineTo(cx - d * 46, cy - 6); ctx.lineTo(cx - d * 46, cy + 10); ctx.closePath();
                ctx.fill();
                ellipse(ctx, cx + d * 28, cy - 8, 15, 13, g.c('#f4f0e6'));
                ctx.fillStyle = '#f2b81e';
                ctx.beginPath();
                ctx.moveTo(cx + d * 40, cy - 10); ctx.lineTo(cx + d * 54, cy - 4); ctx.lineTo(cx + d * 40, cy - 2);
                ctx.fill();
                eye(ctx, cx + d * 32, cy - 12, 4, g.angry ? '#ff3030' : '#222');
                crown(ctx, cx + d * 26, cy - 24, 0.5);
            },
        },

        // ================================================================ 10. 늑대 왕 (집 앞 언덕, 마지막)
        // 고유: 돌진해서 할퀴기, 늑대 무리 소환(방을 가로질러 달려온다), 새끼 늑대 소환.
        // 억까: 돌진하다 멈칫(페이크) 후 다시 덮친다, 늑대 무리 뒤쪽 절반은 등 뒤에서 온다,
        //       쓰러지면 마지막으로 울부짖어 양쪽에서 늑대 무리가 달려온다.
        wolf: {
            name: '늑대 왕', w: 124, h: 92, hp: 1.3,
            order: ['rush', 'pack', 'rush', 'cubs'],
            order2: ['rush', 'pack', 'rush', 'pack', 'cubs'],
            start(b, a, p) {
                b.dir = a.toPlayer;
                if (p === 'rush') { b.state = 'crouch'; b.t = 0.55 / a.fast; b.feint = 0; b.n = a.hard ? 2 : 1; }
                else if (p === 'pack') { b.state = 'howl'; b.t = 0.7; b.k = 0; b.n = a.hard ? 6 : 3; }
                else { b.state = 'cubhowl'; b.t = 0.6; }
            },
            think(b, a) {
                const px = a.player.x + a.player.w / 2;
                const front = () => (b.dir > 0 ? b.x + b.w : b.x);
                switch (b.state) {
                    case 'crouch':   // 웅크림 (예고)
                        b.vx = 0; b.dir = a.toPlayer;
                        if (b.t <= 0) { b.state = 'rush'; b.vx = b.dir * 640 * a.fast; }
                        break;
                    case 'rush': {
                        const dist = (px - front()) * b.dir;
                        if (a.hard && !b.feint && dist < 230) {
                            // 억까: 멈칫했다가 다시 덮친다
                            b.feint = 1; b.state = 'feint'; b.vx = 0; b.t = 0.35;
                        } else if (dist < 100 || b.hitWall) {
                            b.vx = 0; b.state = 'claw'; b.t = 0.12;
                        }
                        break;
                    }
                    case 'feint':
                        b.vx = 0;
                        if (b.t <= 0) { b.dir = a.toPlayer; b.state = 'rush'; b.vx = b.dir * 700 * a.fast; }
                        break;
                    case 'claw':     // 할퀴기: 앞쪽 큰 발톱 (짧게 번쩍)
                        b.vx = 0;
                        if (b.t <= 0) {
                            a.spawn({ shape: 'claw', x: front() + b.dir * 55, y: GROUND - 44, w: 110, h: 88, vx: 0, life: 0.22 });
                            a.shake(0.2);
                            b.state = 'after'; b.t = 0.5;
                        }
                        break;
                    case 'after':
                        b.vx = 0;
                        if (b.t <= 0) {
                            if (--b.n > 0) { b.state = 'crouch'; b.t = 0.35; b.feint = 0; } else a.rest(b);
                        }
                        break;
                    case 'howl':     // 늑대 무리: 방을 가로질러 달려온다
                        b.vx = 0;
                        if (b.t > 0) break;
                        if (b.k < b.n) {
                            const fromBehind = a.hard && b.k >= b.n / 2;   // 억까: 뒤쪽 절반은 등 뒤에서
                            const dir = fromBehind ? b.dir * -1 : b.dir;
                            const lane = a.hard && b.k % 2 ? 'high' : 'low';
                            a.spawn({
                                shape: 'wolfrun', x: dir > 0 ? a.arena.x0 + 10 : a.arena.x1 - 10,
                                y: lane === 'low' ? GROUND - 16 : LANE.high - 4, w: 46, h: 26, vx: dir * 400 * a.fast,
                            });
                            b.k++;
                            b.t = fromBehind && b.k === Math.ceil(b.n / 2) + 1 ? 0.9 : 0.65;
                        } else a.rest(b);
                        break;
                    case 'cubhowl':  // 새끼 늑대들을 부른다 (밟거나 쏘면 쓰러진다)
                        b.vx = 0;
                        if (b.t <= 0) {
                            a.minion(a.arena.x0 + 30, 'cub');
                            a.minion(a.arena.x1 - 60, 'cub');
                            if (a.hard) a.minion(a.arena.mid, 'cub');
                            a.rest(b, 1.2);
                        }
                        break;
                    case 'laststand':  // 억까: 쓰러지기 전 마지막 울부짖음
                        b.vx = 0;
                        if (b.t > 0) break;
                        if (b.k < 6) {
                            const dir = b.k % 2 ? 1 : -1;
                            a.spawn({ shape: 'wolfrun', x: dir > 0 ? a.arena.x0 + 10 : a.arena.x1 - 10, y: GROUND - 16, w: 46, h: 26, vx: dir * 380 });
                            b.k++; b.t = 0.7;
                        } else if (b.t <= -1.8) a.kill();
                        break;
                }
            },
            onZero(b, a) {
                if (!a.hard || b.revived) return false;
                b.revived = 1; b.ghost = 1; b.state = 'laststand'; b.t = 0.8; b.k = 0; b.vx = 0;
                a.clearShots();
                a.popup('아우우우---!', b.x + b.w / 2, b.y - 30, '#ff6a6a');
                return true;
            },
            draw(b, ctx, g) {
                const crouch = b.state === 'crouch' || b.state === 'feint';
                const sx = crouch || b.state === 'howl' || b.state === 'cubhowl' ? shaking() : 0;
                const cx = b.x + b.w / 2 + sx, by = b.y + b.h + (crouch ? 6 : 0), d = b.dir;
                const run = b.state === 'rush' ? Math.sin(b.anim * 2) * 8 : 0;
                ctx.fillStyle = g.c('#5a6070');
                ctx.beginPath();
                ctx.moveTo(cx - d * 46, by - 50);
                ctx.quadraticCurveTo(cx - d * 80, by - 70, cx - d * 74, by - 34);
                ctx.lineTo(cx - d * 46, by - 36);
                ctx.fill();
                ctx.fillStyle = g.c('#4a505e');
                for (const dx of [-36, -16, 20, 40]) ctx.fillRect(cx + dx - 6 + (dx > 0 ? run : -run), by - 30, 12, 30);
                ellipse(ctx, cx, by - 46, 54, 26, g.c(g.angry ? '#4a3a4e' : '#6a7080'));
                ellipse(ctx, cx + d * 8, by - 36, 30, 12, g.c('#c8ccd4'));
                const howling = b.state === 'howl' || b.state === 'cubhowl' || b.state === 'laststand';
                const hy = by - (howling ? 84 : 72);
                ellipse(ctx, cx + d * 50, hy, 24, 20, g.c('#6a7080'));
                ctx.fillStyle = g.c('#6a7080');
                ctx.beginPath();
                ctx.moveTo(cx + d * 66, hy - 4); ctx.lineTo(cx + d * 90, hy + (howling ? -16 : 4)); ctx.lineTo(cx + d * 66, hy + 12);
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(cx + d * 36, hy - 12); ctx.lineTo(cx + d * 38, hy - 38); ctx.lineTo(cx + d * 50, hy - 18);
                ctx.moveTo(cx + d * 50, hy - 16); ctx.lineTo(cx + d * 58, hy - 40); ctx.lineTo(cx + d * 64, hy - 14);
                ctx.fill();
                eye(ctx, cx + d * 58, hy - 4, 5, g.angry ? '#ff3030' : '#ffd24a');
                ellipse(ctx, cx + d * 90, hy + (howling ? -16 : 4), 4, 4, '#222');
                if (b.state === 'claw' || b.state === 'after') {
                    // 앞발을 치켜든다
                    ctx.fillStyle = g.c('#4a505e');
                    ctx.fillRect(cx + d * 56 - 6, by - 70, 12, 40);
                }
                crown(ctx, cx + d * 48, hy - 34, 0.75);
            },
        },
    };
})();
