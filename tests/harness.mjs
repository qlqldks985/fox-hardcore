// 브라우저 없이 게임을 돌리는 시험용 환경
// index.html 과 같은 순서로 게임 스크립트를 하나의 vm 컨텍스트에 불러온다.
// 캔버스·문서·저장소는 아무 일도 안 하는 가짜로 바꾼다. (소리·온라인 랭킹은 불러오지 않음)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_SCRIPTS = ['levels', 'bosses', 'core', 'world', 'boss-fight', 'render-world', 'render-actors', 'main'];

/** 어떤 메서드를 불러도 조용히 넘어가는 2D 그리기 도구 */
function fakeContext2D() {
    const gradient = { addColorStop() {} };
    const special = {
        createLinearGradient: () => gradient,
        createRadialGradient: () => gradient,
        createPattern: () => gradient,
        measureText: text => ({ width: String(text).length * 8 }),
    };
    const props = {};
    return new Proxy(props, {
        get: (t, k) => (k in special ? special[k] : k in t ? t[k] : () => {}),
        set: (t, k, v) => { t[k] = v; return true; },
    });
}

export function createGame() {
    const canvas = { width: 960, height: 560, getContext: () => fakeContext2D(), addEventListener() {} };
    const store = new Map();
    const sandbox = {
        console, Math, JSON, Date, Map, Set, structuredClone,
        performance: { now: () => 0 },
        requestAnimationFrame: () => 0,
        addEventListener() {},
        HTMLButtonElement: class {},
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        },
        document: {
            getElementById: id => (id === 'game' ? canvas : null),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {},
        },
    };
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    for (const name of GAME_SCRIPTS) {
        const file = path.join(ROOT, 'js', `${name}.js`);
        vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    }

    const run = code => vm.runInContext(code, context);
    // 시험에서 자주 쓰는 동작
    run(`
        var __test = {
            start(index, difficulty) { game.difficulty = difficulty; startGame(index); },
            steps(n) { for (let i = 0; i < n && game.state === 'playing'; i++) update(STEP); },
            // 무적: 맞아도 아무 일 없고, 구덩이에 빠지면 마지막으로 밟은 땅으로 돌아온다
            god() {
                const back = () => {
                    if (!player.safe) return;
                    player.x = player.safe.x; player.y = player.safe.y; player.vx = 0; player.vy = 0; camX = roomCamX();
                };
                hurtPlayer = fell => { if (fell) back(); };
                killPlayer = back;
            },
            toBoss() { player.x = (boss.wake + 1.5) * TILE; player.y = GROUND_Y - player.h; camX = roomCamX(); },
            aim() { player.facing = Math.sign(boss.x + boss.w / 2 - (player.x + player.w / 2)) || 1; },
            toGoal() { const g = stage.goal; player.x = g.x + g.w / 2 - player.w / 2; player.y = g.y + g.h - player.h; player.vy = 0; },
        };
    `);
    return { run, get: expr => run(`(${expr})`) };
}
