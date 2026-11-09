// "Cloud Storage falso" para pruebas locales: guarda los archivos subidos en
// una carpeta del sandbox y devuelve una URL servible por el propio servidor
// de pruebas (ver server.js: ruta GET /fake-storage/*). En producción el
// adaptador usa el SDK oficial de Firebase Storage — este archivo no se usa
// fuera de las pruebas.
const fs = require('fs');
const path = require('path');

function crearStorageFalso({ carpeta, urlBase }) {
  fs.mkdirSync(carpeta, { recursive: true });

  class ArchivoFalso {
    constructor(rutaInterna) {
      this.rutaInterna = rutaInterna;
    }
    _rutaDisco() {
      return path.join(carpeta, this.rutaInterna.replace(/\//g, '__'));
    }
    async save(buffer, _opts) {
      fs.writeFileSync(this._rutaDisco(), buffer);
    }
    async delete() {
      try {
        fs.unlinkSync(this._rutaDisco());
      } catch (e) {
        // ya no existía, no es un error real en las pruebas
      }
    }
    // Mismo nombre de método "url()" que tendrá el envoltorio real de Cloud
    // Storage (ver db/storage.js) — así db/storage.js no necesita saber si
    // está hablando con el storage falso o con el real.
    url() {
      return `${urlBase}/${encodeURIComponent(this.rutaInterna)}`;
    }
  }

  const bucket = {
    file(rutaInterna) {
      return new ArchivoFalso(rutaInterna);
    },
  };

  // Para que server.js pueda servir el archivo de vuelta al navegador cuando
  // llega una petición a /fake-storage/<rutaInterna codificada>.
  function leerPorUrl(rutaInterna) {
    const rutaDisco = path.join(carpeta, rutaInterna.replace(/\//g, '__'));
    return fs.existsSync(rutaDisco) ? fs.readFileSync(rutaDisco) : null;
  }

  return { bucket, leerPorUrl };
}

module.exports = { crearStorageFalso };
