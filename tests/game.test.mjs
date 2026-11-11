// 실행: node --test tests/
// 브라우저 없이 게임 로직을 1/60초씩 직접 돌려서 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './harness.mjs';

const DIFFS = ['easy', 'hard'];
const SECONDS = n => n * 60;   // update() 한 번 = 1/60초

test('스테이지 데이터: 10개, 방 크기, 시작점, 저장 지점, 마지막 방의 보스와 목표', () => {
    const g = createGame();
    const stages = g.get('STAGES.map(s => ({ name: s.name, cols: s.cols, rows: s.rows, start: s.start, saves: s.saves.length, boss: s.boss && s.boss.type, goal: s.goal }))');
    assert.equal(stages.length, 10);
    for (const s of stages) {
        assert.equal(s.cols % 24, 0, `${s.name}: 가로 칸 수가 방(24칸)의 배수가 아님`);
        assert.equal(s.rows, 14, `${s.name}: 세로 14칸이 아님`);
        assert.ok(s.start, `${s.name}: 시작점 없음`);
        assert.ok(s.saves >= 1, `${s.name}: 저장 지점 없음`);
        assert.ok(s.boss, `${s.name}: 보스 없음`);
        assert.ok(s.goal, `${s.name}: 목표(출구·집) 없음`);
    }
    assert.equal(stages[9].goal.kind, 'house', '마지막 스테이지 목표는 집');
});

test('모든 스테이지가 두 난이도에서 에러 없이 돌아가고 그려진다', () => {
    const g = createGame();
    for (const d of DIFFS) {
        for (let i = 0; i < 10; i++) {
            g.run(`__test.start(${i}, '${d}')`);
            for (let k = 0; k < 20; k++) {
                g.run('__test.steps(6); render();');
            }
            assert.ok(['playing', 'dead'].includes(g.get('game.state')), `${d} ${i + 1}스테이지: 상태 ${g.get('game.state')}`);
        }
    }
});

for (const d of DIFFS) {
    test(`보스 10종 모두 쓰러뜨릴 수 있고, 쓰러뜨리면 목표가 나타나 다음으로 넘어간다 (${d})`, () => {
        const g = createGame();
        for (let i = 0; i < 10; i++) {
            g.run(`__test.start(${i}, '${d}'); __test.god(); __test.toBoss(); pressKey('KeyZ');`);
            const name = g.get('boss.name');
            // 무적 상태로 보스 쪽을 보며 계속 여우불을 쏘고 가끔 점프한다. 보스의 모든 패턴(가짜 죽음 같은 억까 포함)이 돌아간다.
            let t = 0;
            for (; t < SECONDS(600) && g.get('boss.alive'); t += 6) {
                if (t % 48 === 0) g.run(`pressKey('Space')`);
                if (t % 48 === 24) g.run(`releaseKey('Space')`);
                g.run('__test.aim(); __test.steps(6)');
                if (t % 60 === 0) g.run('render()');
                // 어려움 딱정벌레 대왕의 가짜 죽음: 출구로 다가가야 되살아난다
                if (g.get(`boss.state === 'fakedead'`)) g.run('__test.toGoal(); __test.steps(1); __test.toBoss();');
            }
            const why = g.get(`JSON.stringify({ state: game.state, hp: boss.hp, boss: boss.state, x: Math.round(player.x), y: Math.round(player.y), t: ${t} / 60 })`);
            assert.equal(g.get('boss.alive'), false, `${d} ${i + 1}스테이지 ${name}: 10분 안에 못 쓰러뜨림 ${why}`);
            assert.equal(g.get('stage.goal.visible'), true, `${name}: 쓰러뜨렸는데 목표가 안 보임`);

            g.run(`releaseKey('KeyZ'); releaseKey('Space'); __test.toGoal(); __test.steps(2);`);
            assert.equal(g.get('game.state'), i < 9 ? 'clear' : 'win', `${name}: 목표에 닿았는데 넘어가지 않음`);
        }
    });
}

test('가짜 바닥(F)은 밟을 수 없고 그대로 떨어진다', () => {
    const g = createGame();
    g.run(`__test.start(0, 'hard')`);
    const fake = g.get(`(() => { for (let c = 0; c < stage.cols; c++) if (stage.tiles[12][c] === 'F') return c; return -1; })()`);
    assert.ok(fake > 0, '1스테이지에 가짜 바닥이 없음');
    assert.equal(g.get(`isSolid('F')`), false);
    g.run(`player.x = ${fake} * TILE + 10; player.y = 10 * TILE; player.vx = 0; player.vy = 0; camX = roomCamX();`);
    g.run('__test.steps(60)');
    assert.ok(g.get('game.state') === 'dead' || g.get('player.y') > 12 * 40, '가짜 바닥 위에 서 있음');
});

test('쉬움에서만 가짜 바닥을 표시한다', () => {
    const g = createGame();
    assert.equal(g.get('DIFF.easy.fakeHint'), true);
    assert.equal(g.get('DIFF.hard.fakeHint'), false);
});

test('어려움은 한 번 맞으면 기절, 쉬움은 하트 3개', () => {
    const g = createGame();
    g.run(`__test.start(0, 'hard'); hurtPlayer();`);
    assert.equal(g.get('game.state'), 'dead');
    assert.equal(g.get('game.deaths'), 1);

    g.run(`__test.start(0, 'easy'); hurtPlayer();`);
    assert.equal(g.get('game.state'), 'playing');
    assert.equal(g.get('player.hp'), 2);
    g.run(`player.invuln = 0; hurtPlayer(); player.invuln = 0; hurtPlayer();`);
    assert.equal(g.get('game.state'), 'dead');
});

test('최고 기록 기준은 온라인 랭킹과 같다: 시간이 짧을수록, 같으면 덜 죽을수록', () => {
    const g = createGame();
    const isRecord = (best, time, deaths) => g.get(`(() => {
        game.continued = false; game.newRecord = false; game.best = ${JSON.stringify(best)};
        game.time = ${time}; game.deaths = ${deaths}; saveBest(); return game.newRecord;
    })()`);
    assert.equal(isRecord(null, 900, 99), true, '첫 기록은 무조건 신기록');
    assert.equal(isRecord({ time: 600, deaths: 5 }, 500, 50), true, '더 빠르면 많이 죽어도 신기록');
    assert.equal(isRecord({ time: 600, deaths: 5 }, 700, 0), false, '더 느리면 안 죽어도 신기록 아님');
    assert.equal(isRecord({ time: 600, deaths: 5 }, 600, 4), true, '시간이 같으면 덜 죽은 쪽');
    assert.equal(g.get(`(() => { game.continued = true; game.newRecord = false; game.best = null; game.time = 1; saveBest(); return game.newRecord; })()`), false,
        '이어하기로 깬 판은 기록하지 않음');
});
