// 스테이지 정의
// 한 화면(방) = 가로 24칸 x 세로 14칸. 타일 1칸 = 40px.
// c = 왼쪽부터 열 번호(스테이지 전체 기준), r = 위에서부터 행 번호(0~13). 바닥 윗면은 12행.
//
// 타일
//   '#' 흙 블록          'F' 가짜 블록 (흙처럼 보이지만 통과됨)
//   '-' 나무 발판 (위에서만 밟힘)
//   'X' 무너지는 블록 (밟으면 잠시 후 사라짐)
//   'I' 투명 블록 (안 보이지만 막힘, 부딪히면 드러남)
//   '^' 위쪽 가시        'v' 아래쪽 가시
//   'M' 버섯 트램펄린 (밟으면 높이 튕김)        'G' 얼음 (미끄러짐)
//   'W' 독 늪물 / 'L' 용암 (빠지면 끝)           'S' 거미줄 (느려지고 낮게만 뛴다)
//   'C' / 'D' 구름 블록 (2초씩 번갈아 나타났다 사라진다)
//
// 함정은 "트리거 열(c1~c2)"에 플레이어가 들어오면 작동합니다. { hard: true } 인 것은 어려움에서만.
// 모든 스테이지의 마지막 방은 보스 방입니다 (보스 종류는 js/bosses.js).

const ROOM_COLS = 24;

// 스테이지별 배경, 땅 색, 기믹 표시
const THEMES = {
    sunset: {
        sky: ['#2c2f63', '#a2587a', '#f0a56b'], hills: ['#5a3f66', '#3e2f4f'], moon: '#ffe2a8', stars: 30,
        dirt: ['#6e4a2c', '#5c3d23'], grass: ['#4f9a5a', '#3c7d46'],
    },
    cave: {
        sky: ['#07090f', '#141b2c', '#25304a'], hills: ['#1b2234', '#10151f'], moon: null, stars: 12,
        dirt: ['#4a4458', '#3a3547'], grass: ['#5e7a8c', '#455c6b'], dark: true,
    },
    storm: {
        sky: ['#1d2233', '#4a4766', '#9a6b6b'], hills: ['#3a3550', '#26233a'], moon: '#d8d4e8', stars: 6,
        dirt: ['#5a4a3a', '#4a3c2f'], grass: ['#6b8a5a', '#55704a'],
    },
    swamp: {
        sky: ['#1c2a22', '#3f5a3a', '#8a9a5a'], hills: ['#2f4430', '#1f3020'], moon: '#e8f0b0', stars: 10,
        dirt: ['#3d3a26', '#2f2c1c'], grass: ['#5f8a3a', '#4a6e2c'],
    },
    autumn: {
        sky: ['#3a2a4a', '#c0603a', '#f2b04a'], hills: ['#8a4a2a', '#6a3420'], moon: '#fff0c0', stars: 8,
        dirt: ['#7a4a26', '#663d1e'], grass: ['#d08a2a', '#b06e1e'], mover: 'leaf',
    },
    ice: {
        sky: ['#14223a', '#3a6a8a', '#a8d4e8'], hills: ['#6a9ab8', '#4a7a98'], moon: '#f0f8ff', stars: 25,
        dirt: ['#8fb6cc', '#7aa2b8'], grass: ['#e8f6ff', '#c4e2f2'],
    },
    web: {
        sky: ['#120f1a', '#2e2438', '#4e3e52'], hills: ['#2a2230', '#1a1520'], moon: '#cfc6d8', stars: 15,
        dirt: ['#3e3640', '#302a32'], grass: ['#6a6070', '#524a58'],
    },
    volcano: {
        sky: ['#1a0808', '#5a1a10', '#c8481c'], hills: ['#3a1410', '#260c08'], moon: null, stars: 0,
        dirt: ['#3b2a2a', '#2c1e1e'], grass: ['#c4442e', '#8e2a1c'], mover: 'rock',
    },
    sky: {
        sky: ['#3a7ac8', '#7ab6e8', '#b8dcf4'], hills: ['#5e9ad0', '#4a86bc'], moon: '#fff6c8', stars: 0,
        dirt: ['#8a6a4a', '#76583a'], grass: ['#5ab45a', '#46964a'],
    },
    home: {
        sky: ['#0a1030', '#2a3a6a', '#6a6a9a'], hills: ['#2a2a4a', '#1a1a34'], moon: '#fff8d8', stars: 40,
        dirt: ['#6e4a2c', '#5c3d23'], grass: ['#4f9a5a', '#3c7d46'],
    },
};

