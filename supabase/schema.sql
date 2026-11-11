-- 여우의 고난길 온라인 랭킹 DB
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 하면 됩니다.

-- ------------------------------------------------------------ 회원 정보
-- 로그인 자체는 Supabase Auth(auth.users)가 맡고, 여기에는 아이디와 닉네임만 둔다.
create table public.profiles (
    id         uuid primary key references auth.users on delete cascade,
    username   text not null unique check (username ~ '^[a-z0-9_]{3,16}$'),
    nickname   text not null unique check (char_length(nickname) between 2 and 12),
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "누구나 프로필을 볼 수 있다" on public.profiles for select using (true);

-- 회원가입하면 자동으로 프로필을 만든다 (가입할 때 보낸 username, nickname 사용)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    insert into public.profiles (id, username, nickname)
    values (new.id, new.raw_user_meta_data ->> 'username', new.raw_user_meta_data ->> 'nickname');
    return new;
end $$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ 클리어 기록
create table public.scores (
    id         bigint generated always as identity primary key,
    user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
    difficulty text not null check (difficulty in ('easy', 'hard')),
    time_ms    integer not null check (time_ms >= 60000),   -- 10스테이지를 1분 안에 깰 수는 없다
    deaths     integer not null check (deaths >= 0),
    created_at timestamptz not null default now()
);

create index scores_rank_idx on public.scores (difficulty, time_ms, deaths);

alter table public.scores enable row level security;
create policy "누구나 기록을 볼 수 있다" on public.scores for select using (true);
create policy "로그인한 사람은 자기 기록만 올린다" on public.scores
    for insert to authenticated with check (user_id = auth.uid());

-- ------------------------------------------------------------ 랭킹
-- 한 사람당 난이도별 최고 기록 하나 (시간이 짧을수록, 같으면 덜 죽을수록 위)
create view public.leaderboard with (security_invoker = on) as
select distinct on (s.user_id, s.difficulty)
       s.difficulty, s.user_id, p.nickname, s.time_ms, s.deaths, s.created_at
from public.scores s
join public.profiles p on p.id = s.user_id
order by s.user_id, s.difficulty, s.time_ms, s.deaths, s.created_at;
