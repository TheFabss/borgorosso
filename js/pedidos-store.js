/* =========================================================
   BORGOROSSO · pedidos-store.js
   Única capa que lee y escribe comandas. Hoy usa localStorage
   (demostración en un solo navegador); para producción se
   reemplaza este archivo por un driver serverless con la
   misma API asíncrona.
   ========================================================= */
(function () {
  'use strict';

  const CLAVE = 'borgorosso_comandas';
  const ESTADOS = ['nuevo', 'preparando', 'listo', 'entregado'];
  const oyentes = new Set();

  function leer() {
    try {
      return JSON.parse(localStorage.getItem(CLAVE)) || [];
    } catch {
      return [];
    }
  }

  const avisar = () => {
    const lista = leer();
    oyentes.forEach((fn) => fn(lista));
  };

  function guardar(lista) {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
    avisar();
  }

  /* Otras pestañas del mismo navegador reciben los cambios al instante. */
  window.addEventListener('storage', (e) => {
    if (e.key === CLAVE) avisar();
  });

  function modificar(ids, cambio) {
    guardar(leer().map((p) => (ids.includes(p.id) ? cambio(p) : p)));
  }

  /* En producción el total debe recalcularse en el servidor con los precios oficiales. */
  async function crear({ lugar, origen, cliente = '', items, notas = '' }) {
    const lista = leer();
    const pedido = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      numero: lista.reduce((max, p) => Math.max(max, p.numero), 0) + 1,
      lugar,
      origen,
      cliente,
      items,
      notas,
      total: items.reduce((suma, i) => suma + i.precio * i.cantidad, 0),
      estado: 'nuevo',
      pago: { estado: 'pendiente', metodo: '', solicitaCaja: false },
      creado: new Date().toISOString()
    };
    lista.push(pedido);
    guardar(lista);
    return pedido;
  }

  async function avanzar(id) {
    modificar([id], (p) => {
      const siguiente = ESTADOS[ESTADOS.indexOf(p.estado) + 1];
      return siguiente ? { ...p, estado: siguiente } : p;
    });
  }

  async function retroceder(id) {
    modificar([id], (p) => {
      const anterior = ESTADOS[ESTADOS.indexOf(p.estado) - 1];
      return anterior ? { ...p, estado: anterior } : p;
    });
  }

  async function pagar(ids, metodo) {
    modificar(ids, (p) => ({ ...p, pago: { estado: 'pagado', metodo, solicitaCaja: false } }));
  }

  async function solicitarCaja(ids) {
    modificar(ids, (p) => ({ ...p, pago: { ...p.pago, solicitaCaja: true } }));
  }

  function suscribir(fn) {
    oyentes.add(fn);
    fn(leer());
    return () => oyentes.delete(fn);
  }

  const esc = (texto) => String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const pagarEnLinea = (ids) => pagar(ids, 'en_linea');

  window.BorgoPedidos = {
    ESTADOS, crear, avanzar, retroceder, pagar, pagarEnLinea, solicitarCaja, suscribir, esc,
    remoto: false,
    suscribirCliente: suscribir,
    refrescar: async () => avisar()
  };
})();
