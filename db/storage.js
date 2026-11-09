// Envoltorio sobre Cloud Storage (o el storage falso de pruebas, ver
// test-doubles/fake-storage.js) para subir las fotos de inventario. El
// objeto "storage" que se inyecta en iniciar() debe exponer
// storage.bucket.file(rutaInterna) -> { save(buffer, opts), delete(), url() }
// — tanto el falso como el real (test-doubles/fake-storage.js y, en
// producción, un envoltorio fino sobre admin.storage()) cumplen esa misma
// forma, así que este archivo nunca necesita saber cuál de los dos está
// corriendo.
function partesDeDataUrl(dataUrl) {
  const coma = dataUrl.indexOf(',');
  if (coma === -1 || !dataUrl.startsWith('data:')) return null;
  const tipo = dataUrl.slice(5, dataUrl.indexOf(';'));
  const buffer = Buffer.from(dataUrl.slice(coma + 1), 'base64');
  return { tipo, buffer };
}

function crearStorageDb(storage) {
  return {
    // Sube una foto (si dataUrl viene vacío, no hace nada y devuelve null —
    // "sin foto" sigue siendo válido, igual que en la versión SQL).
    async subirFoto(rutaInterna, dataUrl) {
      if (!dataUrl) return null;
      const partes = partesDeDataUrl(dataUrl);
      if (!partes) throw new Error('La foto no es una imagen válida');
      const archivo = storage.bucket.file(rutaInterna);
      await archivo.save(partes.buffer, { contentType: partes.tipo });
      return archivo.url();
    },

    async borrarFoto(rutaInterna) {
      try {
        await storage.bucket.file(rutaInterna).delete();
      } catch (e) {
        // si ya no existía, no es un error real
      }
    },
  };
}

module.exports = { crearStorageDb };
