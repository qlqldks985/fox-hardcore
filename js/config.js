// 온라인 랭킹 설정 (Supabase 대시보드 → Project Settings → API 에서 복사)
// 둘 다 비어 있으면 로그인·랭킹 없이 혼자 하는 게임으로 동작합니다.
// anonKey 는 공개용 키라서 저장소에 올라가도 괜찮습니다. (권한은 supabase/schema.sql 의 RLS 정책이 막아 줌)
window.FOX_ONLINE_CONFIG = {
    url: 'https://zdlyofbbfqxfhwxrfkff.supabase.co',
    anonKey: 'sb_publishable_C0eJWmEwDjR_nO-t-OCQNQ_r79dn6BS',
};