class StageBuilder {
    constructor(name, rooms, theme, rows = 14) {
        this.name = name;
        this.theme = THEMES[theme];
        this.cols = rooms * ROOM_COLS;
        this.rows = rows;
        this.tiles = Array.from({ length: rows }, () => Array(this.cols).fill('.'));
        this.def = {
            enemies: [], hazards: [], tileTraps: [], saves: [], signs: [],
            movers: [], winds: [], geysers: [], chase: [], hardTiles: [],
            start: { c: 2, r: 11 }, goal: null, boss: null,
        };
    }

    fill(c1, c2, r1, r2, tile) {
        for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
                if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) this.tiles[r][c] = tile;
            }
        }
        return this;
    }

    // ---- 지형
    ground(c1, c2, top = 12) { return this.fill(c1, c2, top, this.rows - 1, '#'); }
    block(c, r, w = 1, h = 1) { return this.fill(c, c + w - 1, r, r + h - 1, '#'); }
    plank(c, r, w) { return this.fill(c, c + w - 1, r, r, '-'); }
    spikes(c1, c2, r, dir = '^') { return this.fill(c1, c2, r, r, dir); }
    spikePit(c1, c2) { return this.ground(c1, c2, 13).spikes(c1, c2, 12); }
    fake(c, r, w = 1, h = 1) { return this.fill(c, c + w - 1, r, r + h - 1, 'F'); }
    crumble(c, r, w = 1) { return this.fill(c, c + w - 1, r, r, 'X'); }
    invisible(c, r, w = 1) { return this.fill(c, c + w - 1, r, r, 'I'); }
    gap(c1, c2) { return this.fill(c1, c2, 0, this.rows - 1, '.'); }

    // ---- 스테이지 기믹
    /** 독 늪 (빠지면 끝) */
    pond(c1, c2) { return this.ground(c1, c2, 13).fill(c1, c2, 12, 12, 'W'); }
    /** 용암 구덩이 */
    lavaPit(c1, c2) { return this.ground(c1, c2, 13).fill(c1, c2, 12, 12, 'L'); }
    /** 버섯 트램펄린 (그 아래는 흙) */
    shroom(c, r = 12) { return this.ground(c, c, r).fill(c, c, r, r, 'M'); }
    /** 얼음 바닥: 윗줄만 얼음, 아래는 흙 */
    ice(c1, c2, top = 12) { return this.ground(c1, c2, top).fill(c1, c2, top, top, 'G'); }
    /** 거미줄: 빈칸에만 */
    web(c, r, w = 1, h = 1) {
        for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (this.tiles[y][x] === '.') this.tiles[y][x] = 'S';
        return this;
    }
    /** 구름 블록: kind 'C' 와 'D' 가 번갈아 나타난다 */
    cloud(c1, c2, r, kind = 'C') { return this.fill(c1, c2, r, r, kind); }
    /** 움직이는 발판. ax/ay: 좌우/위아래 진폭(칸), period: 왕복 시간, fall: 밟으면 떨어짐 */
    mover({ c, r, w = 2, ax = 0, ay = 0, period = 0, phase = 0, fall = false, hard = false }) {
        this.def.movers.push({ bx: c * 40, by: r * 40, w: w * 40, ax, ay, period, phase, fall, hard });
        return this;
    }
    /** 돌풍 구역: period 마다 on 초 동안 force 로 민다 (+ 오른쪽, - 왼쪽) */
    wind(c1, c2, force, { period = 3, on = 1, phase = 0, hard = false } = {}) {
        this.def.winds.push({ c1, c2, force, period, on, phase, hard });
        return this;
    }
    /** 간헐천: top 행까지 솟구친다 */
    geyser(c, top, period, phase = 0, { hard = false } = {}) {
        this.def.geysers.push({ c, top, period, phase, hard });
        return this;
    }
    /** 늑대 무리 추격: c1 열에 들어서면 뒤에서 speed 로 쫓아온다 (c2 열에서 멈춤) */
    chase(c1, c2, speed) { this.def.chase.push({ c1, c2, speed }); return this; }
    /** 어려움에서만 바뀌는 타일 */
    hardTile(c, r, tile) { this.def.hardTiles.push({ c, r, tile }); return this; }

    // ---- 오브젝트
    start(c, r = 11) { this.def.start = { c, r }; return this; }
    save(c, r = 11) { this.def.saves.push({ c, r }); return this; }
    sign(c, text, r = 11) { this.def.signs.push({ c, r, text }); return this; }
    enemy(...cols) { cols.forEach(c => this.def.enemies.push({ c, r: 11 })); return this; }
    /** kind: 'flag' = 다음 스테이지 출구, 'house' = 마지막 집 */
    goal(c, kind = 'flag', r = 11) { this.def.goal = { c, r, kind }; return this; }

    /**
     * 보스 방 (방 하나, A = 방의 첫 열)
     * 들어오면 뒤의 문이 닫히고, 보스를 쓰러뜨리면 가운데에 출구(또는 집)가 나타난다.
     *   planks : [[열, 행, 너비], ...] (기본: 양쪽 두 개)
     *   floor  : 'ice' 면 얼음 바닥
     *   shrooms: 버섯 트램펄린 열 목록
     *   pits   : [[c1, c2, 'C'|'D'], ...] 바닥 대신 구름 블록 (사라지면 떨어진다)
     */
    arena(A, type, { goal = 'flag', planks = [[A + 5, 8, 4], [A + 15, 8, 4]], floor, shrooms = [], pits = [] } = {}) {
        this.ground(A, A + 23).save(A + 1);
        if (floor === 'ice') this.fill(A + 1, A + 23, 12, 12, 'G');
        planks.forEach(([c, r, w]) => this.plank(c, r, w));
        shrooms.forEach(c => this.shroom(c));
        pits.forEach(([c1, c2, kind]) => this.gap(c1, c2).cloud(c1, c2, 12, kind));
        this.pop(A, A, 0, 11, '#', A + 3, A + 3);
        this.def.boss = { type, c: A + 20, wake: A + 3 };
        return this.goal(A + 11, goal);
    }

    // ---- 함정
    /** 위에서 떨어지는 도토리 */
    drop(c, r, t1, t2, { delay = 0, hard = false } = {}) {
        return this.hazard({ shape: 'acorn', c, r, w: 18, h: 22, vx: 0, vy: 0, ay: 2500, t1, t2, delay, hard });
    }

    /** 화면 아래에서 솟구쳤다가 다시 떨어지는 도토리 (shape: 'ember' 면 불덩이) */
    rise(c, t1, t2, { delay = 0, shape = 'acorn', hard = false } = {}) {
        return this.hazard({ shape, c, r: this.rows, w: 18, h: 22, vx: 0, vy: -1050, ay: 1500, t1, t2, delay, hard });
    }

    /** 제자리에 있다가 날아오는 가시 */
    shoot(c, r, dir, t1, t2, { speed = 300, delay = 0, hard = false } = {}) {
        const v = { left: [-speed, 0], right: [speed, 0], up: [0, -speed], down: [0, speed] }[dir];
        return this.hazard({ shape: 'spike', dir, c, r, w: 24, h: 24, vx: v[0], vy: v[1], ay: 0, t1, t2, delay, hard });
    }

    hazard({ c, r, t1, t2, ...rest }) {
        this.def.hazards.push({
            ...rest,
            x0: c * 40 + 20,
            y0: r * 40 + 20,
            trigger: { c1: t1, c2: t2 },
        });
        return this;
    }

    /** 트리거를 밟으면 지정한 영역의 타일이 바뀐다 (가시 튀어나오기, 문 닫히기 등) */
    pop(c1, c2, r1, r2, tile, t1, t2, { hard = false } = {}) {
        const cells = [];
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) cells.push({ c, r });
        this.def.tileTraps.push({ cells, tile, trigger: { c1: t1, c2: t2 }, hard });
        return this;
    }

    build() {
        return { name: this.name, theme: this.theme, cols: this.cols, rows: this.rows, tiles: this.tiles, ...this.def };
    }
}

