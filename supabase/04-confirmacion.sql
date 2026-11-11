-- 04 · Confirmación de pedidos por el personal.
-- Cada pedido nuevo entra como "por_confirmar": un mozo verifica que haya personas
-- en la mesa y cocina lo acepta (pasa a "nuevo") o lo rechaza ("rechazado").
-- Ejecutar una sola vez en el SQL Editor de Supabase.

alter table public.pedidos drop constraint if exists pedidos_estado_check;
alter table public.pedidos add constraint pedidos_estado_check
  check (estado in ('por_confirmar', 'nuevo', 'preparando', 'listo', 'entregado', 'rechazado'));

alter table public.pedidos alter column estado set default 'por_confirmar';

-- Un pedido sin confirmar o rechazado no se puede pagar en línea.
create or replace function public.pagar_en_linea_demo(p_tokens uuid[])
returns void
language sql security definer set search_path = public
as $$
  update pedidos
  set pago_estado = 'pagado', pago_metodo = 'en_linea', solicita_caja = false
  where token = any (p_tokens[1:30]) and pago_estado = 'pendiente'
    and estado not in ('por_confirmar', 'rechazado');
$$;
