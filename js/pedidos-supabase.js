/* =========================================================
   BORGOROSSO · pedidos-supabase.js
   Sustituye la capa local por Supabase cuando supabase-config.js
   tiene url. Cocina y caja reciben cambios en tiempo real;
   el cliente consulta sus pedidos por token cada pocos segundos.
   ========================================================= */
(function () {
  'use strict';

  const cfg = window.BORGO_SUPABASE || {};
  const local = window.BorgoPedidos;
  if (!cfg.url) return;

  /* Con url configurada nunca se cae a modo local: un pedido no debe perderse en silencio. */
  if (!window.supabase) {
    local.crear = async () => { throw new Error('Sin conexión con el sistema de pedidos.'); };
    return;
  }

  const db = window.supabase.createClient(cfg.url, cfg.publishableKey);
  const CLAVE_MIOS = 'borgorosso_mesa_pedidos';
  const MS_CLIENTE = 5000;
  const MS_RESPALDO = 20000;
  const HORAS_HISTORIAL = 36;
  const formatoToken = /^[0-9a-f-]{36}$/i;

  const aPedido = (f) => ({
    id: f.id,
    token: f.token,
    numero: Number(f.numero),
    lugar: f.lugar,
    origen: f.origen,
    cliente: f.cliente,
    items: f.items,
    notas: f.notas,
    total: Number(f.total),
    estado: f.estado,
    pago: { estado: f.pago_estado, metodo: f.pago_metodo, solicitaCaja: f.solicita_caja },
    creado: f.creado
  });

  function comprobar({ error }) {
    if (error) throw new Error(error.message);
  }

  function misTokens() {
    try {
      return (JSON.parse(localStorage.getItem(CLAVE_MIOS)) || []).filter((t) => formatoToken.test(t));
    } catch {
      return [];
    }
  }

  const refrescos = new Set();
  const refrescar = () => Promise.all([...refrescos].map((fn) => fn()));

  /* ---------- Cliente ---------- */
  async function crear({ lugar, origen, cliente = '', items, notas = '' }) {
    const { data, error } = await db.rpc('crear_pedido', {
      p_lugar: lugar,
      p_origen: origen,
      p_cliente: cliente,
      p_items: items.map(({ id, variante, cantidad }) => ({ id, variante, cantidad })),
      p_notas: notas
    });
    if (error) throw new Error(error.message);
    return aPedido(data);
  }

  async function solicitarCaja(tokens) {
    comprobar(await db.rpc('solicitar_caja', { p_tokens: tokens }));
    await refrescar();
  }

  async function pagarEnLinea(tokens) {
    comprobar(await db.rpc('pagar_en_linea_demo', { p_tokens: tokens }));
    await refrescar();
  }

  function suscribirCliente(fn) {
    const cargar = async () => {
      const tokens = misTokens();
      if (!tokens.length) {
        fn([]);
        return;
      }
      const { data, error } = await db.rpc('ver_mis_pedidos', { p_tokens: tokens });
      if (error) console.warn('No se pudo actualizar el pedido:', error.message);
      else fn(data.map(aPedido));
    };
    refrescos.add(cargar);
    cargar();
    setInterval(cargar, MS_CLIENTE);
  }

  /* ---------- Personal (requiere sesión) ---------- */
  let ultimos = [];

  async function avanzar(id) {
    const pedido = ultimos.find((p) => p.id === id);
    const siguiente = pedido && local.ESTADOS[local.ESTADOS.indexOf(pedido.estado) + 1];
    if (!siguiente) return;
    comprobar(await db.from('pedidos').update({ estado: siguiente }).eq('id', id));
    await refrescar();
  }

  async function retroceder(id) {
    const pedido = ultimos.find((p) => p.id === id);
    const anterior = pedido && local.ESTADOS[local.ESTADOS.indexOf(pedido.estado) - 1];
    if (!anterior) return;
    comprobar(await db.from('pedidos').update({ estado: anterior }).eq('id', id));
    await refrescar();
  }

  async function rechazar(id) {
    comprobar(await db.from('pedidos').update({ estado: 'rechazado' }).eq('id', id));
    await refrescar();
  }

  async function pagar(ids, metodo) {
    comprobar(await db.from('pedidos')
      .update({ pago_estado: 'pagado', pago_metodo: metodo, solicita_caja: false })
      .in('id', ids));
    await refrescar();
  }

  function suscribir(fn) {
    const cargar = async () => {
      const desde = new Date(Date.now() - HORAS_HISTORIAL * 3600000).toISOString();
      const { data, error } = await db.from('pedidos')
        .select('*')
        .or(`creado.gte.${desde},pago_estado.eq.pendiente`)
        .order('numero')
        .limit(500);
      if (error) {
        console.warn('No se pudieron cargar los pedidos:', error.message);
        return;
      }
      ultimos = data.map(aPedido);
      fn(ultimos);
    };
    refrescos.add(cargar);
    cargar();
    db.channel('pedidos-personal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, cargar)
      .subscribe();
    setInterval(cargar, MS_RESPALDO); // respaldo si se corta la conexión en tiempo real
  }

  window.BorgoPedidos = {
    ESTADOS: local.ESTADOS,
    esc: local.esc,
    remoto: true,
    db,
    crear,
    avanzar,
    retroceder,
    rechazar,
    pagar,
    pagarEnLinea,
    solicitarCaja,
    suscribir,
    suscribirCliente,
    refrescar
  };
})();