// ======================================================================== 1. 숲 입구 (보스: 딱정벌레 대왕)
// 기믹: 기본 함정 (떨어지는 도토리, 솟는 가시, 가짜 바닥, 무너지는 블록, 투명 블록)
const STAGE_1 = new StageBuilder('숲 입구', 6, 'sunset')
    // ---------------- 방 1 (0~23): 인사
    .ground(0, 23).start(2)
    .sign(5, '여우는 도토리를 먹지 않습니다')
    .drop(11, 0, 8, 9)                          // 표지판을 믿고 걸어가면...
    .drop(13, 0, 12, 12, { delay: 0.05, hard: true })   // 어려움: 하나 피하고 안심하면 또
    .sign(15, '공중에서 한 번 더 점프할 수 있어요')
    .pop(19, 19, 11, 11, '^', 17, 17)           // 발밑에 가시가 솟는다

    // ---------------- 방 2 (24~47): 2단 점프
    .ground(24, 29).save(26)
    .spikePit(30, 34)
    .spikes(31, 33, 7, 'v')                     // 2단 점프를 일찍 쓰면 천장 가시 (내려오다가 쓰기)
    .ground(35, 47)
    .pop(37, 37, 11, 11, '^', 36, 36, { hard: true })   // 어려움: 착지하자마자 앞에 가시
    .fake(40, 12, 2, 2)                         // 가짜 바닥
    .shoot(47, 11, 'left', 44, 44, { speed: 320 })

    // ---------------- 방 3 (48~71): 무너지는 발판
    .ground(48, 53).save(50)
    .spikePit(54, 63)
    .crumble(55, 10, 2).crumble(58, 8, 2).crumble(61, 10, 2)
    .invisible(59, 5)                           // 높이 뛰면 머리를 박는다
    .block(64, 9, 8, 5)
    .sign(67, '방금 머리 박으셨죠?', 8)

    // ---------------- 방 4 (72~95): 도토리 비
    .ground(72, 77).save(73)
    .spikePit(78, 80)
    .rise(79, 77, 77, { delay: 0.15 })          // 바로 뛰면 구덩이 아래에서 솟구친 도토리에 맞는다
    .ground(81, 95)
    // 달리는 여우의 머리 위에 차례로 떨어지도록 타이밍을 맞춘 도토리 3개 (멈췄다 가면 안전)
    .drop(84, 0, 81, 81, { delay: 0.05 }).drop(85, 0, 81, 81, { delay: 0.23 }).drop(86, 0, 81, 81, { delay: 0.41 })
    .spikePit(88, 90)
    .enemy(93)

    // ---------------- 방 5 (96~119): 점프 금지 통로
    .ground(96, 119).save(97)
    .sign(99, '여기서부터 점프 금지. Z로 공격하세요')
    .block(101, 0, 14, 10)
    .spikes(101, 114, 10, 'v')
    .enemy(112)

    // ---------------- 방 6 (120~143): 보스
    .arena(120, 'beetle')
    .build();

