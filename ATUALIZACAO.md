# Atualização do Personow com o que o Abastece Já tem de mais avançado

Nada que o Diego já tinha foi removido: Mercado Pago com repasse automático (OAuth + split), "Chamar agora" com exclusividade de 5 min, choque de horário, chat com bloqueio de contatos, avaliação, recibo, QR de cobrança, calendário, indicação, tema claro/escuro, radar/mapa, PWA e testes — tudo segue igual. As telas ganharam acréscimos; nenhum layout foi trocado.

## O que entrou (e de onde veio)

| Área | O que mudou no Personow | Arquivos |
|---|---|---|
| **Segurança HTTP** | CSP, HSTS, nosniff, anti-clickjacking, CORS fechado, proteção CSRF (Origin + JSON), rate limit global e por rota, API sem cache, erros sem vazar stack, sessão revogável (`checkRevoked`), servidor **recusa subir em produção** sem as variáveis críticas, servidor de arquivos só entrega extensões de front, `/diagnostico` só detalha para admin em produção | `server/lib/seguranca.js`, `config.js`, `erros.js`, `server/server.js` |
| **Dados sensíveis cifrados** | CPF, telefone, nascimento, banco e Pix do personal ficam **cifrados em repouso** (AES-256-GCM, amarrado ao uid), CPF duplicado barrado por índice cego, validação estrita de entrada (CPF, telefone, Pix, 18+). O navegador não lê nem escreve mais `personais_privado` | `server/lib/cripto.js`, `validacao.js`, `server/rotas/perfil.js`, `scripts/migrar-cripto.cjs`, `scripts/gerar-chaves.cjs` |
| **Painel admin** | Aprovar / devolver / bloquear personal (com motivo que ele vê), ficha com CPF mascarado, recado do suporte, encerrar sessões, moderação do chat, financeiro (volume, comissão, repasse), aulas, auditoria, aviso global, CSV protegido contra injeção de fórmula. Substitui "mudar status no console do Firestore". Aprovar exige CREF e CPF preenchidos | `admin.html/js/css`, `server/rotas/admin.js`, `scripts/definir-admin.cjs` |
| **Auditoria** | Toda ação de admin, leitura de ficha, salvamento de dados privados e pagamento aprovado grava em `auditoria` | `server/lib/seguranca.js` |
| **Recado do suporte e aviso global** | Banner "Mensagem do suporte" (aluno e personal) com "Entendi" e WhatsApp; aviso de manutenção para todos | `recado.js`, `ui.js`, rotas `/perfil/recado/lido`, `/aviso` |
| **Geolocalização** | Pedido guarda a coordenada do aluno (arredondada a ~110 m, validada no servidor); personal vê distância, filtro "Perto de mim (20 km)" | `geo.js`, `/criarAula`, `script-personal.js` |
| **Perfil inteligente e ranking** | Personal informa anos por foco → gera bio e palavras-chave (por regras, sem inventar fatos). Pedidos aparecem ordenados por **% de match** (distância 40 + experiência 40 + valor 20) com "Mais cedo" como alternativa. Aluno com foco preferido salvo vê personais ordenados por afinidade e a experiência no perfil | `perfil-inteligente.js`, `script-personal.js`, `script.js`, `personal.html` |
| **UI / PWA** | `toast` com tipos (ok/erro), skeleton, botão de instalar app, `chamarFuncao` com GET/PUT, download de CSV autenticado, cache do SW v5 | `ui.js`, `firebase.js`, `sw.js`, `polish.css` (só acréscimos) |
| **Regras do Firestore** | `personais_privado` fechado; limites de tamanho/intervalo nos campos; aluno não forja `recado`/`status`; `auditoria` e `config` só servidor | `firestore.rules` |
| **Testes** | +16 de segurança/admin/perfil, +funções puras do front, +migração e admin. Os testes antigos continuam passando | `test/*` |

## O que NÃO foi trazido (de propósito)

- **Carteira digital / saque / estorno do Abastece.** O Personow já repassa pelo Mercado Pago na hora. O próprio Abastece registra que a carteira própria faz a plataforma custodiar dinheiro de terceiros (risco regulatório). Trocar isso mudaria um fluxo aprovado.
- **Treinamento obrigatório (PRATICAMENTE), cursos e provas.** É regra de negócio daquele cliente; torná-la obrigatória bloquearia personais já aprovados. Posso adaptar como "Formação opcional" se o Diego quiser.
- **Eneagrama, regras de menores 16–17, setores de reposição.** Específicos do varejo. O equivalente aqui é experiência por foco e 18+ (CREF).
- **Tela "Entrar × Criar conta"/multi-perfil por claims.** No Personow aluno e personal são coleções diferentes na mesma conta Google; não há conflito de perfil a tratar.
- **CSP sem `unsafe-inline`.** Os HTMLs do Personow têm ~100 `onclick=""`. A CSP já bloqueia o resto; para endurecer, migrar esses handlers para `addEventListener` (próximo passo).

## Ordem para publicar (importante)

1. `npm run gerar-chaves` → cole `DATA_ENCRYPTION_KEYS`, `DATA_ENCRYPTION_KEY_ID`, `BLIND_INDEX_KEY` no Render. **Guarde um backup das chaves.** Defina também `AMBIENTE=producao` (o `render.yaml` já traz).
2. Suba o servidor (Render). O app antigo continua funcionando: o servidor ainda lê dados em texto puro.
3. Rode `npm run migrar-cripto` (simulação) e depois `npm run migrar-cripto -- --aplicar`. CPF repetido em duas contas não migra: sai no relatório.
4. `firebase deploy --only firestore:rules` **só depois do passo 3** e **junto com o novo front** (o front antigo lia `personais_privado` direto e deixa de funcionar com a regra nova).
5. `npm run definir-admin -- seu@email.com`, depois entre em `/admin.html`. Ative MFA no Firebase Auth e `ADMIN_EXIGE_MFA=1` quando puder.
6. Atualize `config.js` (`URL_RENDER`, `EMPRESA`, `WHATSAPP_SUPORTE`) como antes.

## Limites desta entrega

Testado com Firestore/Auth/Express simulados (`npm test`: tudo passa). **Não testei no navegador, no Firebase real nem no Mercado Pago**, e não consegui subir o Express real neste ambiente (sem acesso ao npm). Faça um teste manual: login, salvar perfil, aprovar no admin, criar/aceitar/pagar uma aula.
