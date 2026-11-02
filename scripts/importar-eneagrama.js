#!/usr/bin/env node
// scripts/importar-eneagrama.js (ES Modules)
// Importa resultados do teste de Eneagrama (CSV/JSON) e os vincula aos personais, sem digitação.
//
//   node scripts/importar-eneagrama.js <arquivo.csv|json>                 → SIMULAÇÃO (não grava nada; só lê)
//   node scripts/importar-eneagrama.js <arquivo> --aplicar                → grava
//     --manter-manual   não sobrescreve quem já preencheu o Eneagrama à mão (padrão: o teste prevalece, o valor antigo vai em "anterior")
//     --ttl-dias 180    por quanto tempo guardar o resultado de quem ainda não se cadastrou
//     --links           gera links-<lote>.csv com um link assinado por pessoa (com --aplicar)   [--url https://seu-app]
//     --forcar          reimporta um arquivo idêntico a um já importado
//     --chave <arq>     chave de serviço do Firebase (padrão: serviceAccountKey.json)
//
// Para gravar ou gerar links é OBRIGATÓRIO definir BLIND_INDEX_KEY igual à do Render (o e-mail é guardado só como HMAC):
//   PowerShell:  $env:BLIND_INDEX_KEY = "<valor do Render>"
//
// Por linha: com conta já cadastrada como personal → vincula direto; sem cadastro → guarda como pendente (o cadastro consome);
// conta de aluno/admin → ignora; linha inválida → relatório. Cada execução gera relatorio-<lote>.csv (e-mails mascarados).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import admin from "firebase-admin";
import { carregarCredencial, decodificar } from "./_credencial.js";
import { lerTabela } from "./_tabela.js";

const require = createRequire(import.meta.url);
const falhar = (m) => { console.error(`\n❌ ${m}\n`); process.exit(1); };

const args = process.argv.slice(2);
const COM_VALOR = ["--chave", "--ttl-dias", "--url"];
const tem = (f) => args.includes(f);
const valor = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const arquivo = args.find((a, i) => !a.startsWith("--") && !COM_VALOR.includes(args[i - 1]));
if (!arquivo) falhar("Uso: node scripts/importar-eneagrama.js <arquivo.csv|json> [--aplicar] [--manter-manual] [--links] [--forcar] [--ttl-dias 180] [--chave arq]");

const aplicarMudancas = tem("--aplicar"), manterManual = tem("--manter-manual"), gerarLinks = tem("--links"), forcar = tem("--forcar");
const ttlDias = Number(valor("--ttl-dias") || 180);
if (!Number.isFinite(ttlDias) || ttlDias < 1 || ttlDias > 730) falhar("--ttl-dias precisa estar entre 1 e 730.");
if (gerarLinks && !aplicarMudancas) falhar("--links só funciona junto com --aplicar.");
if (aplicarMudancas && !process.env.BLIND_INDEX_KEY) falhar("Defina BLIND_INDEX_KEY com o mesmo valor do Render antes de gravar.\n   PowerShell:  $env:BLIND_INDEX_KEY = \"<valor>\"");
if (!fs.existsSync(arquivo)) falhar(`Arquivo não encontrado: ${arquivo}`);

// O script nunca cifra nada; esta chave descartável só evita o aviso de "chaves efêmeras" do módulo de criptografia.
process.env.DATA_ENCRYPTION_KEYS ||= `0:${crypto.randomBytes(32).toString("base64")}`;
const Enea = require("../server/lib/eneagrama.js");
const Cripto = require("../server/lib/cripto.js");

const mascarar = (e) => e.replace(/^(.).*(@.*)$/, "$1***$2");
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
async function pool(itens, n, fn) { const out = new Array(itens.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; out[k] = await fn(itens[k], k); } })); return out; }