// ======================================================================== 2. 밤의 동굴 (보스: 박쥐 여왕)
// 기믹: 어둠 (여우 주변만 보인다)
const STAGE_2 = new StageBuilder('밤의 동굴', 5, 'cave')
    // ---------------- 방 1 (0~23): 종유석
    .ground(0, 13).start(2)
    .block(0, 0, 24, 3)                         // 동굴 천장
    .sign(4, '어두워요. 천장도 조심하세요')
    .shoot(10, 3, 'down', 7, 7, { speed: 620 }) // 그대로 달리면 머리 위로 종유석이 떨어진다
    .spikePit(14, 16)
    .ground(17, 23)
    .pop(17, 17, 11, 11, '^', 15, 15)           // 구덩이를 넘는 동안 착지 지점에 가시가 솟는다 (2단 점프로 더 멀리)

    // ---------------- 방 2 (24~47): 무너지는 다리
    .block(24, 0, 24, 2)
    .ground(24, 28).save(26)
    .spikePit(29, 40)
    .crumble(30, 11, 2).crumble(34, 11, 2).crumble(38, 11, 2)
    .spikes(31, 38, 6, 'v')                     // 2단 점프로 높이 뛰면 천장 가시
    .ground(41, 47)
    .shoot(47, 11, 'left', 42, 42, { speed: 420, hard: true })   // 어려움: 다리를 건너자마자
    .enemy(45)

    // ---------------- 방 3 (48~71): 믿을 수 없는 바닥
    .block(48, 0, 24, 2)
    .ground(48, 71).save(49)
    .sign(52, '이번엔 진짜 바닥이에요. 아마도')
    .fake(55, 12, 3, 2)                         // 표지판 바로 뒤가 가짜 바닥
    .invisible(61, 8, 2)                        // 높이 뛰면 머리를 박고 가짜 바닥으로 떨어진다
    .fake(62, 12, 2, 2)
    .shoot(71, 11, 'left', 66, 66, { speed: 380 })
    .enemy(69)

    // ---------------- 방 4 (72~95): 계단
    .block(72, 0, 24, 2)
    .ground(72, 76).save(73)
    .spikePit(77, 79)
    .rise(78, 76, 76, { delay: 0.2 })           // 구덩이 아래에서 도토리가 솟구친다
    .ground(80, 95)
    .block(84, 10, 2, 2).block(88, 8, 2, 4)     // 계단
    .spikes(86, 87, 12)                         // 계단 사이 가시
    .drop(92, 2, 89, 89, { delay: 0.1 })        // 계단에서 내려오면 머리 위로

    // ---------------- 방 5 (96~119): 보스
    .block(96, 0, 24, 2)
    .arena(96, 'bat')
    .build();

