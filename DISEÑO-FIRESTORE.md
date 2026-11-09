# Diseño de datos en Firestore — migración desde SQL

## Decisión: el taller mecánico pierde la carga de fotos en esta versión

Para no aumentar el uso de almacenamiento en Firebase, se decidió que en la
versión migrada **el taller mecánico ya no tiene carga de fotos** (ni de
ingreso ni de entrega) — mantiene todos sus demás datos (dueño, vehículo,
presupuesto, trabajos realizados, cobro final) y el PDF de entrega, solo que
ese PDF ya no incluye fotos. La carga de fotos queda exclusivamente para los
repuestos de inventario. Esto solo aplica a la versión en Firebase — el
sistema actual en Windows no se toca y sigue con fotos en el taller.

Por eso la colección `taller_ordenes/{id}/fotos` de la primera versión de este
documento se elimina del diseño (ver más abajo).

## Hallazgo importante: las fotos de inventario no pueden ir dentro de los documentos

Firestore tiene un límite duro de **1 MiB por documento**. Hoy, cada foto de
repuesto se guarda como texto base64 de hasta 1.5 MB, y hay repuestos con 3
fotos (hasta ~4.5 MB). Esa fila no entraría en un documento de Firestore.

Por eso las fotos de inventario se mueven a **Cloud Storage for Firebase**
(almacenamiento de archivos, parte del mismo proyecto y con capa gratuita
propia: 5GB guardados y 1GB/día de descarga gratis). El documento de
Firestore guarda solo la URL del archivo en vez del base64 completo.

Esto casi no afecta al frontend: hoy el navegador comprime la foto y la manda
como data URL al servidor (eso no cambia); lo que cambia es que el servidor,
en vez de guardar ese texto en la base de datos, lo sube a Cloud Storage y
guarda la URL resultante. Como un `<img src="...">` funciona igual con una
data URL o con una URL normal, la pantalla no necesita cambios.

Afecta solo a: `inventario.foto_1/2/3`.

## Reglas generales de diseño

- **Multi-negocio como aislamiento real**: casi todo vive bajo
  `/negocios/{negocioId}/...` como subcolección. Así, las reglas de seguridad
  de Firestore pueden bloquear por estructura (un negocio físicamente no
  puede leer la subcolección de otro) en vez de confiar en que cada consulta
  se acuerde de filtrar por `negocio_id` — hoy ese es el principal riesgo del
  sistema actual si alguien olvida el filtro en una consulta nueva.
- **IDs de documento = IDs correlativos** donde ya existían (`numero` de
  vehículo, de orden de taller, de compra de bodega) para que las pantallas
  y el PDF sigan mostrando "Vehículo 3", "Orden 12", etc. sin cambios.
- **Sin JOIN → se duplica lo mínimo necesario para mostrar en pantalla**
  (ej: el nombre del repuesto ya vive en `venta_items`, así que ahí no cambia
  nada; donde antes un JOIN traía un dato de otra tabla, ahora ese dato se
  copia al escribir, igual que ya hace `auditoria.usuario_nombre`).
- **Reportes con SUM/COUNT**: Firestore no tiene agregación tipo SQL con
  filtros libres. Para los reportes del dashboard, en vez de sumar en cada
  consulta, se mantienen contadores ya calculados en el documento del negocio
  (`/negocios/{id}`: `stock_valor_total`, `costo_total_vehiculos`, etc.) que
  se actualizan con cada venta/ingreso via una transacción — así el dashboard
  es una sola lectura en vez de recorrer todo el inventario cada vez que se
  abre.

## Colecciones

```
/negocios/{negocioId}
    nombre, rut, telefono_dueno, email_contacto, direccion, plan, activo,
    creado_en
    + contadores: costo_total_vehiculos, valor_motor_referencia_total,
      stock_valor_total (repuestos activos * precio_venta, vehículo+bodega)

/usuarios/{usuario}            <- doc id = el nombre de usuario (único), para
    negocio_id                   loguearse con un solo get(), sin consultas
    nombre, password_hash, salt, rol, activo, debe_cambiar_password,
    password_plana, intentos_ver_password, bloqueado_ver_password, creado_en

/sesiones/{token}               <- doc id = el token (igual que hoy)
    usuario (username), creado_en, expira_en

/config_app/{clave}             <- doc id = la clave (igual que hoy)
    valor

/negocios/{negocioId}/vehiculos/{numero}
    patente, marca, modelo, anio, color, kilometraje, estado, origen,
    observaciones, costo_compra, valor_motor_referencia, fecha_ingreso

/negocios/{negocioId}/inventario/{id autogenerado}
    vehiculo_numero (o null), codigo, nombre, categoria, cantidad_disponible,
    cantidad_minima, precio_venta, costo_unitario, ubicacion, fecha_ingreso,
    activo, foto_1_url, foto_2_url, foto_3_url

/negocios/{negocioId}/repisas/{id}
/negocios/{negocioId}/catalogo_repuestos/{id}
/negocios/{negocioId}/compras_bodega/{numero}
/negocios/{negocioId}/inventario_bodega/{id}
    (mismos campos que hoy, repisa_id/compra_id pasan a ser el id del
    documento referenciado dentro del mismo negocio)

/negocios/{negocioId}/ventas/{id autogenerado}
    usuario (username), fecha, total, tipo_pago, cliente_nombre,
    cliente_telefono, estado, notificacion_whatsapp_estado,
    items: [ { origen, inventario_ref, nombre_repuesto, categoria,
               cantidad, precio_unitario } ]   <- array embebido, ya no es
                                                   una subcolección aparte,
                                                   porque siempre se lee/
                                                   escribe junto a la venta

/negocios/{negocioId}/taller_ordenes/{numero}
    dueno_nombre, dueno_telefono, dueno_rut, vehiculo_patente/marca/modelo/
    anio/color, comentario_ingreso, presupuesto_monto, presupuesto_notas,
    trabajos_realizados, cobro_final, estado, fecha_ingreso, fecha_entrega
    (sin fotos ni subcolección — decisión tomada para no usar espacio de
    Firebase; el PDF de entrega queda solo con texto)

/chats/{negocioAId_negocioBId}       <- doc id = "1_2" (ids ordenados) para
    negocio_a_id, negocio_b_id,        encontrar la conversación sin índice
    creado_en, ultimo_mensaje_en
    /mensajes/{id autogenerado}
        negocio_emisor_id, usuario, mensaje, enviado_en, leido

/negocios/{negocioId}/auditoria/{id autogenerado}
    usuario, rol, accion, entidad_tipo, entidad_id, detalle, fecha
```

## Cómo se prueba sin el proyecto real todavía

El emulador oficial de Firestore (el .jar de Google) no se puede descargar
desde este entorno de pruebas por una restricción de red del sandbox
(`storage.googleapis.com` está bloqueado aquí). Para no frenar el desarrollo,
se construye un "Firestore falso" en memoria (mismo método `.collection()`,
`.doc()`, `.get()`, `.set()`, `.where()`, transacciones) que se usa solo en
estas pruebas locales. El código del adaptador real (`firestore-adapter.js`)
usa el SDK oficial `firebase-admin` tal cual se usará en producción — lo único
que cambia entre pruebas y producción es qué objeto de conexión se le inyecta.
Antes de la entrega final se vuelve a probar contra el proyecto real (con el
emulador de Google, que si corre en tu computador, o directo contra Firestore
real en modo de prueba) para confirmar que no quedó ninguna diferencia de
comportamiento.
