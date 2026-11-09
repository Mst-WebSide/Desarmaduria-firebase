// Envoltorio sobre el SDK real de Firebase/Cloud Storage para que presente
// exactamente la misma forma que espera db/storage.js:
//   storage.bucket.file(rutaInterna) -> { save(buffer, opts), delete(), url() }
// (ver test-doubles/fake-storage.js para la versión usada en las pruebas).
// El SDK real ya tiene .file().save()/.delete(), pero no tiene url() — las
// fotos de repuestos no son datos sensibles (ver DISEÑO-FIRESTORE.md), así
// que al subir una foto se hace pública y se devuelve su URL pública fija de
// Cloud Storage en vez de generar una URL firmada que expira.
function crearStorageReal(bucket) {
  return {
    bucket: {
      file(rutaInterna) {
        const archivo = bucket.file(rutaInterna);
        return {
          async save(buffer, opts) {
            await archivo.save(buffer, opts);
            await archivo.makePublic();
          },
          async delete() {
            try {
              await archivo.delete();
            } catch (e) {
              // ya no existía, no es un error real
            }
          },
          url() {
            return `https://storage.googleapis.com/${bucket.name}/${rutaInterna}`;
          },
        };
      },
    },
  };
}

module.exports = { crearStorageReal };
