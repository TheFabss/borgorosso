-- BORGOROSSO · Esquema de pedidos. Pegar en Supabase > SQL Editor y ejecutar.
-- Se puede ejecutar más de una vez.
--
-- Seguridad:
--   * Los clientes (anon) no leen ni escriben tablas: solo usan las funciones de abajo.
--   * El precio se toma siempre de la tabla precios, nunca del navegador.
--   * Cada pedido tiene un token secreto; solo quien lo tiene ve ese pedido.
--   * Cocina y caja deben iniciar sesión y su correo debe estar en la tabla personal.

create table if not exists public.precios (
  plato_id text not null,
  variante text not null default '',
  nombre   text not null,
  precio   numeric(8,2) not null check (precio >= 0),
  primary key (plato_id, variante)
);

create table if not exists public.personal (
  email text primary key,
  rol   text not null default 'personal'
);

create table if not exists public.pedidos (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity,
  token         uuid not null default gen_random_uuid(),
  lugar         text not null,
  origen        text not null check (origen in ('qr', 'celular')),
  cliente       text not null default '',
  items         jsonb not null,
  notas         text not null default '',
  total         numeric(10,2) not null,
  estado        text not null default 'nuevo' check (estado in ('nuevo', 'preparando', 'listo', 'entregado')),
  pago_estado   text not null default 'pendiente' check (pago_estado in ('pendiente', 'pagado')),
  pago_metodo   text not null default '' check (pago_metodo in ('', 'efectivo', 'tarjeta', 'yape_plin', 'en_linea')),
  solicita_caja boolean not null default false,
  creado        timestamptz not null default now()
);
create index if not exists pedidos_creado_idx on public.pedidos (creado desc);
create index if not exists pedidos_token_idx on public.pedidos (token);

alter table public.precios  enable row level security;
alter table public.personal enable row level security;
alter table public.pedidos  enable row level security;

revoke all on public.precios, public.personal, public.pedidos from anon, authenticated;

create or replace function public.es_personal()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from personal where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- Personal: ve los pedidos y solo puede cambiar estado y pago.
grant select on public.pedidos to authenticated;
grant update (estado, pago_estado, pago_metodo, solicita_caja) on public.pedidos to authenticated;

drop policy if exists personal_lee_pedidos on public.pedidos;
create policy personal_lee_pedidos on public.pedidos
  for select to authenticated using (public.es_personal());

drop policy if exists personal_actualiza_pedidos on public.pedidos;
create policy personal_actualiza_pedidos on public.pedidos
  for update to authenticated using (public.es_personal()) with check (public.es_personal());

-- Cliente: crea el pedido; los precios y el total se calculan aquí.
create or replace function public.crear_pedido(
  p_lugar text, p_origen text, p_cliente text, p_items jsonb, p_notas text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_entrada jsonb;
  v_precio  precios%rowtype;
  v_cant    int;
  v_items   jsonb := '[]'::jsonb;
  v_total   numeric := 0;
  v_fila    pedidos%rowtype;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 40 then
    raise exception 'Pedido inválido';
  end if;
  if p_lugar !~ '^(Mesa [0-9]{1,3}|Recojo · .{1,50})$' then
    raise exception 'Mesa o nombre inválido';
  end if;
  if p_origen not in ('qr', 'celular') then
    raise exception 'Origen inválido';
  end if;
  if char_length(coalesce(p_cliente, '')) > 50 or char_length(coalesce(p_notas, '')) > 160 then
    raise exception 'Texto demasiado largo';
  end if;

  for v_entrada in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_entrada ->> 'cantidad')::int;
    if v_cant not between 1 and 50 then
      raise exception 'Cantidad inválida';
    end if;
    select * into v_precio from precios
      where plato_id = v_entrada ->> 'id' and variante = coalesce(v_entrada ->> 'variante', '');
    if not found then
      raise exception 'Plato no disponible';
    end if;
    v_items := v_items || jsonb_build_object(
      'nombre', v_precio.nombre, 'variante', v_precio.variante,
      'precio', v_precio.precio, 'cantidad', v_cant
    );
    v_total := v_total + v_precio.precio * v_cant;
  end loop;

  insert into pedidos (lugar, origen, cliente, items, notas, total)
    values (p_lugar, p_origen, coalesce(p_cliente, ''), v_items, coalesce(p_notas, ''), v_total)
    returning * into v_fila;
  return to_jsonb(v_fila);
end;
$$;

-- Cliente: consulta solo los pedidos de los que tiene el token (últimas 12 horas).
create or replace function public.ver_mis_pedidos(p_tokens uuid[])
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.numero), '[]'::jsonb)
  from pedidos p
  where p.token = any (p_tokens[1:30]) and p.creado > now() - interval '12 hours';
$$;

-- Cliente: avisa que pagará en caja.
create or replace function public.solicitar_caja(p_tokens uuid[])
returns void
language sql security definer set search_path = public
as $$
  update pedidos set solicita_caja = true
  where token = any (p_tokens[1:30]) and pago_estado = 'pendiente';
$$;

-- Las funciones son públicas por defecto: se limita cada una a quien la necesita.
revoke execute on function public.es_personal() from public;
revoke execute on function public.crear_pedido(text, text, text, jsonb, text) from public;
revoke execute on function public.ver_mis_pedidos(uuid[]) from public;
revoke execute on function public.solicitar_caja(uuid[]) from public;
grant execute on function public.es_personal() to authenticated;
grant execute on function public.crear_pedido(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.ver_mis_pedidos(uuid[]) to anon, authenticated;
grant execute on function public.solicitar_caja(uuid[]) to anon, authenticated;

-- Tiempo real para cocina y caja.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos'
  ) then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end;
$$;