async function main() {
  const bruto = fs.readFileSync(arquivo);
  const sha = crypto.createHash("sha256").update(bruto).digest("hex");
  const loteId = `eneagrama-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${sha.slice(0, 8)}`;
  let linhas;
  try { linhas = lerTabela(decodificar(bruto), arquivo); } catch (e) { falhar(`Não consegui ler o arquivo: ${e.message}`); }
  if (!linhas.length) falhar("O arquivo não tem nenhuma linha de dados.");

  // 1) normaliza e valida cada linha (sem tocar no Firebase)
  const rel = [], porEmail = new Map();
  for (const l of linhas) {
    const chaves = Object.fromEntries(Object.entries(l).map(([k, v]) => [Enea.chaveColuna(k), v]));
    const emailBruto = ["email", "e_mail", "mail", "email_address", "email_do_candidato"].map((k) => chaves[k]).find((v) => typeof v === "string" && v.trim());
    const email = Enea.normalizarEmail(emailBruto);
    if (!email) { rel.push({ linha: l.__linha, email: "", codigo: "", status: "invalido", motivo: "e-mail ausente ou inválido" }); continue; }
    const r = Enea.extrairResultado(l);
    if (r.erro) { rel.push({ linha: l.__linha, email: mascarar(email), codigo: "", status: "invalido", motivo: r.erro }); continue; }
    const anterior = porEmail.get(email);
    if (anterior) rel.push({ linha: anterior.linha, email: mascarar(email), codigo: Enea.codigo(anterior.valor), status: "ignorado", motivo: `e-mail repetido: prevalece a linha ${l.__linha}` });
    porEmail.set(email, { linha: l.__linha, valor: r.valor, avisos: r.avisos });
  }
  const itens = [...porEmail.entries()].map(([email, d]) => ({ email, ...d }));

  // 2) Firebase
  const cred = carregarCredencial(valor("--chave"));
  admin.initializeApp({ credential: admin.credential.cert(cred) });
  const db = admin.firestore(), FieldValue = admin.firestore.FieldValue;
  console.log(`Projeto: ${cred.project_id} · ${aplicarMudancas ? "GRAVANDO" : "SIMULAÇÃO (nada será gravado)"} · lote ${loteId}`);

  if (aplicarMudancas && !forcar) {
    const ja = await db.collection("eneagrama_lotes").where("sha256", "==", sha).limit(1).get();
    if (!ja.empty) falhar(`Este arquivo já foi importado no lote ${ja.docs[0].id}. Use --forcar para repetir.`);
  }

  // 3) decide e (se --aplicar) grava, uma pessoa por vez, 8 em paralelo
  const links = [];
  await pool(itens, 8, async (it) => {
    const base = { linha: it.linha, email: mascarar(it.email), codigo: Enea.codigo(it.valor) };
    const aviso = it.avisos?.length ? ` (${it.avisos.join("; ")})` : "";
    try {
      let u = null;
      try { u = await admin.auth().getUserByEmail(it.email); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
      const papel = u?.customClaims?.role;
      if (papel === "aluno" || papel === "admin") return rel.push({ ...base, status: "ignorado", motivo: `conta de ${papel}` });

      const cadastrado = u && (await db.collection("personais").doc(u.uid).get()).exists;
      if (cadastrado) {
        if (!aplicarMudancas) return rel.push({ ...base, status: "direto", motivo: `simulação${aviso}` });
        const r = await Enea.aplicar({ db, FieldValue, uid: u.uid, resultado: it.valor, origem: "importacao", loteId, manterManual });
        if (r.aplicado) await db.collection("auditoria").doc().set({ em: FieldValue.serverTimestamp(), uid: "script", papel: "operador", acao: "eneagrama.importar", alvo: u.uid, ip: "", ua: "scripts/importar-eneagrama.js", detalhes: { codigo: base.codigo, loteId } });
        rel.push({ ...base, status: r.aplicado ? "direto" : r.motivo, motivo: (r.sobrescreveu ? "sobrescreveu preenchimento manual" : "") + aviso });
      } else {
        if (aplicarMudancas) await Enea.registrarPendente({ db, FieldValue, Cripto, email: it.email, resultado: it.valor, loteId, ttlDias });
        rel.push({ ...base, status: "pendente", motivo: `aguardando cadastro${aplicarMudancas ? ` (expira em ${ttlDias} dias)` : " (simulação)"}${aviso}` });
      }
      if (gerarLinks) links.push({ email: it.email, token: Enea.assinarToken(Cripto, { resultado: it.valor, email: it.email }) });
    } catch (e) { rel.push({ ...base, status: "erro", motivo: e.message }); }
  });

  // 4) livro do lote, relatório e links
  const cont = rel.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  if (aplicarMudancas) await db.collection("eneagrama_lotes").doc(loteId).set({ arquivo: path.basename(arquivo), sha256: sha, linhasLidas: linhas.length, totais: cont, criadoEm: FieldValue.serverTimestamp(), operador: "script" });
  rel.sort((a, b) => a.linha - b.linha);
  const arqRel = `relatorio-${loteId}.csv`;
  fs.writeFileSync(arqRel, "\uFEFF" + ["linha;email;codigo;status;motivo", ...rel.map((r) => [r.linha, r.email, r.codigo, r.status, r.motivo].map(csv).join(";"))].join("\r\n"));
  if (gerarLinks && links.length) {
    const url = (valor("--url") || process.env.APP_URL || "https://personow.onrender.com").replace(/\/+$/, "");
    fs.writeFileSync(`links-${loteId}.csv`, "\uFEFF" + ["email;link", ...links.map((k) => `${csv(k.email)};${csv(`${url}/personal.html?et=${k.token}`)}`)].join("\r\n"));
  }

  console.log(`\nLinhas lidas: ${linhas.length} · e-mails únicos: ${itens.length}`);
  for (const [s, n] of Object.entries(cont)) console.log(`  ${s.padEnd(15)} ${n}`);
  console.log(`\nRelatório: ${arqRel}`);
  if (gerarLinks) console.log(`Links: links-${loteId}.csv  ⚠ contém e-mails: use e apague.`);
  if (!aplicarMudancas) console.log("\n(Simulação) Revise o relatório e rode de novo com --aplicar.");
}

main().then(() => process.exit(0)).catch((e) => falhar(e.message || String(e)));
