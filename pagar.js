import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, chamarFuncao, contaDeTeste, entrarComGoogle, concluirLoginGoogle, mensagemErroAuth } from "./firebase.js";
import { calcularPreco, visaoAluno, brl, fmtData, estaPago } from "./core.js";
import { $, iniciarTema, registrarSW } from "./ui.js";
iniciarTema(); registrarSW();

const params = new URLSearchParams(location.search);
const id = params.get("id"), paymentId = params.get("payment_id") || params.get("collection_id"), retorno = params.get("retorno");
const mostrar = (q) => ["estado-carregando", "estado-login", "estado-aula", "estado-ok", "estado-aguardando"].forEach((e) => ($(e).hidden = e !== q));
const aviso = (t) => { $("msg").textContent = t; $("msg").hidden = false; };
let aula = null, parar = null, semCartao = false;

function sucesso(p) { parar?.(); $("link-nota").href = p.notaId ? `nota.html?id=${encodeURIComponent(p.notaId)}` : "index.html"; if (!p.notaId) $("link-nota").textContent = "Voltar ao painel"; mostrar("estado-ok"); $("msg").hidden = true; }

onAuthStateChanged(auth, async (user) => {
  if (!id) { mostrar(""); return aviso("Link de pagamento inválido: aula não encontrado."); }
  if (!user) return mostrar("estado-login");
  try {
    const snap = await getDoc(doc(db, "aulas", id));
    if (!snap.exists()) { mostrar(""); return aviso("Aula não encontrado."); }
    aula = snap.data();
    if (aula.uid !== user.uid) { mostrar(""); return aviso("Este aula pertence a outra conta. Entre com a conta do aluno."); }
    if (estaPago(aula)) return sucesso(aula);
    if (aula.status === "cancelada") { mostrar(""); return aviso("Este aula foi cancelado."); }
    if (aula.status !== "aceita") { mostrar(""); return aviso("Ainda não há personal nesta aula. O pagamento libera quando alguém aceitar."); }

    // O aluno vê só valor do serviço + taxa fixa + total (o servidor recalcula tudo na hora de cobrar).
    let s; try { s = visaoAluno((await getDoc(doc(db, "aulas_financeiro", id))).data() || {}); if (!Number.isInteger(s.total)) throw 0; }
    catch (e) { s = visaoAluno(calcularPreco()); }
    const teste = await contaDeTeste();
    $("btn-pagar").hidden = teste; $("btn-pagar-teste").hidden = !teste;
    try { const c = await getDoc(doc(db, "cartoes", user.uid)); semCartao = !(c.exists() && c.data().status === "ativo"); } catch (e) { semCartao = false; }
    $("aviso-cartao").hidden = !semCartao; $("btn-pagar").disabled = $("btn-pagar-teste").disabled = semCartao;
    $("p-aluno").textContent = aula.aluno; $("p-detalhe").textContent = `${fmtData(aula.data)} · ${aula.horario} · ${aula.foco}${aula.personalNome ? " · " + aula.personalNome : ""}`;
    $("p-valor").textContent = brl(s.valor); $("p-taxa").textContent = brl(s.taxaFixa); if ($("p-taxa").parentElement) $("p-taxa").parentElement.hidden = !s.taxaFixa;   // sem taxa extra neste modelo $("p-total").textContent = brl(s.total);

    if (retorno === "success" || paymentId) {      // voltou do Mercado Pago
      mostrar("estado-aguardando");
      parar = onSnapshot(doc(db, "aulas", id), (d) => { if (estaPago(d.data() || {})) sucesso(d.data()); });   // webhook pode chegar primeiro
      if (paymentId) chamarFuncao("confirmarPagamento", { aulaId: id, paymentId }).then((r) => { if (r.aprovado === false) { parar?.(); mostrar("estado-aula"); aviso(`Pagamento ${r.status === "pending" || r.status === "in_process" ? "ainda em análise. Assim que for aprovado, a nota é emitida." : "não aprovado. Tente novamente."}`); } }).catch((e) => { if (e.code !== "backend-nao-configurado") console.warn(e); });
      setTimeout(() => { if (!$("estado-aguardando").hidden) { mostrar("estado-aula"); aviso("Ainda não recebemos a confirmação. Se você pagou, aguarde um minuto e atualize a página."); } }, 45000);
    } else if (retorno === "failure") { mostrar("estado-aula"); aviso("O pagamento não foi concluído. Você pode tentar de novo."); }
    else if (retorno === "pending") { mostrar("estado-aula"); aviso("Pagamento pendente. Se for Pix, conclua no seu banco; a confirmação é automática."); }
    else mostrar("estado-aula");
  } catch (e) { console.error(e); mostrar(""); aviso("Não foi possível carregar a aula."); }
});

$("btn-entrar").onclick = () => entrarComGoogle().catch((e) => { const m = mensagemErroAuth(e); if (m) aviso(m); });
concluirLoginGoogle().then(({ erro }) => { const m = erro && mensagemErroAuth(erro); if (m) aviso(m); });

$("btn-pagar-teste").onclick = async () => {
  const b = $("btn-pagar-teste"); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Simulando…'; $("msg").hidden = true;
  try { sucesso(await chamarFuncao("teste/pagar", { aulaId: id })); }
  catch (e) { console.error(e); aviso(e.message || "Não foi possível simular o pagamento."); b.disabled = false; b.innerHTML = "🧪 Simular pagamento aprovado (teste)"; }
};

$("btn-pagar").onclick = async () => {
  const b = $("btn-pagar"); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Abrindo pagamento…'; $("msg").hidden = true;
  try {
    const { init_point } = await chamarFuncao("criarCobranca", { aulaId: id });
    if (!init_point) throw new Error("sem link");
    location.href = init_point;
  } catch (e) {
    console.error(e);
    aviso(e.code === "cartao-obrigatorio" ? "Cadastre um cartão de crédito válido para pagar este serviço."
        : e.code === "backend-nao-configurado" ? "O pagamento ainda não foi conectado ao Mercado Pago (confira FUNCTIONS_BASE em config.js)."
        : e.code === "app-url-invalida" || e.code === "mp-nao-configurado" ? e.message
        : e.code === "mp" ? `${e.message}`
        : e.code === 404 || e.code === "rota-inexistente" ? "O servidor de pagamentos não respondeu (404). Confira o endereço do serviço no Render."
        : "Não foi possível iniciar o pagamento. Tente de novo.");
    b.disabled = false; b.innerHTML = "💳 Pagar com Pix ou cartão";
  }
};
