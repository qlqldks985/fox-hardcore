// 효과음 (Web Audio 로 즉석에서 만든다 — 소리 파일 없음)
// game.js 는 window.Sfx.play('jump') 처럼 이름만 부른다. M 키로 끄고 켠다.
(() => {
    'use strict';

    let ctx = null;
    let master = null;
    let noiseBuf = null;
    let muted = false;
    try { muted = localStorage.getItem('foxHardMute') === '1'; } catch { /* 저장 불가 환경 */ }

    // 브라우저는 사용자가 키를 누른 뒤에야 소리를 허락하므로, 처음 소리를 낼 때 만든다
    function audio() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 0.35;
            master.connect(ctx.destination);
            noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    /** 음 하나: 주파수를 from → to 로 미끄러뜨린다 */
    function tone({ type = 'square', from, to = from, dur, vol = 0.5, at = 0, attack = 0.005 }) {
        const t0 = ctx.currentTime + at;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g).connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    /** 잡음: 쿵, 퍽, 우르르 같은 소리 */
    function noise({ dur, vol = 0.4, at = 0, freq = 1200, to = freq, q = 1 }) {
        const t0 = ctx.currentTime + at;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = q;
        f.frequency.setValueAtTime(freq, t0);
        f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(f).connect(g).connect(master);
        src.start(t0);
        src.stop(t0 + dur + 0.02);
    }

    const notes = (list, { type = 'square', step = 0.09, dur = 0.14, vol = 0.35 } = {}) =>
        list.forEach((f, i) => tone({ type, from: f, dur, vol, at: i * step }));

    const SOUNDS = {
        jump:       () => tone({ from: 280, to: 560, dur: 0.11, vol: 0.25 }),
        doubleJump: () => tone({ from: 480, to: 960, dur: 0.1, vol: 0.22 }),
        shoot:      () => tone({ from: 880, to: 440, dur: 0.05, vol: 0.12 }),
        stomp:      () => { tone({ type: 'triangle', from: 420, to: 120, dur: 0.12, vol: 0.5 }); noise({ dur: 0.08, vol: 0.2, freq: 900 }); },
        enemyHit:   () => noise({ dur: 0.12, vol: 0.3, freq: 2000, to: 300 }),
        bossHit:    () => tone({ type: 'triangle', from: 190, to: 130, dur: 0.06, vol: 0.35 }),
        bossWake:   () => { noise({ dur: 0.9, vol: 0.45, freq: 300, to: 60 }); tone({ type: 'sawtooth', from: 70, to: 55, dur: 0.8, vol: 0.25 }); },
        bossDie:    () => { noise({ dur: 1.2, vol: 0.5, freq: 3000, to: 80 }); notes([392, 330, 262, 196], { type: 'sawtooth', step: 0.12, dur: 0.2, vol: 0.25 }); },
        trap:       () => noise({ dur: 0.25, vol: 0.5, freq: 400, to: 60 }),
        crumble:    () => noise({ dur: 0.18, vol: 0.25, freq: 900, to: 200 }),
        bounce:     () => tone({ type: 'sine', from: 180, to: 900, dur: 0.22, vol: 0.4 }),
        grab:       () => tone({ type: 'sawtooth', from: 220, to: 330, dur: 0.15, vol: 0.25 }),
        save:       () => notes([660, 990], { type: 'triangle', step: 0.08, dur: 0.18, vol: 0.4 }),
        hurt:       () => { tone({ type: 'sawtooth', from: 420, to: 160, dur: 0.22, vol: 0.35 }); noise({ dur: 0.1, vol: 0.2 }); },
        die:        () => { tone({ type: 'sawtooth', from: 520, to: 60, dur: 0.55, vol: 0.4 }); noise({ dur: 0.35, vol: 0.35, freq: 1500, to: 100 }); },
        clear:      () => notes([523, 659, 784, 1047], { step: 0.1, dur: 0.18 }),
        win:        () => notes([523, 659, 784, 1047, 784, 1047, 1319], { step: 0.13, dur: 0.24, vol: 0.32 }),
        select:     () => tone({ from: 700, dur: 0.05, vol: 0.15 }),
        start:      () => notes([440, 660], { step: 0.07, dur: 0.1, vol: 0.3 }),
    };

    window.Sfx = {
        get muted() { return muted; },
        play(name) {
            if (muted || !SOUNDS[name]) return;
            try { if (audio()) SOUNDS[name](); } catch { /* 소리가 안 나도 게임은 계속 */ }
        },
        toggleMute() {
            muted = !muted;
            try { localStorage.setItem('foxHardMute', muted ? '1' : '0'); } catch { /* 저장 불가 환경 */ }
            if (!muted) this.play('select');
            return muted;
        },
    };
})();
