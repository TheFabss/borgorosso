# Beta Borgorosso: pruebas antes de presentar

Web publicada: **https://thefabss.github.io/borgorosso/** (dirección fija, no depende de la laptop).

Número de WhatsApp de la web: **+51 973 548 429** (celular de empresa).

## Cómo funciona WhatsApp en esta beta

La web no envía mensajes por su cuenta. El cliente arma su pedido, reserva o cotización en la web o con el asistente, y al final pulsa un botón que abre WhatsApp con el mensaje ya escrito hacia +51 973 548 429. El cliente solo pulsa **Enviar**, y una persona del restaurante responde desde ese celular.

Los pedidos **en mesa** no pasan por WhatsApp: van directo a la pantalla de cocina.

## Antes de la presentación

- [ ] El celular +51 973 548 429 tiene WhatsApp o WhatsApp Business activo y con internet.
- [ ] Probar siempre desde la web publicada, no desde Live Server ni abriendo el archivo.
- [ ] Cocina abierta en una laptop o tablet, con sesión iniciada.
- [ ] Los 5 QR impresos desde https://thefabss.github.io/borgorosso/mesas-qr.html

## Pruebas desde otro celular (el del cliente)

Usa un celular distinto al de empresa: WhatsApp no deja escribirse a uno mismo.

| # | Prueba | Dónde | Resultado esperado |
|---|---|---|---|
| 1 | Pulsar **Escribir por WhatsApp** | Inicio, sección Contacto | Abre el chat con +51 973 548 429 y el texto "¡Hola Borgorosso! Quisiera información sobre la casona." |
| 2 | Reservar una mesa normal | Inicio, botón **Reservar mesa** | Llega el mensaje "RESERVA DE MESA" con fecha, hora, personas y zona. Sin platos. |
| 3 | Reservar mesa de Navidad | Inicio, **Reserva tu mesa de Navidad** (tema Navidad) | Motivo "Temporada de Navidad" y solo fechas de diciembre. |
| 4 | Cotizar banquete | Inicio, **Cotizar cena de fin de año** | Mensaje "COTIZACIÓN DE BANQUETE" con invitados, ocasión y menú. |
| 5 | Reservar desde la carta | Carta, botón **Reservar** junto a Mi pedido | Abre el mismo formulario de reserva, sin comida. |
| 6 | Pedido delivery | Carta, Mi pedido, **Delivery** (desde las 12:00 PM) | Mensaje "PEDIDO" con platos, total y dirección o enlace de GPS. |
| 7 | Pedido por el asistente | Asistente, responder `si`, nombre, `1`, platos, dirección | Mensaje con el pedido y el total calculado. |
| 8 | Pregunta sin respuesta | Asistente, opción `3`, preguntar "¿hacen descuentos?" | Ofrece el botón **Escribir por WhatsApp**. |
| 9 | Pedido en mesa | Escanear QR de Mesa 1 | Abre la carta con "Estás en la Mesa 1". Al pedir no pregunta la mesa, el pedido aparece en cocina sin recargar y **no** abre WhatsApp. |

Si un botón no abre WhatsApp en iPhone, revisa que Safari no esté bloqueando ventanas emergentes (Ajustes, Safari, Bloquear ventanas). El botón verde de la pantalla de confirmación sirve de respaldo.

## Textos sugeridos para WhatsApp Business (celular de empresa)

Configúralos en WhatsApp Business, Herramientas para la empresa.

**Mensaje de bienvenida**
> ¡Hola! Bienvenido a Borgorosso, casona galería en Chosica. Atendemos todos los días de 8:30 AM a 11:00 PM y el delivery sale desde las 12:00 PM. Cuéntanos en qué te ayudamos.

**Mensaje de ausencia** (fuera de horario)
> Gracias por escribir a Borgorosso. En este momento estamos cerrados; te respondemos desde las 8:30 AM. Si es una reserva, ya quedó registrada tu solicitud.

**Respuestas rápidas**
- `/reserva`: ¡Gracias! Tu reserva quedó confirmada. Te esperamos en Jr. Cuzco 166-366, Chosica. Si cambian tus planes, avísanos por aquí.
- `/pedido`: ¡Recibido! Tu pedido ya está en cocina. Te avisamos cuando salga.
- `/banquete`: Gracias por pensar en Borgorosso para tu celebración. Te enviamos la cotización en breve.

## Después de la presentación

- Borrar los pedidos de prueba en Supabase (SQL Editor): `delete from public.pedidos where creado > now() - interval '1 day';` (revisa antes que no haya pedidos reales).
- Antes de abrir al público: eliminar el pago simulado con `drop function public.pagar_en_linea_demo(uuid[]);`.

## Bot de WhatsApp (respuestas automáticas)

El bot vive en `C:\proyectos\borgorosso-bot`, fuera de este repositorio. Para que conteste solo:

1. En la laptop: `cd C:\proyectos\borgorosso-bot` y `npm start`.
2. La primera vez, escanea el QR con el celular de pruebas (WhatsApp > Dispositivos vinculados).
3. Espera **Bot de Borgorosso listo** y deja la laptop encendida con internet durante la demo.

Responde a pedidos, reservas y cotizaciones que envía la web, y manda las comandas a "Mensaje a ti mismo"
del celular de pruebas. Los detalles están en el `LEEME.md` del bot.
