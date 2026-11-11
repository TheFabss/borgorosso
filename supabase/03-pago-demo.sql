-- BORGOROSSO · Pago en línea SIMULADO, solo para la demostración.
-- Permite que un cliente marque su propio pedido como pagado sin cobrar nada.
-- Antes de abrir al público, eliminarlo con:
--   drop function public.pagar_en_linea_demo(uuid[]);

create or replace function public.pagar_en_linea_demo(p_tokens uuid[])
returns void
language sql security definer set search_path = public
as $$
  update pedidos
  set pago_estado = 'pagado', pago_metodo = 'en_linea', solicita_caja = false
  where token = any (p_tokens[1:30]) and pago_estado = 'pendiente';
$$;

revoke execute on function public.pagar_en_linea_demo(uuid[]) from public;
grant execute on function public.pagar_en_linea_demo(uuid[]) to anon, authenticated;
