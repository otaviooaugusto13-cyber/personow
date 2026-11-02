// Comprovante de serviço (layout DANFE simplificado). Os dados vêm do SERVIDOR (POST /nota/:id/emitir): ele confere que a nota é
// do aluno, lê o estado do pagamento ao vivo e calcula o código de verificação. Aqui só se desenha a folha A4.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, entrarComGoogle, concluirLoginGoogle, chamarFuncao } from "./firebase.js";
import { brl, esc, fmtData, fmtDataHora, mascaraDoc, soDigitos } from "./core.js";
import { $, iniciarTema, registrarSW } from "./ui.js";
iniciarTema(); registrarSW();

const id = new URLSearchParams(location.search).get("id");
const mostrar = (q) => { $("estado").hidden = q !== "estado"; $("login").hidden = q !== "login"; $("nota").hidden = q !== "nota"; $("acoes").hidden = q !== "nota"; };
const falha = (t) => { mostrar("estado"); $("estado").innerHTML = `<span>${esc(t)} <a href="index.html">Voltar ao painel</a></span>`; };
const METODO = { bank_transfer: "Pix", pix: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", account_money: "Saldo Mercado Pago", ticket: "Boleto" };
const docFmt = (d) => { const x = String(d || ""); if (!x) return "—"; if (x.includes("*") || x.includes("•")) return x.replace(/\*/g, "•"); const n = soDigitos(x); return n.length === 11 || n.length === 14 ? mascaraDoc(n) : x; };
const campo = (rot, val, cls = "") => `<div class="c ${cls}"><span class="r">${esc(rot)}</span><span class="v">${val}</span></div>`;

$("btn-imprimir").onclick = () => window.print();
$("btn-entrar").onclick = async () => { try { await entrarComGoogle(); } catch (e) { console.error(e); } };   // redirect: volta para esta mesma página
concluirLoginGoogle();                                                                                         // conclui o login ao voltar do Google

onAuthStateChanged(auth, async (u) => {
    if (!id) return falha("Link inválido: nota não encontrada.");
    if (!u) return mostrar("login");
    mostrar("estado");
    try { render(await chamarFuncao(`nota/${encodeURIComponent(id)}/emitir`, {}, "POST")); }
    catch (e) {
        console.error(e);
        falha(e.code === "nao-encontrado" ? "Nota não encontrada nesta conta. Entre com a conta do aluno que fez a aula." : e.code === "nota-inconsistente" ? e.message : e.code === "sem-permissao" ? "Esta conta não tem acesso a comprovantes de aluno." : "Não foi possível gerar o comprovante agora. Tente novamente.");
    }
});

/** Código de barras Code 128 desenhado a partir das larguras que o servidor calculou (barra, espaço, barra…). */
function barras(b, altura = 14) {
    let x = 10; const r = [];
    b.modulos.forEach((w, i) => { if (i % 2 === 0) r.push(`<rect x="${x}" y="0" width="${w}" height="${altura}"/>`); x += w; });
    const W = b.total + 20;                                                    // 10 módulos de zona de silêncio de cada lado
    return `<svg class="bc" viewBox="0 0 ${W} ${altura}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Código de barras"><rect width="${W}" height="${altura}" fill="#fff"/><g fill="#000">${r.join("")}</g></svg>`;
}

function render(d) {
    const i = d.identificacao, c = d.calculo, dest = d.destinatario, p = d.prestador, pg = d.pagamento, fiscal = d.modo === "fiscal";
    document.title = `${d.titulo} nº ${i.numeroFmt} — Personow`;
    const linhas = d.itens.map((it) => `<tr><td class="cod">${esc(it.codigo)}</td><td class="desc"><strong>${esc(it.descricao)}</strong>${it.detalhe ? `<small>${esc(it.detalhe.split(" · ").map((t, k) => (k === 1 ? fmtData(t) : t)).join(" · "))}</small>` : ""}</td><td class="un">${esc(it.un)}</td><td class="qt n">${it.qtd}</td><td class="vu n">${brl(it.unitarioCentavos)}</td><td class="vt n">${brl(it.totalCentavos)}</td></tr>`).join("");
    const imp = c.impostos ? Object.entries(c.impostos).map(([k, v]) => `${esc(k.toUpperCase())}: ${typeof v === "number" ? brl(v) : esc(v)}`).join(" · ") : "Não destacado";
    $("nota").innerHTML = `
        ${d.marcaDagua ? `<div class="marca" aria-hidden="true"><span>${esc(d.marcaDagua)}</span></div>` : ""}
        ${d.estornado ? `<div class="estorno" role="alert">PAGAMENTO ESTORNADO — este comprovante não tem mais efeito.</div>` : ""}

        <section class="bl cab" aria-label="Identificação"><div class="lin">
            <div class="c emit"><div class="razao">${esc(d.emitente.razaoSocial)}</div><span class="r">CNPJ</span><span class="v n">${esc(d.emitente.cnpj)}</span><span class="r" style="margin-top:1mm">Cidade</span><span class="v n">${esc(d.emitente.cidade)}</span><span class="r" style="margin-top:1mm">E-mail</span><span class="v n">${esc(d.emitente.email)}</span></div>
            <div class="c doc"><div class="tit">${esc(d.titulo).replace(" DE ", "<br>DE ")}</div><div class="sub">${esc(d.subtitulo)}</div><div class="num">Nº ${esc(i.numeroFmt)}</div><div class="v">SÉRIE ${esc(i.serie)}</div><div class="v">${d.via}ª VIA</div><div style="margin-top:1mm"><span class="selo-pg">${d.estornado ? "ESTORNADO" : "PAGO"}</span></div></div>
        </div></section>

        <section class="bl cod" aria-label="${esc(d.codigo.rotulo)}">${barras(d.codigo.barras)}
            <div class="linha"><div><span class="r">${esc(d.codigo.rotulo)}</span><span class="v mono cod-num">${esc(d.codigo.formatado)}</span></div>${d.codigo.protocolo ? `<div><span class="r">Protocolo de autorização</span><span class="v mono">${esc(d.codigo.protocolo)}</span></div>` : `<div class="dir"><span class="r">Conferência</span><span class="v n" style="font-size:7.5pt">verificar.html · código do documento + 24 dígitos</span></div>`}</div></section>

        <section class="bl"><div class="lin">${campo("Natureza da operação", esc(i.natureza), "w3")}${campo("Data de emissão", esc(fmtDataHora(i.emissao)))}</div></section>

        <div class="bt">Destinatário / Tomador do serviço</div>
        <section class="bl"><div class="lin">${campo("Aluno", esc(dest.nome), "w3")}${campo("CPF / CNPJ", esc(docFmt(dest.documento)))}</div>
            <div class="lin">${campo("Endereço", esc(dest.endereco || "—"), "w3")}${campo("E-mail", esc(dest.email || "—"), "w2")}</div></section>

        <div class="bt">Pagamento</div>
        <section class="bl"><div class="lin">${campo("Forma de pagamento", esc(METODO[pg.metodo] || pg.metodo || "—") + (pg.simulado ? " (teste)" : ""), "w2")}${campo("Referência (Mercado Pago)", esc(pg.referencia || "—"), "w2")}${campo("Situação", pg.status === "estornado" ? "ESTORNADO" : "PAGO")}</div></section>

        <div class="bt">Cálculo dos valores</div>
        <section class="bl"><div class="lin">${campo("Valor dos serviços", brl(c.valorServicosCentavos), "dir")}${campo("Taxa de serviço", brl(c.taxaServicoCentavos), "dir")}${campo("Desconto", brl(c.descontoCentavos), "dir")}${campo("Base de cálculo", brl(c.baseCalculoCentavos), "dir")}${campo("Tributos", esc(imp), "w2")}${campo("Valor total", `<span class="g">${brl(c.totalCentavos)}</span>`, "dir")}</div></section>

        <div class="bt">Prestador do serviço</div>
        <section class="bl"><div class="lin">${campo("Personal autônomo", esc(p.nome), "w3")}${campo("CPF (parcial)", esc(docFmt(p.documento)))}${campo("Local do serviço", esc(d.servico.aluno || "—"), "w2")}</div></section>

        <div class="bt">Itens / Serviços</div>
        <table class="itens"><thead><tr><th class="cod">Código</th><th class="desc">Descrição do serviço</th><th class="un">UN</th><th class="qt n">Qtd</th><th class="vu n">V. unit.</th><th class="vt n">V. total</th></tr></thead>
            <tbody>${linhas}</tbody><tfoot><tr><td colspan="5" class="n">VALOR TOTAL</td><td class="n">${brl(c.totalCentavos)}</td></tr></tfoot></table>

        <div class="bt">Dados adicionais</div>
        <section class="bl adic"><div class="c"><span class="r">Informações complementares</span><ul>${d.adicionais.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div></section>

        <div class="rodape"><span>Emitido em ${esc(fmtDataHora(d.emitidoAgora))} · ${d.via}ª via</span><span>Documento: <span class="mono">${esc(d.id)}</span></span></div>`;
    mostrar("nota");
}
