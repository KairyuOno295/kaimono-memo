-- =====================================================================
-- かいものメモ（買い物・欲しいものリスト）用の Supabase の設定
--
-- 使い方：Supabase の画面「SQL Editor」→「New query」に、このファイルの中身を全部貼り付けて「Run」。
--   何度実行しても同じ結果になるように書いてある（もう一度実行しても、データは消えない）。
--
-- 中身：
--   1. テーブル（データの表）
--   2. 自動で動く処理（トリガー）と、権限の確認に使う関数
--   3. 列ごとの書き込み権限（変えてはいけない列を守る）
--   4. 行レベルセキュリティ（RLS：本人と共有メンバーしか見られない・変えられないようにする）
--   5. 招待のしくみ（関数）
--   6. 写真の保存場所（Storage）と権限
--   7. リアルタイム同期の設定
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. テーブル
-- ---------------------------------------------------------------------

-- リスト（例：スーパー・ドラッグストア・欲しいもの）
create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  emoji       text not null default '🛒' check (char_length(emoji) <= 16),
  color       text not null default 'pink' check (char_length(color) <= 20),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- リストのメンバー（持ち主も1行ある）。position は、その人の一覧での並び順
create table if not exists public.list_members (
  list_id     uuid not null references public.lists (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text,
  role        text not null default 'member' check (role in ('owner', 'member')),
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index if not exists list_members_user_idx on public.list_members (user_id);

-- 招待中（まだ登録・ログインしていない人のメールアドレス）
create table if not exists public.list_invites (
  list_id     uuid not null references public.lists (id) on delete cascade,
  email       text not null check (char_length(email) <= 320),
  invited_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (list_id, email)
);
create index if not exists list_invites_email_idx on public.list_invites (email);

-- 自分で追加したカテゴリ（最初から入っているカテゴリは、アプリの中に書いてある）
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  emoji       text not null default '🏷️' check (char_length(emoji) <= 16),
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists categories_owner_idx on public.categories (owner_id);

-- 品目（店名・価格は将来の価格比較用。今は入力しなくてもよい）
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.lists (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  quantity    text not null default '' check (char_length(quantity) <= 30),
  note        text not null default '' check (char_length(note) <= 1000),
  category    text not null default '' check (char_length(category) <= 64),
  photo_path  text check (photo_path is null or char_length(photo_path) <= 300),
  store       text not null default '' check (char_length(store) <= 100),
  price       numeric(12, 2) check (price is null or price >= 0),
  checked     boolean not null default false,
  checked_at  timestamptz,
  position    double precision not null default 0,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists items_list_idx on public.items (list_id);

-- 入力候補のための履歴（過去に追加した品目。本人だけが見られる）
create table if not exists public.item_history (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name_key      text not null check (char_length(name_key) <= 200),
  name          text not null check (char_length(name) <= 200),
  category      text not null default '' check (char_length(category) <= 64),
  use_count     integer not null default 1 check (use_count >= 0),
  last_used_at  timestamptz not null default now(),
  primary key (user_id, name_key)
);


-- ---------------------------------------------------------------------
-- 2. 自動で動く処理（トリガー）と、権限の確認に使う関数
--    security definer：関数を作った人（管理者）の権限で動く。
--    RLS の確認の中で同じ表を見るときに、無限にくり返さないようにするために使う。
-- ---------------------------------------------------------------------

-- 更新日時を自動で入れる
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lists_touch_updated_at on public.lists;
create trigger lists_touch_updated_at before update on public.lists
  for each row execute function public.touch_updated_at();

drop trigger if exists items_touch_updated_at on public.items;
create trigger items_touch_updated_at before update on public.items
  for each row execute function public.touch_updated_at();

-- リストを作ったら、作った人を「持ち主」としてメンバーに入れる
create or replace function public.handle_new_list()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.list_members (list_id, user_id, email, role, position)
  values (
    new.id,
    new.owner_id,
    (select lower(u.email) from auth.users u where u.id = new.owner_id),
    'owner',
    coalesce((select max(m.position) from public.list_members m where m.user_id = new.owner_id), 0) + 1
  )
  on conflict (list_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_list_created on public.lists;
create trigger on_list_created after insert on public.lists
  for each row execute function public.handle_new_list();

-- ログイン中の人が、そのリストのメンバーか
create or replace function public.is_list_member(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.list_members m
    where m.list_id = p_list_id and m.user_id = auth.uid()
  );
$$;

-- ログイン中の人が、そのリストの持ち主か
create or replace function public.is_list_owner(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.list_members m
    where m.list_id = p_list_id and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- ログイン中の人が、その人と同じリストを共有しているか（自分自身なら true）
create or replace function public.shares_list_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user = auth.uid() or exists (
    select 1
    from public.list_members a
    join public.list_members b on b.list_id = a.list_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- 写真のファイル名（「リストのID/品目のID-時刻.jpg」）から、見てよいかを決める
create or replace function public.can_access_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_list uuid;
begin
  begin
    v_list := split_part(p_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return public.is_list_member(v_list);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. 列ごとの書き込み権限
--    ログインしていない人（anon）は何もできない。
--    ログインした人（authenticated）も、変えてよい列だけ書き込める
--    （例：リストの持ち主 owner_id や、品目のリスト list_id は、あとから変えられない）。
-- ---------------------------------------------------------------------
revoke all on public.lists, public.list_members, public.list_invites,
              public.items, public.categories, public.item_history from anon;

revoke insert, update on public.lists from authenticated;
grant select, delete on public.lists to authenticated;
grant insert (id, owner_id, name, emoji, color) on public.lists to authenticated;
grant update (name, emoji, color) on public.lists to authenticated;

revoke insert, update on public.list_members from authenticated;
grant select, delete on public.list_members to authenticated;
grant update (position) on public.list_members to authenticated;

revoke insert, update on public.list_invites from authenticated;
grant select, delete on public.list_invites to authenticated;

revoke insert, update on public.items from authenticated;
grant select, delete on public.items to authenticated;
grant insert (id, list_id, name, quantity, note, category, photo_path, store, price, checked, checked_at, position)
  on public.items to authenticated;
grant update (name, quantity, note, category, photo_path, store, price, checked, checked_at, position)
  on public.items to authenticated;

revoke insert, update on public.categories from authenticated;
grant select, delete on public.categories to authenticated;
grant insert (id, owner_id, name, emoji, position) on public.categories to authenticated;
grant update (name, emoji, position) on public.categories to authenticated;

grant select, insert, update, delete on public.item_history to authenticated;


-- ---------------------------------------------------------------------
-- 4. 行レベルセキュリティ（RLS）
--    有効にすると、下の「ポリシー」で許した行しか読み書きできなくなる。
-- ---------------------------------------------------------------------
alter table public.lists        enable row level security;
alter table public.list_members enable row level security;
alter table public.list_invites enable row level security;
alter table public.items        enable row level security;
alter table public.categories   enable row level security;
alter table public.item_history enable row level security;

-- lists：見る・変える＝メンバー、作る＝自分が持ち主、消す＝持ち主だけ
drop policy if exists lists_select on public.lists;
create policy lists_select on public.lists for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_list_member(id));
drop policy if exists lists_insert on public.lists;
create policy lists_insert on public.lists for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists lists_update on public.lists;
create policy lists_update on public.lists for update to authenticated
  using (public.is_list_member(id)) with check (public.is_list_member(id));
drop policy if exists lists_delete on public.lists;
create policy lists_delete on public.lists for delete to authenticated
  using (owner_id = (select auth.uid()));

-- list_members：見る＝同じリストのメンバー、並び順を変える＝自分の行だけ
--   外す＝持ち主（ほかの人を外す）か、本人（自分で抜ける）。持ち主の行は消せない
--   追加は、招待の関数（security definer）からだけ
drop policy if exists list_members_select on public.list_members;
create policy list_members_select on public.list_members for select to authenticated
  using (public.is_list_member(list_id));
drop policy if exists list_members_update on public.list_members;
create policy list_members_update on public.list_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists list_members_delete on public.list_members;
create policy list_members_delete on public.list_members for delete to authenticated
  using (role <> 'owner' and (user_id = (select auth.uid()) or public.is_list_owner(list_id)));

-- list_invites：見る＝持ち主と、招待された本人、取り消す＝持ち主
drop policy if exists list_invites_select on public.list_invites;
create policy list_invites_select on public.list_invites for select to authenticated
  using (public.is_list_owner(list_id) or email = lower(coalesce((select auth.jwt()) ->> 'email', '')));
drop policy if exists list_invites_delete on public.list_invites;
create policy list_invites_delete on public.list_invites for delete to authenticated
  using (public.is_list_owner(list_id));

-- items：そのリストのメンバーだけが、見る・追加・変更・削除できる
drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (public.is_list_member(list_id));
drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert to authenticated
  with check (public.is_list_member(list_id));
drop policy if exists items_update on public.items;
create policy items_update on public.items for update to authenticated
  using (public.is_list_member(list_id)) with check (public.is_list_member(list_id));
drop policy if exists items_delete on public.items;
create policy items_delete on public.items for delete to authenticated
  using (public.is_list_member(list_id));

-- categories：見る＝本人と、リストを共有している人（共有リストの表示用）、変える＝本人だけ
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (public.shares_list_with(owner_id));
drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated
  using (owner_id = (select auth.uid()));

-- item_history：本人だけ
drop policy if exists item_history_all on public.item_history;
create policy item_history_all on public.item_history for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- 5. 招待のしくみ
--    invite_to_list：持ち主がメールアドレスで招待する（招待中の表に入る）
--    claim_invites ：招待された人がアプリを開いたときに呼ばれ、メンバーになる
--                    （メールの確認が済んだ人だけ。他人のメールアドレスで登録されても参加できないように）
-- ---------------------------------------------------------------------
create or replace function public.invite_to_list(p_list_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if not public.is_list_owner(p_list_id) then
    raise exception 'このリストに招待できるのは、リストの持ち主だけです';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'メールアドレスの形が正しくありません';
  end if;
  if exists (select 1 from public.list_members m where m.list_id = p_list_id and lower(m.email) = v_email) then
    return 'already';
  end if;
  if (select count(*) from public.list_invites i where i.list_id = p_list_id) >= 20 then
    raise exception '招待中の人が多すぎます（1つのリストに20人まで）';
  end if;
  insert into public.list_invites (list_id, email, invited_by)
  values (p_list_id, v_email, auth.uid())
  on conflict (list_id, email) do nothing;
  return 'invited';
end;
$$;

create or replace function public.claim_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email     text;
  v_confirmed timestamptz;
  v_pos       double precision;
  v_count     integer := 0;
  r           record;
begin
  if auth.uid() is null then
    return 0;
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = auth.uid();
  if v_email is null or v_confirmed is null then
    return 0;
  end if;
  select coalesce(max(m.position), 0) into v_pos from public.list_members m where m.user_id = auth.uid();
  for r in delete from public.list_invites i where i.email = v_email returning i.list_id loop
    v_pos := v_pos + 1;
    insert into public.list_members (list_id, user_id, email, role, position)
    values (r.list_id, auth.uid(), v_email, 'member', v_pos)
    on conflict (list_id, user_id) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 関数を使える人：ログインした人だけ
revoke all on function public.is_list_member(uuid)      from public, anon;
revoke all on function public.is_list_owner(uuid)       from public, anon;
revoke all on function public.shares_list_with(uuid)    from public, anon;
revoke all on function public.can_access_photo(text)    from public, anon;
revoke all on function public.invite_to_list(uuid, text) from public, anon;
revoke all on function public.claim_invites()           from public, anon;
grant execute on function public.is_list_member(uuid)       to authenticated;
grant execute on function public.is_list_owner(uuid)        to authenticated;
grant execute on function public.shares_list_with(uuid)     to authenticated;
grant execute on function public.can_access_photo(text)     to authenticated;
grant execute on function public.invite_to_list(uuid, text) to authenticated;
grant execute on function public.claim_invites()            to authenticated;


-- ---------------------------------------------------------------------
-- 6. 写真の保存場所（Storage）
--    非公開の入れ物「item-photos」。1枚 2MB まで、JPEG だけ。
--    ファイル名の先頭（リストのID）で、そのリストのメンバーだけが見る・置く・消すことができる。
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists item_photos_select on storage.objects;
create policy item_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'item-photos' and public.can_access_photo(name));
drop policy if exists item_photos_insert on storage.objects;
create policy item_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos' and public.can_access_photo(name));
drop policy if exists item_photos_update on storage.objects;
create policy item_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'item-photos' and public.can_access_photo(name))
  with check (bucket_id = 'item-photos' and public.can_access_photo(name));
drop policy if exists item_photos_delete on storage.objects;
create policy item_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and public.can_access_photo(name));


-- ---------------------------------------------------------------------
-- 7. リアルタイム同期
--    変更をほかの端末にすぐ届けるため、表を「supabase_realtime」に登録する。
--    届くのは RLS で見てよい行の変更だけ。
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime がありません（Supabase 以外の環境）。リアルタイムの設定は飛ばします';
    return;
  end if;
  foreach t in array array['lists', 'list_members', 'list_invites', 'items', 'categories'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- おわり。「Success. No rows returned」と出れば成功です。
