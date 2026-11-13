# Relatório de Homologação (UAT) — PersoNOW `personow-main.zip`

Data: 13/11/2026 · Ambiente: sandbox sem rede, Express/Firestore/Auth **falsos** (os do próprio projeto), Chromium (Playwright) com Firebase stubado.

## 1. Escopo assumido e limites

- **Escopo:** o código como está (marketplace sob demanda). Não há "Contratante" no código; cobri **parceiro (painel B2B)** e **admin** como visão de gestão. *Pendente de confirmação.*
- **Mobile:** não existe app nativo; é PWA (mesmo código/API). "Mobile" = viewport de celular (360/390/430 px) com touch.
- **Não testado:** Firebase/Mercado Pago reais, sincronia em tempo real entre dois dispositivos, push, instalação da PWA, offline, fluxos de dinheiro ponta a ponta, perfil TI no navegador.

## 2. Resultado resumido

| Área | Resultado | Evidência |
|---|---|---|
| `npm test` | Verde (exit 0): backend 90, TI 33, jogo 21, mapa 13, perfil 12, eneagrama 13, split | `/tmp` log da execução |
| Controle de acesso (136 rotas × anônimo/aluno/personal/admin/TI) | Sem acesso indevido. Só 4 rotas públicas, todas legítimas | `evidencias/matriz.json` |
| Robustez (5 corpos malformados × 136 rotas × 4 perfis) | 0 erros 500 | `probe-rbac.cjs` |
| Contrato front ↔ API | Divergências só em código **não alcançável** (ver UAT-03) | `contrato.py` |
| Navegador — Aluno (390 e 1280 px) | Entra, sem erro de JS, sem scroll horizontal | prints `aluno-*.png` |
| Navegador — restrições | Conta de personal no painel do aluno → redirecionada ao painel certo (com trava anti-loop); aluno banido → tela de bloqueio; `/sessao` 500 → tela "Tentar de novo" sem derrubar a sessão | `saida-jornadas.txt` |
| Navegador — Personal (390 px) | Dashboard carrega (checklist de onboarding, nível, vidas); bloqueado pelo admin → tela fixa | `personal-390.png` |
| Navegador — Parceiro / Admin | Carregam sem erro de JS; parceiro sem vínculo vê "Acesso ainda não liberado". Admin: só tela de login (não exercitei o painel logado) | `saida-jornadas.txt` |
| Mapa (suíte do projeto no navegador) | Verde, inclui 360/390/430 px | execução local |

**Ressalva da sonda de acesso:** usa banco vazio; valida portões de autorização e tratamento de entrada, não regras de negócio com dados (essas estão nos testes do projeto, que passaram).

## 3. Matriz de bugs

| ID | Gravidade | Título | Status |
|---|---|---|---|
| UAT-01 | Média | Suíte oficial dá falsa segurança (13 testes fora do `npm test`, vários vermelhos) | Aberto |
| UAT-02 | Média | 6 arquivos de rota não montados; 3 dependem de helpers inexistentes | Aberto |
| UAT-03 | Baixa | Código morto no front (`mod-*.js`, abas do admin, `script.js`) | Aberto |
| UAT-04 | Baixa | Erros de concordância em textos visíveis (12 linhas, 6 arquivos) | **Corrigido** |
| UAT-05 | Baixa | Suíte E2E de navegador obsoleta | Parcialmente corrigido |
| UAT-06 | Baixa | Precache do service worker incompleto | Aberto (inferido) |
| UAT-07 | Info | Divergência código × produto-alvo dos docs | Decisão de produto |
| UAT-08 | Baixa (UX) | Home do aluno repete o pedido "Defina sua localização" (chip + cartão) | Aberto |

### UAT-01 — Média — Suíte oficial dá falsa segurança
- **Passos:** `node test/seguranca.test.cjs` (e `regras.test.js`, `modulos`, `academias`, `admin`, `server.fake`). Compare com os arquivos listados em `package.json > scripts.test`.
- **Esperado:** todo teste do repositório ou roda no `npm test` e passa, ou é removido.
- **Obtido:** `npm test` fica verde, mas 13 arquivos não rodam; vários falham.
- **Triagem:** `seguranca` (12 falhas) é **defasado**: usa `GET /perfil/personal/privado`, `/admin/eu` e `finalizarPagamento`, que não existem mais (a rota atual é `GET /perfil/privado`). `regras.test.js` usa constantes antigas (`COMISSAO_PCT`). `server.fake` chama middleware sem `next`. `modulos`/`academias` dependem das rotas do UAT-02. `admin` não triado em detalhe.
- **Risco:** as garantias de segurança que `seguranca` deveria cobrir (cifra em repouso, máscara de CPF, auditoria) só ficam protegidas se estiverem cobertas por outro teste. Não verifiquei teste a teste.

