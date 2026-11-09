// Notificación de venta al dueño del negocio, por WhatsApp.
//
// TODAVÍA NO ESTÁ CONECTADA A NINGÚN PROVEEDOR — quedó pendiente a propósito
// hasta que decidas entre la API oficial de Meta (WhatsApp Cloud API,
// gratis dentro de límites, requiere verificar un número en Meta Business)
// o Twilio (de pago, onboarding más simple, tiene sandbox gratis). Ver
// README.md, sección "Conectar el aviso de WhatsApp".
//
// Mientras tanto, esta función simula el envío: deja constancia en el log
// del servidor y en la propia venta (columna notificacion_whatsapp_estado)
// para que quede claro qué se habría mandado, sin romper el resto del
// sistema. Cuando definas el proveedor, esta es la ÚNICA función que hay
// que completar — el resto del código (POST /api/ventas en server.js) ya
// la llama con todos los datos que necesita.
async function notificarVenta({ negocio, venta, items, vendedor }) {
  const proveedor = process.env.WHATSAPP_PROVEEDOR;

  const resumenItems = items.map((it) => `• ${it.cantidad} × ${it.nombre_repuesto} — $${it.precio_unitario * it.cantidad}`).join('\n');
  const mensaje =
    `🧾 Nueva venta en ${negocio.nombre}\n` +
    `Total: $${venta.total} (${venta.tipo_pago})\n` +
    `Vendedor: ${vendedor.nombre}\n` +
    (venta.cliente_nombre ? `Cliente: ${venta.cliente_nombre}\n` : '') +
    `${resumenItems}`;

  if (!proveedor) {
    console.log(`[notificaciones] WhatsApp no configurado todavía. Mensaje que se habría enviado a ${negocio.telefono_dueno || '(sin teléfono configurado)'}:\n${mensaje}`);
    return 'no_configurado';
  }

  try {
    if (proveedor === 'meta') {
      // TODO: cuando tengas WHATSAPP_TOKEN y WHATSAPP_TELEFONO_ID (ver .env.example),
      // reemplazar esto por un fetch a la API de Meta:
      //
      // await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_TELEFONO_ID}/messages`, {
      //   method: 'POST',
      //   headers: {
      //     Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify({
      //     messaging_product: 'whatsapp',
      //     to: negocio.telefono_dueno,
      //     type: 'text',
      //     text: { body: mensaje },
      //   }),
      // });
      console.log('[notificaciones] Proveedor "meta" configurado pero la llamada real todavía no está implementada.');
      return 'pendiente';
    }
    if (proveedor === 'twilio') {
      // TODO: igual que arriba, pero con el SDK o la API REST de Twilio
      // (requiere WHATSAPP_TOKEN con las credenciales de Twilio).
      console.log('[notificaciones] Proveedor "twilio" configurado pero la llamada real todavía no está implementada.');
      return 'pendiente';
    }
    console.log(`[notificaciones] Proveedor "${proveedor}" no reconocido.`);
    return 'no_configurado';
  } catch (e) {
    console.error('[notificaciones] Error enviando WhatsApp:', e.message);
    return 'error';
  }
}

module.exports = { notificarVenta };