// ======================================================================== 3. 폭풍 언덕 (보스: 천둥 구름)
// 기믹: 돌풍 (바람 줄이 보이면 곧 분다)
const STAGE_3 = new StageBuilder('폭풍 언덕', 5, 'storm')
    // ---------------- 방 1 (0~23): 발판 오르기 + 맞바람
    .ground(0, 5).start(2)
    .sign(3, '바람 줄이 보이면 곧 돌풍이 불어요')
    .spikePit(6, 17)
    .plank(7, 10, 3).plank(12, 8, 3).plank(16, 10, 2)
    .wind(6, 17, -170, { period: 3, on: 1.1, phase: 1 })
    .shoot(23, 7, 'left', 12, 12, { speed: 340 })   // 높은 발판에 올라서면 날아오는 가시
    .ground(18, 23)
    .enemy(21)

    // ---------------- 방 2 (24~47): 탑 넘기
    .ground(24, 35).save(25)
    .block(30, 10, 2, 2)
    .block(34, 7, 2, 5)
    .spikePit(36, 41)
    .invisible(37, 3, 2)                        // 탑에서 바로 2단 점프하면 머리를 박는다
    .wind(36, 41, -150, { period: 3.4, on: 1.2, phase: 0.5 })
    .ground(42, 47)
    .enemy(45)

    // ---------------- 방 3 (48~71): 가시밭 + 뒷바람
    .ground(48, 71).save(49)
    .spikes(55, 55, 12).spikes(59, 59, 12).spikes(63, 63, 12)
    .wind(52, 66, 170, { period: 2.8, on: 1.0 })
    .drop(57, 0, 54, 54, { delay: 0.25 })
    .drop(61, 0, 58, 58, { delay: 0.25 })
    .shoot(71, 11, 'left', 65, 65, { speed: 420 })

    // ---------------- 방 4 (72~95): 바람 다리
    .ground(72, 75).save(73)
    .spikePit(76, 91)
    .plank(78, 10, 2).plank(82, 9, 2).plank(86, 10, 2)
    .hardTile(82, 9, 'X').hardTile(83, 9, 'X')  // 어려움: 가운데 발판이 무너진다
    .wind(76, 91, -200, { period: 2.6, on: 0.9 })
    .ground(92, 95)

    // ---------------- 방 5 (96~119): 보스
    .arena(96, 'cloud')
    .build();

// ======================================================================== 4. 버섯 늪 (보스: 독두꺼비)
// 기믹: 독 늪물(빠지면 끝), 버섯 트램펄린(밟으면 높이 튕김)
const STAGE_4 = new StageBuilder('버섯 늪', 5, 'swamp')
    // ---------------- 방 1 (0~23): 가라앉는 수련잎
    .ground(0, 7).start(2)
    .sign(3, '늪물에 빠지면 안 돼요')
    .pond(8, 19)
    .crumble(10, 11).crumble(13, 11).crumble(16, 11)
    .ground(20, 23)
    .enemy(22)

    // ---------------- 방 2 (24~47): 버섯으로 벽 넘기
    .ground(24, 47).save(25)
    .enemy(29)
    .pop(32, 34, 11, 11, '^', 30, 30)           // 달려가면 앞에 가시가 솟는다
    .shroom(37)
    .block(39, 5, 2, 7)                         // 버섯으로 튕겨야 넘는 벽
    .pond(43, 44)
    .shoot(47, 9, 'left', 41, 41, { speed: 380 })   // 늪을 뛰어넘는 순간 날아온다
    .drop(46, 0, 43, 43, { delay: 0.1 })

    // ---------------- 방 3 (48~71): 버섯 섬 건너기
    .ground(48, 50).save(49)
    .sign(49, '버섯을 밟으면 높이 튀어요', 11)
    .pond(51, 68)
    .shroom(54, 11).shroom(60, 11).shroom(66, 11)
    .hardTile(57, 2, 'I')                       // 어려움: 튕겨 오르면 머리를 박는다
    .ground(69, 71)

    // ---------------- 방 4 (72~95): 버섯 계단
    .ground(72, 78).save(73)
    .shroom(78)
    .pond(79, 82)
    .block(83, 7, 2, 5)
    .shoot(95, 6, 'left', 83, 83, { speed: 300, hard: true })   // 어려움: 꼭대기에 서면 날아온다
    .pond(85, 89)
    .ground(90, 95)
    .drop(93, 0, 90, 90, { delay: 0.15 })

    // ---------------- 방 5 (96~119): 보스 (버섯으로 발판에 오른다)
    .arena(96, 'toad', { shrooms: [102, 112] })
    .build();

