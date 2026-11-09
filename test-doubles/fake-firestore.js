// "Firestore falso" en memoria, SOLO para poder desarrollar y probar el
// adaptador sin depender del emulador oficial de Google (bloqueado por la
// política de red de este sandbox de pruebas — ver DISEÑO-FIRESTORE.md).
//
// Implementa el mismo subconjunto de la API de firebase-admin que usa
// firestore-adapter.js: collection/doc/get/set/update/delete/where/orderBy/
// limit/add, runTransaction, y FieldValue.increment. El adaptador real usa
// el SDK oficial — este archivo nunca se usa en producción.
const crypto = require('crypto');

function clonar(valor) {
  return valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));
}

class IncrementoMarcador {
  constructor(delta) {
    this.delta = delta;
  }
}

const FieldValue = {
  increment(delta) {
    return new IncrementoMarcador(delta);
  },
};

function aplicarValor(valorActual, valorNuevo) {
  if (valorNuevo instanceof IncrementoMarcador) {
    return (Number(valorActual) || 0) + valorNuevo.delta;
  }
  return clonar(valorNuevo);
}

function fusionar(destino, cambios) {
  const resultado = { ...destino };
  for (const [clave, valor] of Object.entries(cambios)) {
    resultado[clave] = aplicarValor(destino ? destino[clave] : undefined, valor);
  }
  return resultado;
}

class DocSnapshot {
  constructor(id, datos, ref) {
    this.id = id;
    this.ref = ref;
    this._datos = datos;
    this.exists = datos !== undefined && datos !== null;
  }
  data() {
    return this.exists ? clonar(this._datos) : undefined;
  }
  get(campo) {
    return this.exists ? this._datos[campo] : undefined;
  }
}

class DocRef {
  // "path" es la ruta COMPLETA del documento (ej. "negocios/1/inventario/abc").
  // Con eso basta para derivar .parent (y el .parent.parent.id de más abajo,
  // igual que en el SDK real) sin tener que encadenar objetos padre a mano.
  constructor(store, path) {
    this.store = store;
    this.path = path;
    const segs = path.split('/');
    this.id = segs[segs.length - 1];
  }
  get parent() {
    const segs = this.path.split('/');
    return new CollectionRef(this.store, segs.slice(0, -1).join('/'));
  }
  async get() {
    const datos = this.store.leer(this.path);
    return new DocSnapshot(this.id, datos, this);
  }
  async set(datos, opts = {}) {
    const actual = this.store.leer(this.path);
    const final = opts.merge ? fusionar(actual || {}, datos) : clonar(datos);
    this.store.escribir(this.path, final);
    return {};
  }
  async update(cambios) {
    const actual = this.store.leer(this.path);
    if (actual === undefined) throw new Error(`No existe el documento ${this.path} para actualizar`);
    this.store.escribir(this.path, fusionar(actual, cambios));
    return {};
  }
  async delete() {
    this.store.borrar(this.path);
    return {};
  }
  collection(sub) {
    return new CollectionRef(this.store, `${this.path}/${sub}`);
  }
}

function aplicaFiltro(datos, [campo, op, valor]) {
  const actual = datos[campo];
  switch (op) {
    case '==':
      return actual === valor;
    case '!=':
      return actual !== valor;
    case '<':
      return actual < valor;
    case '<=':
      return actual <= valor;
    case '>':
      return actual > valor;
    case '>=':
      return actual >= valor;
    case 'in':
      return Array.isArray(valor) && valor.includes(actual);
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(valor);
    default:
      throw new Error(`Operador no soportado en el Firestore falso: ${op}`);
  }
}

class QueryRef {
  // "modo" distingue una colección normal ("coleccion", busca solo hijos
  // directos de this.path) de un collectionGroup ("grupo", busca en TODO el
  // Firestore falso cualquier documento cuya colección contenedora se llame
  // this.path, sin importar bajo qué negocio esté) — igual que
  // db.collectionGroup() en el SDK real, que se usa para el marketplace
  // (buscar repuestos a través de todos los negocios).
  constructor(store, path, { filtros = [], orden = null, limite = null, modo = 'coleccion' } = {}) {
    this.store = store;
    this.path = path;
    this.filtros = filtros;
    this.orden = orden;
    this.limite = limite;
    this.modo = modo;
  }
  _conOpts(cambios) {
    return new QueryRef(this.store, this.path, { filtros: this.filtros, orden: this.orden, limite: this.limite, modo: this.modo, ...cambios });
  }
  where(campo, op, valor) {
    return this._conOpts({ filtros: [...this.filtros, [campo, op, valor]] });
  }
  orderBy(campo, direccion = 'asc') {
    return this._conOpts({ orden: { campo, direccion } });
  }
  limit(n) {
    return this._conOpts({ limite: n });
  }
  async get() {
    let filas = this.modo === 'grupo' ? this.store.listarGrupo(this.path) : this.store.listar(this.path);
    for (const filtro of this.filtros) {
      filas = filas.filter((f) => aplicaFiltro(f.datos, filtro));
    }
    if (this.orden) {
      const { campo, direccion } = this.orden;
      filas = [...filas].sort((a, b) => {
        const av = a.datos[campo];
        const bv = b.datos[campo];
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return direccion === 'desc' ? -cmp : cmp;
      });
    }
    if (this.limite != null) filas = filas.slice(0, this.limite);
    const docs = filas.map((f) => new DocSnapshot(f.id, f.datos, new DocRef(this.store, f.pathCompleto)));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (cb) => docs.forEach(cb) };
  }
}

