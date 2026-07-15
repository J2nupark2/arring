-- Shared rate limits must live in Postgres so every Vercel instance observes
-- the same counters. Only the service role can consume this function.
create table if not exists public.api_rate_limits (
  key_hash text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (key_hash, bucket_start)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket timestamptz;
  v_count integer;
  v_retry_after integer;
begin
  if p_key_hash is null or length(p_key_hash) < 16 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit configuration';
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits (
    key_hash, bucket_start, request_count, expires_at
  ) values (
    p_key_hash,
    v_bucket,
    1,
    v_bucket + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (key_hash, bucket_start)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into v_count;

  if random() < 0.01 then
    delete from public.api_rate_limits where expires_at < v_now;
  end if;

  v_retry_after := greatest(
    1,
    ceil(extract(epoch from (v_bucket + make_interval(secs => p_window_seconds) - v_now)))::integer
  );

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(0, p_limit - v_count),
    'retryAfter', case when v_count > p_limit then v_retry_after else 0 end
  );
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_api_rate_limit(text, integer, integer) from anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;