// ======================================================================== 5. 단풍 숲 (보스: 다람쥐 대장)
// 기믹: 움직이는 낙엽 발판, 밟으면 떨어지는 낙엽
const STAGE_5 = new StageBuilder('단풍 숲', 5, 'autumn')
    // ---------------- 방 1 (0~23): 도토리 구덩이
    .ground(0, 23).start(2)
    .sign(3, '가을 숲에는 도토리가 많아요')
    .spikePit(7, 9).rise(8, 6, 6, { delay: 0.25 })
    .spikePit(14, 16).drop(17, 0, 13, 13, { delay: 0.15 })   // 착지 지점으로 떨어진다
    .enemy(20)

    // ---------------- 방 2 (24~47): 떠다니는 낙엽
    .ground(24, 27).save(25)
    .spikePit(28, 43)
    .mover({ c: 31, r: 10, ax: 2, period: 3.4 })
    .mover({ c: 37, r: 8, ay: 2, period: 2.8 })
    .shoot(47, 6, 'left', 36, 36, { speed: 320 })
    .ground(44, 47)

    // ---------------- 방 3 (48~71): 떨어지는 낙엽
    .ground(48, 50).save(49)
    .sign(49, '밟은 낙엽은 곧 떨어져요', 11)
    .spikePit(51, 68)
    .mover({ c: 52, r: 11, fall: true }).mover({ c: 56, r: 11, fall: true })
    .mover({ c: 60, r: 11, fall: true }).mover({ c: 64, r: 11, fall: true })
    .drop(62, 0, 59, 59, { delay: 0.2, hard: true })
    .ground(69, 71)

    // ---------------- 방 4 (72~95): 낙엽 엘리베이터
    .ground(72, 75).save(73)
    .spikePit(76, 85)
    .mover({ c: 77, r: 10, ay: 2.5, period: 3 })
    .mover({ c: 81, r: 8, ay: 2, period: 2.4, phase: 1.2 })
    .block(86, 5, 10, 9)                        // 절벽
    .drop(91, 0, 88, 88, { delay: 0.1 })

    // ---------------- 방 5 (96~119): 보스 (나무 구멍 숨바꼭질)
    .arena(96, 'squirrel')
    .build();

// ======================================================================== 6. 얼음 동굴 (보스: 얼음 고슴도치)
// 기믹: 미끄러운 얼음 (멈추려면 미리 반대로)
const STAGE_6 = new StageBuilder('얼음 동굴', 5, 'ice')
    // ---------------- 방 1 (0~23): 고드름 아래 2단 점프
    .ice(0, 5).start(2)
    .sign(3, '얼음 위에서는 미끄러워요')
    .spikePit(6, 11).spikes(7, 10, 7, 'v')      // 넓은 구덩이 + 고드름 (2단 점프는 내려오면서)
    .ice(12, 14)
    .shoot(13, 3, 'down', 12, 12, { speed: 500 })   // 가운데 발판에 내려서면 고드름이 떨어진다
    .spikePit(15, 20).spikes(16, 19, 7, 'v')
    .ice(21, 23)

    // ---------------- 방 2 (24~47): 보이지 않는 얼음 발판
    .ice(24, 29).save(25)
    .sign(27, '얼음 발판은 투명해요')
    .spikePit(30, 40)
    .invisible(32, 10).invisible(35, 9).invisible(38, 10)
    .ice(41, 47)
    .enemy(44)

    // ---------------- 방 3 (48~71): 미끄러운 가시밭
    .ice(48, 71).save(49)
    .spikes(55, 56, 12).spikes(62, 62, 12)
    .enemy(59)
    .block(66, 10, 1, 2)
    .shoot(71, 11, 'left', 64, 64, { speed: 380 })

    // ---------------- 방 4 (72~95): 얼음 기둥
    .ice(72, 75).save(73)
    .spikePit(76, 93)
    .ice(78, 78, 11).ice(81, 81, 11).ice(84, 84, 11).ice(87, 87, 11).ice(90, 90, 11)
    .shoot(95, 10, 'left', 85, 85, { speed: 340, hard: true })
    .ice(94, 95)

    // ---------------- 방 5 (96~119): 보스 (얼음 바닥)
    .arena(96, 'hedgehog', { floor: 'ice' })
    .build();

