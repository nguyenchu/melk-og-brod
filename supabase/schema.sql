-- Melk&Brød database schema
-- Kjør dette i Supabase dashboard → SQL Editor → New query → Run

-- =============================================
-- TABELLER
-- =============================================

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  household_id uuid references households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  name text not null,
  checked boolean not null default false,
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table invites (
  code text primary key,
  household_id uuid not null references households(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  used_count integer not null default 0,
  max_uses integer not null default 10
);

-- =============================================
-- INDEKSER
-- =============================================

create index on memberships(user_id);
create index on lists(household_id);
create index on items(list_id);
create index on invites(household_id);

-- =============================================
-- HJELPEFUNKSJON: sjekker medlemskap
-- =============================================

create or replace function is_member_of(h_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from memberships
    where household_id = h_id and user_id = auth.uid()
  );
$$;

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

alter table households enable row level security;
alter table memberships enable row level security;
alter table lists enable row level security;
alter table items enable row level security;
alter table invites enable row level security;

-- households: medlemmer kan lese, alle innloggede kan opprette
create policy "members can read household"
  on households for select
  using (is_member_of(id));

create policy "authenticated can create household"
  on households for insert
  with check (auth.uid() is not null);

create policy "owner can update household"
  on households for update
  using (exists (
    select 1 from memberships
    where household_id = households.id
      and user_id = auth.uid()
      and role = 'owner'
  ));

-- memberships: medlemmer kan se egen husholdnings medlemmer
create policy "members can read memberships"
  on memberships for select
  using (is_member_of(household_id));

create policy "users can insert own membership"
  on memberships for insert
  with check (user_id = auth.uid());

create policy "users can leave household"
  on memberships for delete
  using (user_id = auth.uid());

-- lists: kun medlemmer
create policy "members can read lists"
  on lists for select using (is_member_of(household_id));
create policy "members can insert lists"
  on lists for insert with check (is_member_of(household_id));
create policy "members can update lists"
  on lists for update using (is_member_of(household_id));
create policy "members can delete lists"
  on lists for delete using (is_member_of(household_id));

-- items: kun medlemmer av husholdningen som eier lista
create policy "members can read items"
  on items for select
  using (exists (
    select 1 from lists
    where lists.id = items.list_id and is_member_of(lists.household_id)
  ));
create policy "members can insert items"
  on items for insert
  with check (
    added_by = auth.uid() and
    exists (
      select 1 from lists
      where lists.id = items.list_id and is_member_of(lists.household_id)
    )
  );
create policy "members can update items"
  on items for update
  using (exists (
    select 1 from lists
    where lists.id = items.list_id and is_member_of(lists.household_id)
  ));
create policy "members can delete items"
  on items for delete
  using (exists (
    select 1 from lists
    where lists.id = items.list_id and is_member_of(lists.household_id)
  ));

-- invites: medlemmer kan se/lage invitasjoner for egen husholdning
create policy "members can read invites"
  on invites for select using (is_member_of(household_id));
create policy "members can create invites"
  on invites for insert
  with check (is_member_of(household_id) and created_by = auth.uid());
create policy "members can delete invites"
  on invites for delete using (is_member_of(household_id));

-- =============================================
-- RPC: opprett husholdning + gjør oppretter til owner
-- =============================================
-- Kjører atomisk slik at RLS ikke blokkerer RETURNING.

create or replace function create_household(household_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_household_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Må være innlogget';
  end if;

  insert into households (name) values (household_name)
    returning id into v_household_id;

  insert into memberships (household_id, user_id, role)
    values (v_household_id, auth.uid(), 'owner');

  return v_household_id;
end;
$$;

-- =============================================
-- RPC: løs inn invitasjonskode
-- =============================================
-- Kalles fra klient: supabase.rpc('redeem_invite', { invite_code: 'ABC123' })
-- Sjekker utløp, bruk, og legger til brukeren i husholdningen.

create or replace function redeem_invite(invite_code text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_household_id uuid;
  v_expires_at timestamptz;
  v_used_count integer;
  v_max_uses integer;
begin
  if auth.uid() is null then
    raise exception 'Må være innlogget';
  end if;

  select household_id, expires_at, used_count, max_uses
    into v_household_id, v_expires_at, v_used_count, v_max_uses
    from invites where code = invite_code;

  if v_household_id is null then
    raise exception 'Ugyldig kode';
  end if;
  if v_expires_at < now() then
    raise exception 'Koden er utløpt';
  end if;
  if v_used_count >= v_max_uses then
    raise exception 'Koden er brukt opp';
  end if;

  insert into memberships (household_id, user_id, role)
    values (v_household_id, auth.uid(), 'member')
    on conflict do nothing;

  update invites set used_count = used_count + 1 where code = invite_code;

  return v_household_id;
end;
$$;

-- =============================================
-- REALTIME: aktiver for items og lists
-- =============================================

alter publication supabase_realtime add table items;
alter publication supabase_realtime add table lists;
