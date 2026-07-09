-- Profile reputation scores now start from a neutral 50.0 instead of the
-- previous temperature-style 36.5 baseline.

alter table public.profiles
  alter column manner_temperature set default 50.0,
  alter column trust_temperature set default 50.0;

update public.profiles
set
  manner_temperature = case when manner_temperature = 36.5 then 50.0 else manner_temperature end,
  trust_temperature = case when trust_temperature = 36.5 then 50.0 else trust_temperature end
where manner_temperature = 36.5
   or trust_temperature = 36.5;
