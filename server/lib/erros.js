class Falha extends Error {
  constructor(status, msg, codigo, detalhe) { super(msg); this.status = status; this.codigo = codigo; this.detalhe = detalhe; }
}
module.exports = { Falha };
