// 여우의 고난길 — 메인 루프: 고정 시간 간격(1/60초) 업데이트 → 그리기
// 모든 게임 스크립트는 전역 스코프를 공유한다 (index.html 의 <script> 순서대로 불러옴, 빌드 도구 없음).
'use strict';

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