class CollectionRef extends QueryRef {
  constructor(store, path) {
    super(store, path);
  }
  get parent() {
    const segs = this.path.split('/');
    if (segs.length <= 1) return null; // colección raíz (ej. "negocios"): no tiene documento padre
    return new DocRef(this.store, segs.slice(0, -1).join('/'));
  }
  doc(id) {
    const idFinal = id !== undefined && id !== null ? String(id) : crypto.randomBytes(12).toString('hex');
    return new DocRef(this.store, `${this.path}/${idFinal}`);
  }
  async add(datos) {
    const ref = this.doc();
    await ref.set(datos);
    return ref;
  }
}

class Transaccion {
  constructor(store) {
    this.store = store;
    this.escrituras = [];
  }
  async get(ref) {
    return ref.get();
  }
  set(ref, datos, opts) {
    this.escrituras.push(() => ref.set(datos, opts));
  }
  update(ref, cambios) {
    this.escrituras.push(() => ref.update(cambios));
  }
  delete(ref) {
    this.escrituras.push(() => ref.delete());
  }
  async _confirmar() {
    for (const escritura of this.escrituras) await escritura();
  }
}

class AlmacenEnMemoria {
  constructor() {
    this.datos = new Map(); // path completo del documento -> objeto
  }
  leer(pathDoc) {
    return this.datos.has(pathDoc) ? this.datos.get(pathDoc) : undefined;
  }
  escribir(pathDoc, valor) {
    this.datos.set(pathDoc, valor);
  }
  borrar(pathDoc) {
    this.datos.delete(pathDoc);
  }
  // Lista los documentos directos de una colección (mismo "padre" de ruta,
  // un nivel, no recursivo) — suficiente porque todas las rutas usadas en
  // este proyecto son fijas (no hay colecciones con nombre dinámico raro).
  listar(pathColeccion) {
    const resultado = [];
    const prefijo = `${pathColeccion}/`;
    for (const [pathCompleto, valor] of this.datos.entries()) {
      if (!pathCompleto.startsWith(prefijo)) continue;
      const resto = pathCompleto.slice(prefijo.length);
      if (resto.includes('/')) continue; // es de una subcolección más abajo, no de esta
      resultado.push({ id: resto, datos: valor, pathCompleto });
    }
    return resultado;
  }

  // Equivalente a collectionGroup(): todo documento cuyo PENÚLTIMO segmento
  // de ruta (el nombre de su colección contenedora) sea nombreColeccion, sin
  // importar bajo qué negocio/padre esté.
  listarGrupo(nombreColeccion) {
    const resultado = [];
    for (const [pathCompleto, valor] of this.datos.entries()) {
      const segs = pathCompleto.split('/');
      if (segs.length < 2) continue;
      if (segs[segs.length - 2] !== nombreColeccion) continue;
      resultado.push({ id: segs[segs.length - 1], datos: valor, pathCompleto });
    }
    return resultado;
  }
}

class FirestoreFalso {
  constructor() {
    this.store = new AlmacenEnMemoria();
  }
  collection(path) {
    return new CollectionRef(this.store, path);
  }
  collectionGroup(nombreColeccion) {
    return new QueryRef(this.store, nombreColeccion, { modo: 'grupo' });
  }
  async runTransaction(fn) {
    const tx = new Transaccion(this.store);
    const resultado = await fn(tx);
    await tx._confirmar();
    return resultado;
  }
  // Utilidad solo para pruebas: volcar todo el contenido.
  _volcar() {
    return Object.fromEntries(this.store.datos.entries());
  }
}

module.exports = { FirestoreFalso, FieldValue };