### UAT-02 — Média — Rotas não montadas e dependências ausentes
- **Passos:** abra `server/server.js` (laço `for (const rota of [...])`) e compare com `server/rotas/`. Faltam `academias`, `comprovante`, `extrato`, `formacao`, `niveis`, `perfil`. Para reproduzir o 500: acrescente-as à lista e chame `GET /extrato` e `GET /niveis/eu`.
- **Esperado:** rota existente ou montada ou removida.
- **Obtido:** não montadas. Ao montar: `TypeError: estaPaga is not a function` (extrato/niveis/comprovante usam `estaPaga`, `splitDaAula`, `primeiroNome`, que o contexto do servidor não fornece). `perfil.js` ainda duplica rotas de `conta.js`. `academia.html` chama `/academia/painel` e `/academia/reivindicar` (404); não achei link para ela no app.
- **Nota:** tentei montar as rotas e **reverti**; não é patch seguro. Decisão depende do UAT-07.

### UAT-03 — Baixa — Código morto no front
- **Evidência:** `carregarModulos` (shell.js) não é chamado por nenhum painel, então `mod-niveis/formacao/extrato/comprovante/suporte` nunca carregam. `admin-abas.js` não é referenciado por `admin.js`/`admin.html` (abas Academias e Advertências desligadas; falta confirmar no navegador logado). `script.js` não é carregado por nenhum HTML (chama `/avaliarAula`, `/enviarMensagem`, inexistentes).
- **Impacto hoje:** nenhum para o usuário; risco de alguém "religar" e gerar 404/500.

### UAT-04 — Baixa — Concordância (CORRIGIDO)
- **Passos:** abrir o painel do personal → Início (subtítulo) e a aba de capacitação; painel Admin → Taxas.
- **Esperado:** "concluir **a** capacitação", "**sua** primeira aula", "**próximas** aulas", "Aulas já **criadas**".
- **Obtido (antes):** "concluir o capacitação", "seu primeira aula", "Próximos aulas", "Aulas já criados", "Aula inválido." (mensagem padrão de erro 400).
- **Correção:** `personal.html`, `admin.html`, `admin.js`, `firebase.js` ("Dados inválidos."), `script-aluno.js`, `script-personal.js`. `sw.js` subiu para `personow-v16`. `npm test` verde após a mudança.

### UAT-05 — Baixa — E2E de navegador obsoleta (parcial)
- **Passos:** `NODE_PATH=<playwright> node test/e2e.browser.cjs`.
- **Obtido:** falha já no carregamento. Quatro causas: (1) stub de auth sem 12 exports que `firebase.js` importa; (2) teste não simula `POST /sessao`; (3) fixtures usam `alunoUid`, mas servidor, regras e front usam `uid`; (4) usuário fake sem `getIdToken`/`emailVerified`.
- **Correção aplicada:** as quatro, além de exports faltantes (`EmailAuthProvider`, `reauthenticate*`, `limit`, `getCountFromServer`).
- **Ainda vermelha:** 27 dos 31 IDs de elemento que o teste espera não existem na UI atual (ex.: `display-name-home` → `nome-home`). Exige reescrita.

### UAT-06 — Baixa (inferido) — Precache do SW
- `sw.js` (`BASE`) omite arquivos importados pelo app (ex.: `portal.js`, `login-email.js`, `presenca.js`). A estratégia é network-first com cache em tempo de execução, então a leitura do código indica que o app só abre offline **depois** de uma visita online. **Não testei offline.** Já listado como pendente em `MUDANCAS.md`.

### UAT-07 — Info — Código × produto-alvo
- `ESQUELETO-TECNICO.md` e `AUDITORIA-ESCOPO.md` descrevem outro produto (vínculo contínuo, fichas, agenda, evolução) e o expurgo do legado ("Abastece Já"). O build implementa o sob demanda. Define o que significa "homologar".

### UAT-08 — Baixa (UX)
- **Passos:** logar como aluno sem localização (390 px). **Obtido:** o chip do topo e o cartão central pedem a mesma ação. **Sugestão:** manter um só.

## 4. Entregas

- `hotfix-uat.diff` — diff unificado (9 arquivos) contra o zip original.
- `arquivos-modificados.zip` — só os 9 arquivos alterados, com os caminhos do projeto.
- `evidencias.zip` — scripts da sonda (`probe-rbac.cjs`, `jornadas.cjs`, `gerar-api.cjs`, `contrato.py`), `matriz.json`, `saida-jornadas.txt` e prints.

Arquivos alterados: `admin.html`, `admin.js`, `firebase.js`, `personal.html`, `script-aluno.js`, `script-personal.js`, `sw.js` (aplicação) e `test/e2e.browser.cjs`, `test/e2e.stubs.cjs` (teste). Nenhum arquivo de servidor foi alterado.

Os scripts de evidência têm caminhos fixos do meu ambiente (`/home/claude/personow-main`, `/opt/npm-tools`) e precisam de ajuste para rodar na sua máquina.
