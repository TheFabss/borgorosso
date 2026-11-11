/* =========================================================
   BORGOROSSO · chatbot.js
   Asistente híbrido: automatiza pedidos y reservas, y
   responde preguntas frecuentes (FAQ) al instante.
   Máquina de estados con persistencia en localStorage.
   Requiere app.js cargado antes.
   ========================================================= */
(function () {
  'use strict';

  const B = window.Borgorosso;
  if (!B) return;

  const CLAVE_CHAT = 'borgorosso_chat';
  /* Sube este número cuando cambien los textos: las conversaciones guardadas con textos viejos se descartan. */
  const VERSION_CHAT = 2;
  const HORAS_SESION = 12;
  const MAX_MENSAJES = 60;
  const GPS = '__GPS__';
  const MAPA = 'https://www.google.com/maps/search/?api=1&query=Jr.+Cuzco+166+Chosica+Lima';
  const CTA_PEDIDO = 'Quiero hacer un pedido';

  const E = {
    ESPERA_SI: 'espera_si',
    NOMBRE: 'nombre',
    MENU: 'menu',
    FAQ: 'faq',
    MESA_O_RESERVA: 'mesa_o_reserva',
    PEDIDO_MODALIDAD: 'pedido_modalidad',
    PEDIDO_CARRITO: 'pedido_carrito',
    PEDIDO_PLATOS: 'pedido_platos',
    PEDIDO_MESA: 'pedido_mesa',
    PEDIDO_UBICACION: 'pedido_ubicacion',
    PEDIDO_NOTAS: 'pedido_notas',
    RES_EVT_ZONA: 'res_evt_zona',
    RES_FECHA_DIA: 'res_fecha_dia',
    RES_FECHA_HORA: 'res_fecha_hora',
    RES_FECHA_PERSONAS: 'res_fecha_personas',
    RES_FECHA_MOTIVO: 'res_fecha_motivo'
  };

  /* ---------- Preguntas frecuentes ---------- */
  const FAQS = [
    {
      id: 'ubicacion',
      chip: 'Ubicación',
      claves: /donde|ubica|direccion|sede|llegar|mapa|queda/,
      respuesta: () => 'Somos sede única en Chosica, un rincón exclusivo donde combinamos arte, tradición y buena mesa. Nos encuentras en Jr. Cuzco 166-366, Lurigancho-Chosica.',
      url: MAPA,
      urlLabel: '🗺️ Abrir en Google Maps'
    },
    {
      id: 'horarios',
      chip: 'Horarios y delivery',
      claves: /horario|abren|abierto|cierran|atienden|atencion|a que hora|hasta que hora/,
      respuesta: () => 'Atendemos en nuestro local todos los días de 8:30 AM a 11:00 PM. Nuestros pedidos por Delivery salen a partir del mediodía (12:00 PM).'
    },
    {
      id: 'comida',
      chip: '¿Qué comida ofrecen?',
      claves: /comida|cocina|especialidad|ofrecen|venden|que platos|tipo de/,
      respuesta: () => 'Nuestra especialidad une lo mejor de la comida criolla, pastas artesanales hechas en casa, pizzas a la leña, pollo a la leña, postres caseros y coctelería.'
    },
    {
      id: 'ambiente',
      chip: 'Galería y ambiente',
      claves: /galeria|ambiente|arte|chimenea|decoracion|pinturas|cuadros|jardin|lugar/,
      respuesta: () => 'Borgorosso es una casona-galería. Contamos con salón interior de estilo clásico con chimenea y pinturas originales en exhibición, además de una terraza al aire libre, floral y vintage, también con pinturas, ideal para familias, parejas o amigos.'
    },
    {
      id: 'eventos',
      chip: 'Eventos',
      claves: /evento|navidad|diciembre|nochebuena|campana/,
      respuesta: () => (B.eventoVigente()
        ? '¡Diciembre se vive en la casona! Celebra la Navidad con nosotros: reserva tu mesa con anticipación o cotiza el banquete de tu reunión de fin de año.'
        : 'Muy pronto anunciaremos nuestra próxima campaña. Síguenos en Instagram @borgorosso_chosica para enterarte primero.')
    },
    {
      id: 'pagos',
      chip: 'Medios de pago',
      claves: /pago|pagar|yape|plin|tarjeta|efectivo|visa|mastercard/,
      respuesta: () => 'Aceptamos efectivo, tarjetas de crédito/débito, Yape y Plin tanto en el local como en tus pedidos por delivery.'
    }
  ];

  const detectarFaq = (t) => FAQS.find((f) => f.claves.test(t)) || null;

  /* ---------- Reconocimiento de platos escritos en el chat ---------- */
  const ALIAS = {
    'pollo-lena': ['pollo'],
    'lomo-saltado': ['lomo'],
    'gaseosa-personal': ['gaseosa', 'inca kola', 'coca cola'],
    'il-gelato': ['helado', 'gelato'],
    'margherita': ['margarita'],
    'papas-fritas': ['papas fritas'],
    'sours': ['pisco sour', 'sour'],
    'chilcanos': ['chilcano'],
    'lasagne-bolognese': ['lasagna', 'lasana', 'lasagne']
  };
  /* La marca pedida viaja en el detalle para que cocina sepa cuál servir. */
  const MARCAS = { 'inca kola': 'Inca Kola', 'coca cola': 'Coca Cola' };
  const ALIAS_VARIANTE = {
    'Pollo entero': /\bentero\b|\b1 pollo\b|\bun pollo\b/,
    '1/2 Medio pollo': /1\/2|\bmedio\b/,
    '1/4 Cuarto de pollo': /1\/4|\bcuarto\b/,
    'Vaso': /\bvaso/,
    'Litro': /\blitro|\bjarra/,
    'Copa': /\bcopa/,
    'Botella': /\bbotella/,
    '1 Bola': /\b1 bola\b|\buna bola\b/,
    '2 Bolas': /\b2 bolas\b|\bdos bolas\b/
  };
  const PALABRAS_SOBRANTES = /\b(y|e|con|de|del|la|el|los|las|x|una?|unos?|unas|quiero|deseo|porfa(vor)?|por|favor|me|da|das|pedir|pizzas?|\d+)\b/g;

  function interpretarPlatos(texto) {
    const claves = [];
    B.CARTA.forEach((p) => {
      claves.push({ p, clave: B.normalizar(p.nombre) });
      (ALIAS[p.id] || []).forEach((alias) => claves.push({ p, clave: alias }));
    });
    claves.sort((a, b) => b.clave.length - a.clave.length);

    let resto = ` ${B.normalizar(texto)} `;
    const encontrados = [];
    claves.forEach(({ p, clave }) => {
      let idx = resto.indexOf(clave);
      while (idx !== -1) {
        const antes = resto.slice(0, idx);
        const despues = resto.slice(idx + clave.length, idx + clave.length + 16);
        const cantidad = antes.match(/(?:^|[^\d/])(\d+)\s*(?:x\s*)?$/);
        let variante = null;
        if (p.variantes) {
          const ventana = `${antes.slice(-12)}${clave}${despues}`;
          variante = p.variantes.find((v) => ALIAS_VARIANTE[v.nombre]?.test(ventana)) || p.variantes[0];
        }
        encontrados.push({
          id: p.id,
          nombre: p.nombre,
          varianteCarta: variante ? variante.nombre : '',
          variante: variante ? variante.nombre : (MARCAS[clave] || ''),
          precio: variante ? variante.precio : p.precio,
          cantidad: cantidad ? Math.max(1, Number(cantidad[1])) : 1
        });
        const inicio = idx - (cantidad ? cantidad[0].length - (cantidad[0].match(/^[^\d]/) ? 1 : 0) : 0);
        resto = `${resto.slice(0, inicio)} | ${resto.slice(idx + clave.length)}`;
        idx = resto.indexOf(clave);
      }
    });

    const sobrante = resto
      .replace(/1\/2|1\/4|\bmedio\b|\bcuarto\b|\bentero\b|\bvasos?\b|\bjarras?\b|\blitros?\b|\bcopas?\b|\bbotellas?\b|\bbolas?\b/g, ' ')
      .replace(/[|,.;+]/g, ' ')
      .replace(PALABRAS_SOBRANTES, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { encontrados, sobrante: sobrante.length > 2 ? sobrante : '' };
  }

  const lineaPlato = (i) => `${i.cantidad} x ${i.nombre}${i.variante ? ` (${i.variante})` : ''} — S/ ${i.precio * i.cantidad}`;

  /* ---------- Sesión persistente ---------- */
  function cargarSesion() {
    try {
      const guardada = JSON.parse(localStorage.getItem(CLAVE_CHAT));
      const vigente = guardada && guardada.version === VERSION_CHAT
        && Date.now() - (guardada.actualizado || 0) < HORAS_SESION * 3600000;
      if (vigente && Object.values(E).includes(guardada.estado)) return guardada;
    } catch {
      /* sin datos válidos: se inicia una conversación nueva */
    }
    return { version: VERSION_CHAT, estado: E.ESPERA_SI, ctx: {}, mensajes: [] };
  }

  let sesion = cargarSesion();

  function guardarSesion() {
    sesion.mensajes = sesion.mensajes.slice(-MAX_MENSAJES);
    sesion.version = VERSION_CHAT;
    sesion.actualizado = Date.now();
    try {
      localStorage.setItem(CLAVE_CHAT, JSON.stringify(sesion));
    } catch {
      /* sin almacenamiento: el chat funciona durante la visita */
    }
  }

  const cliente = () => B.getClienteActivo();
  const nombreCliente = () => (cliente() ? cliente().nombre : '');
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- Construcción del widget ---------- */
  const widget = document.createElement('div');
  widget.className = 'bg-chat';
  widget.innerHTML = `
    <div class="bg-chat-invitacion" role="status" hidden>
      <p></p>
      <button type="button" class="bg-chat-invitacion__cerrar" aria-label="Ocultar invitación">×</button>
    </div>
    <button type="button" class="bg-chat-fab" aria-expanded="false" aria-controls="bg-chat-panel">
      <span aria-hidden="true">🍷</span><span class="bg-chat-fab__txt">Asistente Borgorosso</span>
    </button>
    <section id="bg-chat-panel" class="bg-chat-panel" role="dialog" aria-label="Asistente virtual de Borgorosso">
      <header class="bg-chat-head">
        <div>
          <p class="bg-chat-head__titulo">Borgorosso</p>
          <p class="bg-chat-head__sub">Pedidos · Reservas · Dudas frecuentes</p>
        </div>
        <div class="bg-chat-head__acciones">
          <button type="button" data-chat-menu>Menú</button>
          <button type="button" data-chat-cerrar aria-label="Cerrar asistente">✕</button>
        </div>
      </header>
      <div class="bg-chat-msgs" data-chat-msgs aria-live="polite"></div>
      <div class="bg-chat-quick" data-chat-quick></div>
      <form class="bg-chat-form" data-chat-form autocomplete="off">
        <input type="text" name="mensaje" maxlength="300" placeholder="Escribe tu respuesta o tu duda…" aria-label="Mensaje">
        <button type="submit" aria-label="Enviar">➤</button>
      </form>
    </section>`;
  document.body.appendChild(widget);

  const panel = widget.querySelector('#bg-chat-panel');
  const fab = widget.querySelector('.bg-chat-fab');
  const msgs = widget.querySelector('[data-chat-msgs]');
  const quick = widget.querySelector('[data-chat-quick]');
  const form = widget.querySelector('[data-chat-form]');
  const input = form.elements.mensaje;

  /* ---------- Render ---------- */
  function formatear(texto) {
    return B.escapar(texto).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function pintarMensaje(m) {
    const burbuja = document.createElement('div');
    burbuja.className = `bg-chat-msg bg-chat-msg--${m.de}`;
    burbuja.innerHTML = formatear(m.texto);
    if (m.url) {
      const enlace = document.createElement('a');
      enlace.href = m.url;
      enlace.target = '_blank';
      enlace.rel = 'noopener';
      enlace.className = 'bg-chat-link';
      enlace.textContent = m.urlLabel || 'Abrir enlace';
      burbuja.appendChild(enlace);
    }
    msgs.appendChild(burbuja);
    msgs.scrollTop = msgs.scrollHeight;
  }

  const chipsFaq = () => FAQS.map((f) => ({ label: f.chip, valor: `faq:${f.id}` }));
  const chipsPersonas = () => ['2', '4', '6', '8+'].map((n) => ({ label: n, valor: n.replace('+', '') }));

  function opcionesPara(estado) {
    switch (estado) {
      case E.ESPERA_SI:
        return [{ label: 'Sí, quiero comenzar', valor: 'si' }];
      case E.MENU:
        return [
          { label: B.mesaActual() ? `Pedir a la Mesa ${B.mesaActual()}` : 'Delivery / Para llevar', valor: '1' },
          { label: 'En mesa / Reservar', valor: '2' },
          { label: 'Preguntas frecuentes', valor: '3' },
          { label: 'Otra persona', valor: '4' }
        ];
      case E.FAQ:
        return [{ label: CTA_PEDIDO, valor: 'iniciar pedido', destacado: true }, ...chipsFaq(), { label: 'Menú', valor: 'menu' }];
      case E.MESA_O_RESERVA: {
        return [
          { label: 'Ya estoy en la casona', valor: '1' },
          { label: 'Reservar mesa', valor: '2' },
          { label: 'Cotizar banquete', valor: '3' }
        ];
      }
      case E.PEDIDO_MODALIDAD:
        return [
          { label: 'En la casona', valor: '1' },
          { label: 'Delivery / Para llevar', valor: '2' },
          { label: 'Cancelar', valor: 'cancelar' }
        ];
      case E.PEDIDO_CARRITO:
        return [
          { label: 'Sí, confirmar', valor: 'si' },
          { label: 'Escribir otros platos', valor: 'no' }
        ];
      case E.PEDIDO_UBICACION:
        return [{ label: 'Enviar mi ubicación actual', valor: GPS }];
      case E.PEDIDO_NOTAS:
        return [{ label: sesion.ctx.reintento ? 'Reintentar envío' : 'Sin comentarios', valor: 'no' }];
      case E.RES_FECHA_PERSONAS:
        return chipsPersonas();
      case E.RES_EVT_ZONA:
        return B.ZONAS.map((z, i) => ({ label: z.nombre, valor: String(i + 1) }));
      default:
        return [];
    }
  }

  function pintarOpciones() {
    quick.innerHTML = '';
    opcionesPara(sesion.estado).forEach((op) => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = `bg-chat-chip${op.destacado ? ' bg-chat-chip--cta' : ''}`;
      boton.textContent = op.label;
      boton.addEventListener('click', () => manejar(op.valor, op.label));
      quick.appendChild(boton);
    });
  }

  function renderizarTodo() {
    msgs.innerHTML = '';
    sesion.mensajes.forEach(pintarMensaje);
    pintarOpciones();
  }

  /* ---------- Emisión de mensajes ---------- */
  function bot(texto, extra = {}) {
    const m = { de: 'bot', texto, ...extra };
    sesion.mensajes.push(m);
    pintarMensaje(m);
    guardarSesion();
    pintarOpciones();
  }

  function usuario(texto) {
    const m = { de: 'usuario', texto };
    sesion.mensajes.push(m);
    pintarMensaje(m);
    quick.innerHTML = '';
    guardarSesion();
  }

  /* ---------- Interpretación de fechas, horas y zonas ---------- */
  function parsearFecha(texto) {
    const m = texto.trim().match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
    if (!m) return null;
    const hoy = B.ahoraLima().fecha;
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    let anio = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4));
    if (anio < 100) anio += 2000;

    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;

    let iso = `${anio}-${pad(mes)}-${pad(dia)}`;
    if (!m[3] && iso < hoy) iso = `${anio + 1}-${pad(mes)}-${pad(dia)}`;
    return iso;
  }

  function parsearHora(texto) {
    const m = B.normalizar(texto).match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const minutos = Number(m[2] || 0);
    const periodo = (m[3] || '').replace(/\./g, '');
    if (periodo === 'pm' && h < 12) h += 12;
    if (periodo === 'am' && h === 12) h = 0;
    if (h > 23 || minutos > 59) return null;
    return `${pad(h)}:${pad(minutos)}`;
  }

  function parsearZona(t) {
    const porNumero = { 1: 'salon', 2: 'terraza' }[t];
    if (porNumero) return porNumero;
    if (/salon|galeria|interior|chimenea/.test(t)) return 'salon';
    if (/terraza|jardin|aire libre|afuera/.test(t)) return 'terraza';
    return null;
  }

  /* ---------- Bienvenida y menú principal ---------- */
  function bienvenida() {
    const partes = [
      '¡Hola! Soy el asistente de Borgorosso. Te ayudo con pedidos, reservas y dudas.',
      'Atendemos todos los días de 8:30 AM a 11:00 PM y el delivery sale desde las 12:00 PM.'
    ];
    if (B.eventoVigente()) partes.push('¡Llegó la Navidad a la casona! Ya puedes reservar tu mesa de diciembre o cotizar tu banquete por aquí.');
    partes.push('Responde **si** para empezar.');
    return partes.join('\n\n');
  }

  function mostrarMenu() {
    sesion.estado = E.MENU;
    sesion.ctx = {};
    const mesa = B.mesaActual();
    bot(`¿En qué te ayudo hoy, ${nombreCliente()}?\n\n**Pedidos y reservas**\n1. ${mesa ? `Pedir a mi mesa (Mesa ${mesa})` : 'Delivery o para llevar'}\n2. Pedir en mesa o reservar\n\n**Dudas**\n3. Ubicación, horarios, comida, ambiente, eventos y pagos\n\n4. Soy otra persona\n\nTambién puedes escribirme tu duda directamente.`);
  }

  function reiniciarFlujo() {
    sesion.ctx = {};
    if (cliente()) return mostrarMenu();
    sesion.estado = E.ESPERA_SI;
    return bot('Listo, cancelé la solicitud. Responde **si** cuando quieras empezar de nuevo.');
  }

  /* ---------- Área B: preguntas frecuentes ---------- */
  function mostrarFaq() {
    sesion.estado = E.FAQ;
    sesion.ctx = {};
    return bot('💬 Estas son las dudas más frecuentes de nuestros clientes. Toca una o escríbeme tu pregunta:');
  }

  function responderFaq(faq) {
    sesion.estado = E.FAQ;
    sesion.ctx = {};
    const extra = faq.url ? { url: faq.url, urlLabel: faq.urlLabel } : {};
    return bot(faq.respuesta(), extra);
  }

  function elegirFaq(t) {
    if (/^faq:/.test(t)) {
      const faq = FAQS.find((f) => `faq:${f.id}` === t);
      if (faq) return responderFaq(faq);
    }
    if (/banquete|cotiz/.test(t)) return iniciarBanquete();
    if (/iniciar|listo|pedido|pedir|ordenar/.test(t)) return iniciarPedido();
    if (/reserv/.test(t)) return menuMesaReserva();
    const faq = detectarFaq(t);
    if (faq) return responderFaq(faq);
    return bot('Aún no tengo esa respuesta guardada. Puedes escribir a nuestro equipo por WhatsApp y te responderemos en breve.', {
      url: B.waLink(`¡Hola Borgorosso! Soy ${nombreCliente() || 'un cliente web'} y tengo una consulta.`),
      urlLabel: '💬 Escribir por WhatsApp'
    });
  }

  /* ---------- Área A: pedidos y reservas ---------- */
  function iniciarPedido() {
    return iniciarDelivery();
  }

  function iniciarDelivery() {
    const mesa = B.mesaActual();
    if (mesa) {
      sesion.ctx = { tipo: 'insitu', detalle: [], total: null };
      return pedirPlatos(`Estás en la **Mesa ${mesa}**: tu pedido va directo a cocina.`);
    }
    if (!B.deliveryDisponible()) {
      sesion.estado = E.MENU;
      return bot('🛵 Nuestros pedidos por Delivery salen a partir del mediodía (12:00 PM). Mientras tanto puedes pedir en mesa, reservar o resolver tus dudas.');
    }
    sesion.ctx = { tipo: 'delivery', detalle: [], total: null };
    return pedirPlatos('🛵 ¡Perfecto! Recuerda que nuestro delivery sale desde las 12:00 PM.');
  }

  function menuMesaReserva() {
    sesion.estado = E.MESA_O_RESERVA;
    sesion.ctx = {};
    const navidad = B.eventoVigente() ? ' (en diciembre, Navidad en la casona)' : '';
    return bot(`¿Qué necesitas?\n\n1. Ya estoy en la casona: pedir a mi mesa\n2. Reservar mesa${navidad}\n3. Cotizar un banquete (menú personalizado)`);
  }

  function elegirMesaReserva(t) {
    if (t === '3' || /banquete|cotiz/.test(t)) return iniciarBanquete();
    if (t === '1' || /estoy|mi mesa|situ|ahora/.test(t)) {
      if (!B.mesaActual()) {
        return bot('Para pedir a tu mesa, escanea el código QR que está en ella: así sabemos a qué mesa llevarlo. Desde aquí puedes pedir delivery o reservar.');
      }
      sesion.ctx = { tipo: 'insitu', detalle: [], total: null };
      return pedirPlatos();
    }
    if (t === '2' || /navidad|diciembre|nochebuena|fecha|otra|reserv/.test(t)) return iniciarReservaFecha();
    return bot('Elige **1** para pedir a tu mesa, **2** para reservar o **3** para cotizar un banquete.');
  }

  function pedirPlatos(intro = '') {
    const prefijo = intro ? `${intro}\n\n` : '';
    const items = B.getCarrito();
    if (items.length) {
      sesion.estado = E.PEDIDO_CARRITO;
      return bot(`${prefijo}Veo que ya armaste tu pedido en la carta virtual:\n\n${B.lineasCarrito(items).join('\n')}\n\nTotal: S/ ${B.totalCarrito(items)}\n\n¿Confirmamos estos platos? Responde **si**, o **no** para indicar otros platos.`);
    }
    sesion.estado = E.PEDIDO_PLATOS;
    return bot(`${prefijo}🍴 ¿Qué platos deseas? Escríbelos con su cantidad, por ejemplo: "2 lomo saltado, 1/2 pollo a la leña y 1 chicha litro". Yo calculo el total.`);
  }

  function siguientePasoPedido() {
    if (sesion.ctx.tipo === 'insitu') {
      const mesa = B.mesaActual();
      if (mesa) {
        sesion.ctx.mesa = mesa;
        sesion.estado = E.PEDIDO_NOTAS;
        return bot(`Tu pedido va a la **Mesa ${mesa}**. ¿Alguna indicación especial (alergias, punto de cocción, celebración)? Escribe **no** si no tienes.`);
      }
      sesion.estado = E.PEDIDO_MESA;
      return bot('¿En qué número de mesa te encuentras?');
    }
    sesion.estado = E.PEDIDO_UBICACION;
    return bot('📍 ¿A dónde enviamos tu pedido? Comparte tu ubicación actual con GPS o escribe tu dirección en Chosica.');
  }

  const notasPedido = ({ marcas, extra, notas }) => [
    marcas && marcas.length ? `Bebida: ${marcas.join(', ')}` : '',
    extra ? `Pedido adicional: ${extra}` : '',
    notas || ''
  ].filter(Boolean).join(' · ');

  let enviandoCocina = false;

  /* En la casona el pedido entra directo a cocina, igual que por el QR de la mesa. */
  async function enviarPedidoMesa() {
    if (enviandoCocina) return;
    enviandoCocina = true;
    const { ctx } = sesion;
    const nombre = nombreCliente();
    const notas = notasPedido(ctx);
    try {
      const { pedido, seguimiento } = await B.enviarACocina({ mesa: ctx.mesa, cliente: nombre, items: ctx.items, notas });
      if (ctx.desdeCarrito) B.vaciarCarrito();
      B.guardarEnHistorial('pedido', { ticket: `#${pedido.numero}`, modalidad: 'En mesa', mesa: ctx.mesa, ubicacion: '', detalle: ctx.detalle, total: pedido.total, notas });
      bot([
        `✅ ¡Listo, ${nombre}! Tu pedido **#${pedido.numero}** ya llegó a cocina.`,
        `Mesa: ${B.numeroMesa(ctx.mesa)}`,
        ...ctx.detalle.map((linea) => `• ${linea}`),
        `Total: S/ ${pedido.total}`,
        notas ? `Notas: ${notas}` : ''
      ].filter(Boolean).join('\n'), { url: seguimiento, urlLabel: 'Ver mi pedido y pagar' });
      mostrarMenu();
    } catch {
      ctx.reintento = true;
      sesion.estado = E.PEDIDO_NOTAS;
      bot('No pudimos enviar tu pedido a cocina. Revisa tu conexión y responde **no** para reintentar, o avisa a tu mozo.');
    } finally {
      enviandoCocina = false;
    }
  }

  function resumenPedido() {
    const { ctx } = sesion;
    if (ctx.tipo === 'insitu') return enviarPedidoMesa();
    const nombre = nombreCliente();
    const modalidad = 'Delivery / Para llevar';
    const ticket = `BG-${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const notas = notasPedido(ctx);
    const datos = {
      ticket,
      modalidad,
      mesa: '',
      ubicacion: ctx.ubicacion || '',
      detalle: ctx.detalle,
      total: ctx.total,
      notas
    };

    B.guardarEnHistorial('pedido', datos);
    const url = B.waLink(B.textoPedido({ nombre, ...datos }));

    const resumen = [
      `✅ Pedido listo, ${nombre}. Ticket **${ticket}**`,
      `Modalidad: ${modalidad}`,
      `Entrega: ${ctx.ubicacion}`,
      'Platos:',
      ...ctx.detalle.map((linea) => `• ${linea}`),
      `Total: ${ctx.total != null ? `S/ ${ctx.total}` : 'se confirmará por WhatsApp'}`,
      notas ? `Notas: ${notas}` : ''
    ].filter(Boolean).join('\n');

    bot(`${resumen}\n\nPulsa el botón para enviar tu pedido a nuestro WhatsApp oficial.`, {
      url,
      urlLabel: '📲 Confirmar pedido por WhatsApp'
    });
    mostrarMenu();
  }

  function iniciarReservaFecha() {
    sesion.ctx = {};
    sesion.estado = E.RES_FECHA_DIA;
    return bot('¿Para qué día deseas tu reserva? Escríbelo como día/mes, por ejemplo **24/12**.');
  }

  function iniciarBanquete() {
    sesion.ctx = { banquete: true };
    sesion.estado = E.RES_FECHA_DIA;
    return bot('🥂 Preparamos un plato o menú personalizado para tu reunión o celebración. ¿Para qué día sería? Escríbelo como día/mes, por ejemplo **15/12**.');
  }

  function recibirPersonas(valor) {
    const n = parseInt(valor, 10);
    const maximo = sesion.ctx.banquete ? 300 : 30;
    if (!Number.isFinite(n) || n < 1 || n > maximo) {
      return bot(`Indícame un número de personas entre 1 y ${maximo}. Para grupos más grandes, escríbenos directamente por WhatsApp.`);
    }
    sesion.ctx.personas = n;
    sesion.estado = E.RES_FECHA_MOTIVO;
    if (sesion.ctx.banquete) return bot('📝 ¿Cuál es la ocasión y qué plato o menú imaginas? (por ejemplo: "cumpleaños, lomo saltado y postre para todos")');
    return bot('📝 ¿Cuál es el motivo de la reserva? (cumpleaños, almuerzo de trabajo, cena romántica…)');
  }

  function recibirHora(valor) {
    const hora = parsearHora(valor);
    if (!hora || !B.dentroDeHorario(hora)) {
      return bot('Indica una hora entre **8:30 AM** y **11:00 PM**, por ejemplo 20:00 o 8:00 pm.');
    }
    const ahora = B.ahoraLima();
    if (sesion.ctx.fecha === ahora.fecha && B.aMinutos(hora) < B.aMinutos(ahora.hora) + B.NEGOCIO.anticipacionReservaMin) {
      return bot('Las reservas se realizan con al menos **15 minutos** de anticipación. Indica una hora posterior.');
    }
    sesion.ctx.hora = hora;
    sesion.estado = E.RES_FECHA_PERSONAS;
    return bot(sesion.ctx.banquete ? '👥 ¿Cuántos invitados serán?' : '👥 ¿Cuántas personas serán?');
  }

  function recibirDia(valor) {
    const fecha = parsearFecha(valor);
    if (!fecha) {
      return bot('No logré leer la fecha. Escríbela como día/mes, por ejemplo **15/11** o **15/11/2026**.');
    }
    if (fecha < B.ahoraLima().fecha) return bot('Esa fecha ya pasó. Indica una fecha futura.');
    sesion.ctx.fecha = fecha;
    sesion.estado = E.RES_FECHA_HORA;
    return bot(`Anotado para el ${B.formatearFecha(fecha)}. ¿A qué hora llegarán? (por ejemplo, 13:00 o 1:30 pm)`);
  }

  function finalizarBanquete() {
    const { ctx } = sesion;
    const nombre = nombreCliente();
    B.guardarEnHistorial('reserva', { motivo: `Banquete (${ctx.ocasion})`, fecha: ctx.fecha, hora: ctx.hora, personas: ctx.personas });
    const url = B.waLink(B.textoBanquete({ nombre, ocasion: ctx.ocasion, fecha: ctx.fecha, hora: ctx.hora, personas: ctx.personas, zona: ctx.zona }));
    bot(`🥂 ¡Listo, ${nombre}! Tu solicitud de cotización quedó registrada:\n• Ocasión y menú: ${ctx.ocasion}\n• Fecha y hora: ${B.formatearFecha(ctx.fecha)} · ${ctx.hora}\n• Invitados: ${ctx.personas}\n• Ambiente: ${ctx.zona}\n\nEnvíala a nuestro WhatsApp para recibir tu cotización.`, {
      url,
      urlLabel: '📲 Solicitar cotización por WhatsApp'
    });
    mostrarMenu();
  }

  function finalizarReserva() {
    const { ctx } = sesion;
    const nombre = nombreCliente();
    const datos = {
      motivo: ctx.motivo,
      fecha: ctx.fecha,
      hora: ctx.hora,
      personas: ctx.personas,
      zona: ctx.zona || ''
    };

    B.guardarEnHistorial('reserva', datos);
    const url = B.waLink(B.textoReserva({ nombre, ...datos }));

    const lineas = [
      `🎉 ¡Listo, ${nombre}! Tu solicitud de reserva quedó registrada:`,
      `• Motivo: ${datos.motivo}`,
      `• Fecha y hora: ${B.formatearFecha(datos.fecha)} · ${datos.hora}`,
      `• Personas: ${datos.personas}`
    ];
    if (datos.zona) lineas.push(`• Ambiente: ${datos.zona}`);
    lineas.push('', 'Confirma tu reserva enviando el mensaje a nuestro WhatsApp.');

    bot(lineas.join('\n'), { url, urlLabel: '📲 Confirmar reserva por WhatsApp' });
    mostrarMenu();
  }

  /* ---------- Manejadores por estado ---------- */
  function esperaSi(t) {
    if (t !== 'si') {
      return bot('Para empezar, responde **si**. Luego tomo tu pedido, tu reserva o tu duda.');
    }
    const activo = cliente();
    if (activo) {
      bot(`¡Qué alegría tenerte de vuelta en casa, ${activo.nombre}! Como cliente frecuente de Borgorosso, tenemos registrada tu preferencia para brindarte una atención especial.`);
      return mostrarMenu();
    }
    sesion.estado = E.NOMBRE;
    return bot('¿Con quién tengo el gusto hoy?');
  }

  function recibirNombre(valor) {
    if (B.claveCliente(valor).length < 2) {
      return bot('¿Me regalas tu nombre para registrarte? (por ejemplo, "María")');
    }
    const { cliente: c, nuevo } = B.identificarCliente(valor);
    bot(nuevo
      ? `¡Un gusto, ${c.nombre}! Tu preferencia quedó registrada en nuestra casa.`
      : `¡Qué alegría tenerte de vuelta, ${c.nombre}! Como cliente frecuente de Borgorosso, tenemos registrada tu preferencia para brindarte una atención especial.`);
    return mostrarMenu();
  }

  function elegirMenu(t) {
    if (t === '1') return iniciarDelivery();
    if (t === '2') return menuMesaReserva();
    if (t === '3') return mostrarFaq();
    if (t === '4' || /otra persona|cambiar/.test(t)) {
      B.cerrarSesionCliente();
      sesion.estado = E.NOMBRE;
      return bot('Con gusto. ¿Con quién tengo el gusto hoy?');
    }
    if (/banquete|cotiz/.test(t)) return iniciarBanquete();
    if (/reserv/.test(t)) return menuMesaReserva();
    /* Quien pide algo no busca información, aunque mencione "comida" o "ubicación". */
    if (/quiero|deseo|quisiera/.test(t) && /delivery|llevar|domicilio/.test(t)) return iniciarDelivery();
    if (/quiero|deseo|quisiera/.test(t) && /pedir|ordenar/.test(t)) return iniciarPedido();
    const faq = detectarFaq(t);
    if (faq) return responderFaq(faq);
    if (/delivery|llevar|domicilio/.test(t)) return iniciarDelivery();
    if (/mesa|situ/.test(t)) return menuMesaReserva();
    if (/pedido|pedir|comer|ordenar/.test(t)) return iniciarPedido();
    if (/pregunta|duda|faq|consulta/.test(t)) return mostrarFaq();
    return bot('Elige una opción del 1 al 4, o escríbeme tu duda (por ejemplo: "¿aceptan Yape?").');
  }

  function elegirModalidad(t) {
    if (t === '1' || /local|situ|comer|casona|mesa/.test(t)) {
      sesion.ctx.tipo = 'insitu';
      return pedirPlatos();
    }
    if (t === '2' || /delivery|llevar|domicilio/.test(t)) {
      if (!B.deliveryDisponible()) {
        return bot('Lo sentimos, los pedidos por Delivery salen a partir de las 12:00 PM. Puedes elegir la opción **1** para disfrutar en la casona, o escribe **menú** para volver.');
      }
      sesion.ctx.tipo = 'delivery';
      return pedirPlatos();
    }
    return bot('Responde **1** (en la casona) o **2** (delivery / para llevar).');
  }

  function confirmarCarrito(t, valor) {
    if (t === 'si') {
      const items = B.getCarrito();
      sesion.ctx.detalle = B.lineasCarrito(items);
      sesion.ctx.total = B.totalCarrito(items);
      sesion.ctx.items = items;
      sesion.ctx.desdeCarrito = true;
      return siguientePasoPedido();
    }
    if (t === 'no') {
      sesion.estado = E.PEDIDO_PLATOS;
      return bot('Entendido. Escribe los platos que deseas, con su cantidad.');
    }
    return recibirPlatos(valor);
  }

  /* Reconoce platos de la carta, calcula el total y guarda lo no reconocido como nota. */
  function recibirPlatos(valor) {
    const { encontrados, sobrante } = interpretarPlatos(valor);
    if (!encontrados.length) {
      /* Cocina solo recibe platos de la carta, con su precio oficial. */
      if (sesion.ctx.tipo === 'insitu') {
        return bot('No identifiqué esos platos en la carta. Escríbelos como aparecen, por ejemplo "2 lomo saltado y 1 chicha vaso".');
      }
      sesion.ctx.detalle = [valor];
      sesion.ctx.total = null;
      bot('No identifiqué platos exactos de la carta, así que enviaré tu pedido tal cual y te confirmaremos el total por WhatsApp.');
      return siguientePasoPedido();
    }
    sesion.ctx.detalle = encontrados.map(lineaPlato);
    sesion.ctx.total = encontrados.reduce((suma, i) => suma + i.precio * i.cantidad, 0);
    sesion.ctx.extra = sobrante;
    sesion.ctx.items = encontrados.map((i) => ({ ...i, variante: i.varianteCarta }));
    sesion.ctx.marcas = encontrados.filter((i) => i.variante !== i.varianteCarta).map((i) => `${i.cantidad} ${i.variante}`);
    const aviso = sobrante ? `\n\nNo reconocí «${sobrante}»; lo añadiré como nota para cocina.` : '';
    bot(`🧾 Anoté tu pedido:\n\n${sesion.ctx.detalle.map((l) => `• ${l}`).join('\n')}\n\nTotal: **S/ ${sesion.ctx.total}**${aviso}`);
    return siguientePasoPedido();
  }

  function recibirMesa(valor) {
    if (!B.numeroMesa(valor)) return bot('Indícame solo el número de tu mesa, por ejemplo **5**.');
    sesion.ctx.mesa = valor;
    sesion.estado = E.PEDIDO_NOTAS;
    return bot('¿Alguna indicación especial (alergias, punto de cocción, celebración)? Escribe **no** si no tienes comentarios.');
  }

  function recibirUbicacion(valor) {
    if (valor === GPS) {
      return B.obtenerUbicacion()
        .then((u) => {
          sesion.ctx.ubicacion = `Ubicación GPS: ${u.url}`;
          sesion.estado = E.PEDIDO_NOTAS;
          bot(`Ubicación recibida ✔ (${u.lat}, ${u.lng}). ¿Alguna referencia para el repartidor (piso, portón, color de casa)? Escribe **no** si no tienes.`, {
            url: u.url,
            urlLabel: 'Ver en Google Maps'
          });
        })
        .catch((err) => bot(`${err.message} También puedes escribir tu dirección en Chosica.`));
    }
    if (valor.length < 6) return bot('Por favor indica tu dirección completa (calle, número y referencia).');
    sesion.ctx.ubicacion = `Dirección: ${valor}`;
    sesion.estado = E.PEDIDO_NOTAS;
    return bot('¿Alguna referencia para el repartidor (piso, portón, color de casa)? Escribe **no** si no tienes.');
  }

  function recibirNotas(t, valor) {
    if (sesion.ctx.reintento && t === 'no') return resumenPedido();
    sesion.ctx.notas =/^(no|ninguna|ninguno|sin comentarios)$/.test(t) ? '' : valor;
    return resumenPedido();
  }

  function recibirZona(t) {
    const id = parsearZona(t);
    if (!id) {
      return bot('Elige un ambiente: **1** Salón o **2** Terraza.');
    }
    sesion.ctx.zona = B.ZONAS.find((z) => z.id === id).nombre;
    return sesion.ctx.banquete ? finalizarBanquete() : finalizarReserva();
  }

  function recibirMotivo(valor) {
    if (sesion.ctx.banquete) sesion.ctx.ocasion = valor;
    else sesion.ctx.motivo = `${B.esTemporadaNavidad(sesion.ctx.fecha) ? B.MOTIVOS.navidad : B.MOTIVOS.regular} (${valor})`;
    sesion.estado = E.RES_EVT_ZONA;
    return bot('🌿 ¿Qué ambiente de la casona prefieres?');
  }

  /* ---------- Despachador ---------- */
  function manejar(valorRaw, etiqueta) {
    const valor = String(valorRaw ?? '').trim();
    if (!valor) return;
    usuario(etiqueta ?? valor);

    const t = B.normalizar(valor);
    const { estado } = sesion;

    if (estado !== E.ESPERA_SI && estado !== E.NOMBRE) {
      if (t === 'menu' || t === 'inicio') return cliente() ? mostrarMenu() : reiniciarFlujo();
      if (t === 'cancelar') return reiniciarFlujo();
    }

    switch (estado) {
      case E.ESPERA_SI: return esperaSi(t);
      case E.NOMBRE: return recibirNombre(valor);
      case E.MENU: return elegirMenu(t);
      case E.FAQ: return elegirFaq(t);
      case E.MESA_O_RESERVA: return elegirMesaReserva(t);
      case E.PEDIDO_MODALIDAD: return elegirModalidad(t);
      case E.PEDIDO_CARRITO: return confirmarCarrito(t, valor);
      case E.PEDIDO_PLATOS: return recibirPlatos(valor);
      case E.PEDIDO_MESA: return recibirMesa(valor);
      case E.PEDIDO_UBICACION: return recibirUbicacion(valor);
      case E.PEDIDO_NOTAS: return recibirNotas(t, valor);
      case E.RES_FECHA_PERSONAS: return recibirPersonas(valor);
      case E.RES_FECHA_HORA: return recibirHora(valor);
      case E.RES_EVT_ZONA: return recibirZona(t);
      case E.RES_FECHA_DIA: return recibirDia(valor);
      case E.RES_FECHA_MOTIVO: return recibirMotivo(valor);
      default: return cliente() ? mostrarMenu() : reiniciarFlujo();
    }
  }

  /* ---------- Apertura y cierre del panel ---------- */
  /* Burbuja de invitación junto al botón (no aparece en la carta, donde manda la comanda). */
  const invitacion = widget.querySelector('.bg-chat-invitacion');
  const CLAVE_INVITACION = 'borgorosso_invitacion_cerrada';

  function ocultarInvitacion(recordar) {
    invitacion.hidden = true;
    if (!recordar) return;
    try { sessionStorage.setItem(CLAVE_INVITACION, '1'); } catch { /* sin almacenamiento */ }
  }

  function mostrarInvitacion() {
    let cerrada = false;
    try { cerrada = sessionStorage.getItem(CLAVE_INVITACION) === '1'; } catch { /* sin almacenamiento */ }
    if (cerrada || panel.classList.contains('is-open') || document.body.classList.contains('pagina-carta')) return;
    invitacion.querySelector('p').textContent = B.eventoVigente()
      ? '¿Buscas mesa para Navidad o pedir Delivery? ¡Escríbeme!'
      : '¿Buscas mesa o pedir delivery? ¡Escríbeme!';
    invitacion.hidden = false;
    /* Se retira sola para no tapar contenido en pantallas pequeñas. */
    setTimeout(() => ocultarInvitacion(false), 12000);
  }

  invitacion.addEventListener('click', (e) => {
    if (e.target.closest('.bg-chat-invitacion__cerrar')) {
      ocultarInvitacion(true);
      return;
    }
    alternar(true);
  });
  setTimeout(mostrarInvitacion, 1800);

  /* En el teléfono el asistente ocupa la pantalla y se ajusta al teclado (visualViewport). */
  const esTactil = window.matchMedia('(pointer: coarse)');
  function ajustarAlTeclado() {
    const vv = window.visualViewport;
    if (!vv) return;
    widget.style.setProperty('--chat-alto', `${Math.round(vv.height)}px`);
    widget.style.setProperty('--chat-arriba', `${Math.round(vv.offsetTop)}px`);
    msgs.scrollTop = msgs.scrollHeight;
  }
  window.visualViewport?.addEventListener('resize', ajustarAlTeclado);
  window.visualViewport?.addEventListener('scroll', ajustarAlTeclado);

  function alternar(forzar) {
    const abrir = typeof forzar === 'boolean' ? forzar : !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', abrir);
    widget.classList.toggle('is-abierto', abrir);
    document.documentElement.classList.toggle('chat-abierto', abrir);
    fab.setAttribute('aria-expanded', String(abrir));
    if (abrir) {
      ocultarInvitacion(false);
      ajustarAlTeclado();
      if (!sesion.mensajes.length) bot(bienvenida());
      /* En pantallas táctiles no se abre el teclado solo: taparía los mensajes. */
      if (!esTactil.matches) input.focus();
    }
  }

  fab.addEventListener('click', () => alternar());
  widget.querySelector('[data-chat-cerrar]').addEventListener('click', () => alternar(false));

  /* El panel no queda abierto tapando la página: se cierra al tocar fuera o con Escape.
     composedPath conserva el recorrido aunque el chip pulsado ya se haya quitado del DOM. */
  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('is-open')) return;
    const recorrido = e.composedPath();
    const dentro = recorrido.includes(widget) || recorrido.some((el) => el.matches?.('[data-chat-open]'));
    if (!dentro) alternar(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('is-open')) alternar(false);
  });
  widget.querySelector('[data-chat-menu]').addEventListener('click', () => manejar('menu', 'Menú'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const valor = input.value;
    input.value = '';
    manejar(valor);
  });

  document.querySelectorAll('[data-chat-open]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      alternar(true);
    })
  );

  renderizarTodo();

  window.BorgoChat = {
    abrir: () => alternar(true),
    cerrar: () => alternar(false),
    reiniciar: () => {
      sesion = { version: VERSION_CHAT, estado: E.ESPERA_SI, ctx: {}, mensajes: [] };
      guardarSesion();
      renderizarTodo();
    }
  };
})();
