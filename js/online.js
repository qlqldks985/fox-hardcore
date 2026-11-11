// 로그인 · 회원가입 · 랭킹 (Supabase)
// game.js 는 window.FoxOnline 만 사용한다. 설정이 없거나 라이브러리를 못 불러오면 enabled = false.
(() => {
    'use strict';

    const cfg = window.FOX_ONLINE_CONFIG || {};
    const enabled = !!(cfg.url && cfg.anonKey && window.supabase);
    const client = enabled ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

    // Supabase Auth 는 이메일로 로그인하므로, 아이디를 가짜 이메일로 바꿔서 쓴다 (메일은 보내지 않음)
    const EMAIL_DOMAIN = 'fox-hardcore.example.com';
    const toEmail = username => `${username}@${EMAIL_DOMAIN}`;

    const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
    const DIFF_NAME = { easy: '쉬움', hard: '어려움' };
    const RANK_LIMIT = 50;

    let profile = null;   // { id, username, nickname }
    const listeners = new Set();
    const notify = () => listeners.forEach(fn => fn(profile));

    async function loadProfile(user) {
        if (!user) { profile = null; notify(); return; }
        const { data } = await client.from('profiles').select('id, username, nickname').eq('id', user.id).maybeSingle();
        profile = data || { id: user.id, username: user.user_metadata?.username, nickname: user.user_metadata?.nickname };
        notify();
    }

    if (enabled) {
        client.auth.getSession().then(({ data }) => loadProfile(data.session?.user));
        client.auth.onAuthStateChange((_event, session) => {
            if ((session?.user?.id || null) !== (profile?.id || null)) loadProfile(session?.user);
        });
    }

    function translateError(error) {
        const msg = (error && error.message) || String(error);
        if (/Invalid login credentials/i.test(msg)) return '아이디 또는 비밀번호가 맞지 않아요.';
        if (/already registered|already exists/i.test(msg)) return '이미 있는 아이디예요.';
        if (/Password should be at least/i.test(msg)) return '비밀번호는 6자 이상이어야 해요.';
        if (/Database error saving new user/i.test(msg)) return '이미 있는 아이디나 닉네임이에요.';
        if (/scores_time_ms_check|check constraint/i.test(msg)) return '기록이 올바르지 않아서 올릴 수 없어요.';
        if (/rate limit/i.test(msg)) return '잠시 후에 다시 시도해 주세요.';
        if (/Failed to fetch|NetworkError/i.test(msg)) return '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.';
        return msg;
    }

    const FoxOnline = {
        enabled,
        DIFF_NAME,
        get profile() { return profile; },
        onChange(fn) { listeners.add(fn); fn(profile); },

        async signUp(username, nickname, password) {
            username = username.trim().toLowerCase();
            nickname = nickname.trim();
            if (!USERNAME_RE.test(username)) throw new Error('아이디는 영어 소문자, 숫자, _ 로 3~16자예요.');
            if (nickname.length < 2 || nickname.length > 12) throw new Error('닉네임은 2~12자예요.');
            if (password.length < 6) throw new Error('비밀번호는 6자 이상이어야 해요.');

            const { data: taken, error: checkErr } = await client.from('profiles').select('username, nickname')
                .or(`username.eq.${username},nickname.eq.${JSON.stringify(nickname)}`);
            if (checkErr) throw new Error(translateError(checkErr));
            if (taken.some(t => t.username === username)) throw new Error('이미 있는 아이디예요.');
            if (taken.some(t => t.nickname === nickname)) throw new Error('이미 있는 닉네임이에요.');

            const { data, error } = await client.auth.signUp({
                email: toEmail(username), password, options: { data: { username, nickname } },
            });
            if (error) throw new Error(translateError(error));
            if (!data.session) throw new Error('가입은 됐지만 로그인되지 않았어요. Supabase 에서 "Confirm email" 을 꺼 주세요.');
            await loadProfile(data.user);
        },

        async signIn(username, password) {
            username = username.trim().toLowerCase();
            const { data, error } = await client.auth.signInWithPassword({ email: toEmail(username), password });
            if (error) throw new Error(translateError(error));
            await loadProfile(data.user);
        },

        async signOut() {
            await client.auth.signOut();
            profile = null;
            notify();
        },

        /** 10스테이지 클리어 기록을 올리고, 등록 뒤 내 순위를 돌려준다 (순위 밖이면 null) */
        async submitScore({ difficulty, time, deaths }) {
            if (!profile) throw new Error('로그인하지 않았어요.');
            const { error } = await client.from('scores').insert({
                difficulty, time_ms: Math.round(time * 1000), deaths,
            });
            if (error) throw new Error(translateError(error));
            const list = await FoxOnline.fetchRanking(difficulty);
            const i = list.findIndex(r => r.user_id === profile.id);
            return { rank: i >= 0 ? i + 1 : null, best: i >= 0 ? list[i] : null };
        },

        async fetchRanking(difficulty) {
            const { data, error } = await client.from('leaderboard')
                .select('user_id, nickname, time_ms, deaths, created_at')
                .eq('difficulty', difficulty)
                .order('time_ms', { ascending: true })
                .order('deaths', { ascending: true })
                .order('created_at', { ascending: true })
                .limit(RANK_LIMIT);
            if (error) throw new Error(translateError(error));
            return data;
        },
    };
    window.FoxOnline = FoxOnline;

    // ------------------------------------------------------------ 화면 (계정 줄, 로그인 창, 랭킹 창)
    const $ = sel => document.querySelector(sel);
    const bar = $('#account');
    if (!bar) return;
    if (!enabled) { bar.hidden = true; return; }
    bar.hidden = false;

    const fmtMs = ms => {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };

    const who = $('#account-who');
    const btnLogin = $('#btn-login');
    const btnLogout = $('#btn-logout');
    FoxOnline.onChange(p => {
        who.textContent = p ? `${p.nickname} 님` : '로그인하면 클리어 기록이 랭킹에 올라가요';
        btnLogin.hidden = !!p;
        btnLogout.hidden = !p;
    });
    btnLogout.addEventListener('click', () => FoxOnline.signOut());

    // 창 열고 닫기 (열려 있는 동안 게임 키 입력은 game.js 가 무시한다)
    function openModal(el) {
        el.hidden = false;
        el.querySelector('input, button.tab.on, .close')?.focus();
    }
    function closeModal(el) { el.hidden = true; }
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => { if (e.target === m || e.target.closest('.close')) closeModal(m); });
        m.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(m); });
    });

    // ---- 로그인 / 회원가입
    const authModal = $('#auth-modal');
    const authForm = $('#auth-form');
    const authMsg = $('#auth-msg');
    let mode = 'login';
    function setMode(m) {
        mode = m;
        authModal.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.mode === m));
        authForm.querySelector('.only-signup').hidden = m !== 'signup';
        authForm.nickname.required = m === 'signup';
        authForm.password.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
        authForm.querySelector('[type=submit]').textContent = m === 'signup' ? '가입하기' : '로그인';
        authMsg.textContent = '';
    }
    authModal.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
    btnLogin.addEventListener('click', () => { setMode('login'); authForm.reset(); openModal(authModal); });

    authForm.addEventListener('submit', async e => {
        e.preventDefault();
        const submit = authForm.querySelector('[type=submit]');
        submit.disabled = true;
        authMsg.textContent = '잠시만요…';
        try {
            const { username, nickname, password } = authForm;
            if (mode === 'signup') await FoxOnline.signUp(username.value, nickname.value, password.value);
            else await FoxOnline.signIn(username.value, password.value);
            closeModal(authModal);
        } catch (err) {
            authMsg.textContent = err.message;
        } finally {
            submit.disabled = false;
        }
    });

    // ---- 랭킹
    const rankModal = $('#rank-modal');
    const rankBody = $('#rank-body');
    let rankDiff = 'hard';
    async function showRanking(d) {
        rankDiff = d;
        rankModal.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.diff === d));
        rankBody.innerHTML = '<p class="empty">불러오는 중…</p>';
        try {
            const list = await FoxOnline.fetchRanking(d);
            if (rankDiff !== d) return;
            if (!list.length) { rankBody.innerHTML = `<p class="empty">아직 ${DIFF_NAME[d]} 클리어 기록이 없어요. 첫 번째 주인공이 되어 보세요!</p>`; return; }
            const table = document.createElement('table');
            table.innerHTML = '<thead><tr><th>순위</th><th>닉네임</th><th>시간</th><th>죽은 횟수</th><th>날짜</th></tr></thead><tbody></tbody>';
            const tbody = table.querySelector('tbody');
            list.forEach((r, i) => {
                const tr = document.createElement('tr');
                if (profile && r.user_id === profile.id) tr.className = 'me';
                const cells = [i + 1, r.nickname, fmtMs(r.time_ms), `${r.deaths}번`, new Date(r.created_at).toLocaleDateString('ko-KR')];
                cells.forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
                tbody.appendChild(tr);
            });
            rankBody.replaceChildren(table);
        } catch (err) {
            rankBody.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'empty';
            p.textContent = err.message;
            rankBody.appendChild(p);
        }
    }
    rankModal.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showRanking(t.dataset.diff)));
    FoxOnline.openRanking = (d = rankDiff) => { openModal(rankModal); showRanking(d); };
    $('#btn-rank').addEventListener('click', () => FoxOnline.openRanking());
})();