// ======================================================================== 7. 거미 숲 (보스: 거미 여왕)
// 기믹: 거미줄 (닿으면 느려지고 낮게만 뛴다)
const STAGE_7 = new StageBuilder('거미 숲', 5, 'web')
    // ---------------- 방 1 (0~23): 벽 넘기
    .ground(0, 23).start(2)
    .sign(4, '거미줄에 걸리면 느려져요')
    .block(9, 9, 1, 3).spikes(10, 12, 12).block(13, 9, 1, 3)
    .web(10, 5, 3, 2)                           // 높이 뛰면 거미줄에 걸려 가시로 떨어진다
    .enemy(16, 19)
    .shoot(23, 10, 'left', 15, 15, { speed: 360 })  // 점프하면 맞는 높이
    .drop(21, 0, 18, 18)

    // ---------------- 방 2 (24~47): 낮은 거미굴
    .ground(24, 47).save(25)
    .block(28, 0, 16, 9)                        // 낮은 천장 (높이 뛸 수 없다)
    .spikes(33, 34, 12)
    .spikes(38, 40, 9, 'v')                     // 여기서는 점프하면 천장 가시
    .enemy(30, 40)
    .shoot(43, 11, 'left', 36, 36, { speed: 360 })

    // ---------------- 방 3 (48~71): 거미줄 커튼
    .ground(48, 71).save(49)
    .web(53, 6, 2, 6)                           // 지나가려면 느려진다
    .drop(54, 0, 52, 52, { delay: 0.6 })
    .spikePit(57, 59)
    .web(62, 9, 4, 2)
    .enemy(64, 68)

    // ---------------- 방 4 (72~95): 거미줄 아래 무너지는 다리
    .ground(72, 75).save(73)
    .spikePit(76, 89)
    .crumble(77, 11, 2).crumble(81, 11, 2).crumble(85, 11, 2)
    .web(76, 6, 14, 2)                          // 크게 뛰면 걸린다 (낮게 뛰기)
    .ground(90, 95)
    .enemy(93)

    // ---------------- 방 5 (96~119): 보스
    .arena(96, 'spider')
    .build();

// ======================================================================== 8. 불의 산 (보스: 불도마뱀)
// 기믹: 용암, 주기적으로 솟는 간헐천 (부글부글하면 곧 솟는다)
const STAGE_8 = new StageBuilder('불의 산', 5, 'volcano')
    // ---------------- 방 1 (0~23): 용암 위 바위
    .ground(0, 4).start(2)
    .lavaPit(5, 18)
    .block(8, 10, 2, 1).block(12, 9, 2, 1).block(16, 10, 2, 1)
    .rise(10, 8, 8, { delay: 0.3, shape: 'ember' })
    .rise(14, 12, 12, { delay: 0.3, shape: 'ember' })
    .ground(19, 23)

    // ---------------- 방 2 (24~47): 분출구
    .ground(24, 47).save(25)
    .pop(30, 30, 11, 11, '^', 29, 29)
    .shoot(47, 11, 'left', 38, 38, { speed: 400 })   // 낮은 불 (뛰어넘기)
    .shoot(47, 10, 'left', 39, 39, { speed: 400, delay: 0.45 })   // 바로 뒤에 높은 불 (점프하면 맞음)
    .fake(44, 12, 1, 2)

    // ---------------- 방 3 (48~71): 간헐천 길
    .ground(48, 71).save(49)
    .sign(50, '부글부글하면 곧 솟아올라요')
    .geyser(53, 3, 2.4, 0).geyser(57, 3, 2.4, 0.8).geyser(61, 3, 2.4, 1.6).geyser(65, 3, 2.4, 0.4)
    .geyser(59, 3, 1.8, 0.3, { hard: true })
    .enemy(68)

    // ---------------- 방 4 (72~95): 용암 위 움직이는 바위
    .ground(72, 74).save(73)
    .lavaPit(75, 92)
    .mover({ c: 78, r: 10, ax: 2, period: 2.6 })
    .geyser(82, 5, 2.2, 0.5)
    .mover({ c: 86, r: 9, ax: 2, period: 2.2, phase: 1 })
    .ground(93, 95)

    // ---------------- 방 5 (96~119): 보스 (발판 세 개, 바닥이 용암으로 차오른다)
    .arena(96, 'salamander', { planks: [[99, 8, 4], [106, 9, 4], [113, 8, 4]] })
    .build();

