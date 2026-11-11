-- 05 · Pedidos delivery que llegan por el bot de WhatsApp.
-- Permite el origen "whatsapp" y el lugar "Delivery · <nombre>". Todo lo demás no cambia:
-- los precios los pone la base de datos y el pedido entra como "por_confirmar".
-- Ejecutar una sola vez en el SQL Editor del proyecto de Borgorosso (TheFabss's Project).

alter table public.pedidos drop constraint if exists pedidos_origen_check;
alter table public.pedidos add constraint pedidos_origen_check
  check (origen in ('qr', 'celular', 'whatsapp'));

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
  if p_lugar !~ '^(Mesa [0-9]{1,3}|Recojo · .{1,50}|Delivery · .{1,50})$' then
    raise exception 'Mesa o nombre inválido';
  end if;
  if p_origen not in ('qr', 'celular', 'whatsapp') then
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
