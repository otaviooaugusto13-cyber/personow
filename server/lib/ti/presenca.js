// Usuários online. O app (aluno/personal/admin/TI) envia um ping a cada 30 s com a aba visível; "online" = ping nos últimos 75 s.
// Escala sem escrever por usuário: cada instância guarda os pings em MEMÓRIA e publica, a cada 20 s, UM documento com os ids
// (hash curto do uid) que viu — presenca_instancias/{instancia}. O total é a UNIÃO desses documentos (usuário em 2 instâncias conta 1).
//   Com 1 instância (Render) a leitura é só a memória local; com várias, o total continua certo (atraso máx. ≈ 20 s).
const crypto = require("crypto");
const K = require("./constantes");

const LETRA = { aluno: "l", personal: "p", admin: "a", ti: "t" };

function criarPresenca({ db, Timestamp }) {
  const mapa = new Map();                      // uid → { l: letra, ts }
  const instancia = crypto.randomBytes(4).toString("hex");
  const hash = (uid) => crypto.createHash("sha256").update(String(uid)).digest("base64url").slice(0, 10);
  let timer = null, cache = null;

  /** Registra o ping. Devolve false se veio rápido demais (ignorado) ou o papel não é contado. */
  function ping(uid, papel) {
    const l = LETRA[papel]; if (!l || !uid) return false;
    const agora = Date.now(), p = mapa.get(uid);
    if (p && agora - p.ts < K.PRESENCA_PING_MIN_MS) return false;
    mapa.set(uid, { l, ts: agora }); return true;
  }
  const idsLocais = (agora = Date.now()) => { const ids = []; for (const [uid, p] of mapa) { if (agora - p.ts > K.PRESENCA_JANELA_MS) mapa.delete(uid); else ids.push(`${p.l}${hash(uid)}`); } return ids; };

  async function publicar() {
    const ids = idsLocais().slice(0, 50_000);
    await db.collection("presenca_instancias").doc(instancia).set({ instancia, emMs: Date.now(), em: Timestamp.now(), ids });
  }
  /** Liga a publicação periódica (chamar uma vez no boot do servidor). */
  function iniciar() { if (timer) return; timer = setInterval(() => publicar().catch((e) => console.warn("presença:", e.message)), 20_000); timer.unref?.(); }
  function parar() { clearInterval(timer); timer = null; }

  /** Total online agora + quebra por tipo. Cache de 5 s: N operadores olhando o painel = 1 consulta. */
  async function contar() {
    if (cache && Date.now() - cache.t < 5000) return cache.v;
    const agora = Date.now(), uniao = new Set(idsLocais(agora));
    try {
      const s = await db.collection("presenca_instancias").where("emMs", ">=", agora - 60_000).get();
      for (const d of s.docs) { const x = d.data(); if (x.instancia !== instancia) for (const id of x.ids || []) uniao.add(id); }
      // limpeza de documentos de instâncias que já não existem (deploys antigos), no máx. 5 por vez
      const velhos = await db.collection("presenca_instancias").where("emMs", "<=", agora - 10 * 60_000).limit(5).get();
      await Promise.all(velhos.docs.map((d) => d.ref.delete()));
    } catch (e) { console.warn("presença (outras instâncias):", e.message); }
    const n = { l: 0, p: 0, a: 0, t: 0 }; for (const id of uniao) n[id[0]]++;
    const v = { total: uniao.size, alunos: n.l, personais: n.p, admins: n.a, ti: n.t, atualizadoEm: new Date(agora).toISOString(), janelaSeg: K.PRESENCA_JANELA_MS / 1000 };
    cache = { t: agora, v }; return v;
  }
  return { ping, contar, iniciar, parar, publicar, _mapa: mapa, _instancia: instancia, limparCache: () => { cache = null; } };
}
module.exports = { criarPresenca };