// ======================================================================== 9. 하늘 다리 (보스: 매 장군)
// 기믹: 구름 블록 (흰 구름과 분홍 구름이 번갈아 나타났다 사라진다. 깜빡이면 곧 사라짐)
const STAGE_9 = new StageBuilder('하늘 다리', 5, 'sky')
    // ---------------- 방 1 (0~23): 구름 섬
    .ground(0, 4).start(2)
    .sign(2, '깜빡이는 구름은 곧 사라져요')
    .cloud(6, 8, 12, 'C')
    .ground(11, 12)
    .cloud(14, 16, 12, 'D')
    .ground(19, 23)
    .shoot(23, 11, 'left', 14, 14, { speed: 300 })

    // ---------------- 방 2 (24~47): 발판 사다리
    .ground(24, 27).save(25)
    .plank(30, 10, 2).plank(34, 8, 2).crumble(38, 10, 2).plank(42, 9, 2)
    .invisible(35, 4)
    .shoot(47, 7, 'left', 34, 34, { speed: 280 })
    .ground(45, 47)

    // ---------------- 방 3 (48~71): 깜빡이는 구름길
    .ground(48, 50).save(49)
    .cloud(51, 53, 11, 'C').cloud(54, 56, 11, 'D').cloud(57, 59, 11, 'C').cloud(60, 62, 11, 'D').cloud(63, 65, 11, 'C')
    .shoot(71, 10, 'left', 58, 58, { speed: 300, hard: true })
    .ground(66, 71)

    // ---------------- 방 4 (72~95): 구름 계단
    .ground(72, 74).save(73)
    .cloud(76, 77, 10, 'D').cloud(79, 80, 8, 'C')
    .plank(82, 6, 3)
    .cloud(86, 88, 9, 'D')
    .ground(91, 95)
    .drop(93, 0, 90, 90, { delay: 0.1 })

    // ---------------- 방 5 (96~119): 보스 (바닥 두 곳이 구름)
    .arena(96, 'hawk', { pits: [[103, 104, 'C'], [111, 112, 'D']] })
    .build();

// ======================================================================== 10. 집 앞 언덕 (보스: 늑대 왕)
// 기믹: 늑대 무리 추격 (멈추면 따라잡힌다) + 지금까지의 함정
const STAGE_10 = new StageBuilder('집 앞 언덕', 5, 'home')
    // ---------------- 방 1 (0~23): 쫓기기 시작
    .ground(0, 23).start(2)
    .sign(4, '뒤를 보지 말고 달려요')
    .chase(5, 23, 150)
    .fake(8, 12, 2, 2)
    .spikePit(13, 15).rise(14, 12, 12, { delay: 0.15 })
    .pop(19, 19, 11, 11, '^', 17, 17)
    .enemy(21)

    // ---------------- 방 2 (24~47): 점프 금지 통로에서 쫓기기
    .ground(24, 47).save(25)
    .chase(26, 47, 160)
    .block(28, 0, 10, 10).spikes(28, 37, 10, 'v')
    .enemy(33)
    .spikePit(39, 41)
    .drop(43, 0, 41, 41, { delay: 0.2 })

    // ---------------- 방 3 (48~71): 버섯과 늪
    .ground(48, 71).save(49)
    .chase(50, 71, 170)
    .spikes(54, 55, 12)
    .shroom(59)
    .block(61, 6, 1, 6)
    .pond(64, 65)
    .ice(67, 71)

    // ---------------- 방 4 (72~95): 마지막 구름
    .ground(72, 95).save(73)
    .chase(74, 95, 175)
    .gap(78, 80).cloud(78, 80, 12, 'C')
    .web(84, 8, 3, 2)
    .spikes(88, 88, 12)
    .shoot(95, 10, 'left', 84, 84, { speed: 360 })  // 점프하면 맞는 높이 (쫓기면서 침착하게)
    .pop(92, 92, 11, 11, '^', 90, 90)
    .drop(91, 0, 89, 89, { delay: 0.1 })

    // ---------------- 방 5 (96~119): 마지막 보스
    .arena(96, 'wolf', { goal: 'house' })
    .build();

const STAGES = [STAGE_1, STAGE_2, STAGE_3, STAGE_4, STAGE_5, STAGE_6, STAGE_7, STAGE_8, STAGE_9, STAGE_10];
