// Reexporta só o que o painel do parceiro precisa (sem puxar a tela de banimento dos outros portais).
import { abrirFoto, chipNivel } from "./gamificacao-ui.js";
export { abrirFoto };
export const chip = (id) => chipNivel(id, { bronze: "Bronze", prata: "Prata", ouro: "Ouro", platina: "Platina" }[id] || id);
