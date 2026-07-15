create or replace function public.unlink_aion2_character(p_character_row_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target public.aion2_characters%rowtype;
  replacement public.aion2_characters%rowtype;
begin
  if me is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'authenticated_account_required';
  end if;

  select * into target
  from public.aion2_characters
  where id = p_character_row_id
    and user_id = me
  for update;

  if not found then
    raise exception 'character_not_found';
  end if;

  if exists (
    select 1 from public.match_queue
    where character_row_id = target.id
      and status in ('waiting', 'processing')
  ) or exists (
    select 1 from public.match_requests
    where character_row_id = target.id
      and status in ('waiting', 'processing')
  ) then
    raise exception 'character_in_active_matching';
  end if;

  delete from public.aion2_characters where id = target.id;

  if target.is_primary then
    select * into replacement
    from public.aion2_characters
    where user_id = me
    order by synced_at desc, created_at desc
    limit 1
    for update;

    if found then
      update public.aion2_characters
      set is_primary = (id = replacement.id)
      where user_id = me;

      update public.profiles
      set
        server = replacement.server_name,
        char_class = replacement.class_name,
        combat_power = replacement.combat_power,
        aion2_character_id = replacement.character_id,
        aion2_character_name = replacement.character_name,
        aion2_server_id = replacement.server_id,
        aion2_synced_at = replacement.synced_at
      where id = me;

      return jsonb_build_object(
        'deletedId', target.id,
        'newPrimaryId', replacement.id
      );
    end if;

    update public.profiles
    set
      server = null,
      char_class = null,
      combat_power = null,
      aion2_character_id = null,
      aion2_character_name = null,
      aion2_server_id = null,
      aion2_synced_at = null
    where id = me;
  end if;

  return jsonb_build_object('deletedId', target.id, 'newPrimaryId', null);
end;
$$;

revoke all on function public.unlink_aion2_character(uuid) from public;
grant execute on function public.unlink_aion2_character(uuid) to authenticated;
