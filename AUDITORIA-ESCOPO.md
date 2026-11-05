# Auditoria de escopo — PersoNOW

Revisão do código e da documentação contra o escopo **Personal Trainers × Alunos** definido em [`ESQUELETO-TECNICO.md`](ESQUELETO-TECNICO.md).

**Como foi feito:** leitura dos 9 documentos, de `server/server.js`, `split.js`, `regras.js`, `config.js`, `firestore.rules`, `render.yaml`, das rotas de aula/pagamento/execução/B2B e das telas; busca dirigida de vocabulário em todos os arquivos de código, tela, configuração e teste (exceto `package-lock.json`).
**Limites:** nenhum código foi alterado e os testes **não foram executados** nesta revisão. Contagens abaixo são de busca textual (podem incluir falsos positivos, indicados quando conhecidos). A base tem cerca de 18,5 mil linhas de código (JS/HTML/CSS).

---

## 1. Resumo

1. **O problema não é só vocabulário.** Os termos literais de varejo (loja, missão, reposição, royalty) são poucos. O que sobrou é a **arquitetura de marketplace sob demanda estilo Uber**, herdada do modelo de promotores em loja do Abastece Já: o aluno "pede" uma aula, um personal da região "aceita", a plataforma retém comissão por nível, guarda o dinheiro numa carteira e libera o pagamento quando o personal prova a execução com GPS e foto do local.
2. **Esse modelo contradiz a proposta de valor.** O PersoNOW é um vínculo contínuo (prescrição, agenda, evolução, assinatura). O código modela transações avulsas entre desconhecidos.
3. **Os módulos centrais não existem.** Não há ficha de treino, execução com carga, medidas/dobras/fotos de progresso, planos nem assinaturas. A landing cita "avaliação física" e "plano de treino" como serviços, mas nada disso está implementado.
4. **A documentação descrevia um estado que o código não tem** (ver achado H1) e a landing/manifest vendem o oposto do módulo financeiro novo ("sem mensalidade e sem fidelidade").
5. Cerca de **3.800 linhas (~20% do código)** pertencem a módulos legados. Quase tudo sai por inteiro; só o comprovante (≈390 linhas, vira recibo) e `lib/imagem.js` são reaproveitados. Além disso, aulas → sessões, taxas, carteira e telas precisam de adaptação.

---

## 2. Achados

Severidade: **Crítica** = contradiz o produto · **Alta** = estrutura herdada que bloqueia o escopo · **Média** = ruído conceitual ou inconsistência · **Baixa** = texto.

### A. Modelo de negócio

| # | Sev. | Achado | Onde |
|---|---|---|---|
| A1 | Crítica | Fluxo "pedido → aceite por personal da região → pagamento" é a espinha do produto. Estados `aberta`/`aceita`/`paga`; limite de pedidos abertos por aluno; "personal desistiu → pedido volta para a fila". | `server/rotas/aulas.js`, `server/regras.js`, `script.js` (`confirmarPedido`, `renderPedidos`), `script-personal.js`, `personal.html` (aba "ofertas") |
| A2 | Crítica | README e manifest definem o produto como "marketplace sob demanda (estilo Uber)" / "Treino sob demanda: alunos pedem aulas, personal trainers aceitam". | `README.md` (reescrito), `manifest.json:4`, `landing.html` |
| A3 | Alta | Descoberta por localização: "Perto de mim (20 km)", radar/mapa, distância na oferta, raio, alertas por proximidade. | `geo.js`, `server/lib/geo.js`, `RAIO_KM_AULAS` e `LOCAL_*` em `config.js`, `server/rotas/relampago.js` |
| A4 | Alta | Ranking de ofertas por "% de match" (distância 40 + experiência 40 + valor 20): lógica de leilão/despacho. | `perfil-inteligente.js`, `script-personal.js`, `test/perfil.test.js` (71 ocorrências de "match" em 12 arquivos, fora dos testes) |
| A5 | Alta | O aluno "propõe o valor" da aula; o personal só aceita ou não. No escopo novo é o personal quem define valores de pacote e consultoria. | `server/regras.js` (`VALOR_MINIMO/MAXIMO`), `server/rotas/aulas.js` |

### B. Varejo literal

| # | Sev. | Achado | Onde |
|---|---|---|---|
| B1 | Média | "Missão" como unidade de trabalho: menu "Missões", KPI "Missões abertas", "Missões por status", exportação `missoes`, bloco `missoes` no perfil de TI. (28 ocorrências em 5 arquivos; "permissão" não conta.) | `admin.html:74,106,110,145`, `admin.js`, `server/rotas/admin.js:328`, `server/rotas/ti.js:191`, `ti.js:162-169` |
| B2 | Média | Fallback `a.local ?? a.loja` ainda lê o campo `loja` de dados do produto anterior. | `script.js:526,560`, `scripts/migrar-dados.cjs:5,34` |
| B3 | Média | "Reposição" e "setor" em comentários e na lista de "o que não foi trazido". | `ATUALIZACAO.md` (removido), 5 arquivos |
| B4 | Média | `royalty: comissao` ("alias de compatibilidade") no objeto de split, no servidor e no navegador. | `server/split.js:121`, `core.js:42` |
| B5 | Alta | **Painel B2B de "parceiros e indústrias":** papel `parceiro`, vínculo parceiro↔aula, KPIs por região, ranking de "personais mais eficientes", fotos de auditoria, "ao vivo agora". Texto da tela: "indústrias". 280 linhas dedicadas; `parceiroId` espalhado em aulas, execução, pagamentos e relâmpago. | `parceiro.html/js`, `parceiro-ui.js`, `style-b2b.css`, `server/lib/b2b.js`, `server/rotas/b2b.js`, `server/rotas/{aulas,execucao,relampago}.js`, rota `/painel-parceiro` em `server/server.js`, coleção `parceiros` em `firestore.rules` |
| B6 | Alta | **Eneagrama:** importação em lote por e-mail com HMAC, links assinados, pendentes com TTL, LGPD própria. 404 linhas, 158 ocorrências em 12 arquivos, 4 coleções/campos (`eneagrama`, `eneagramaMeta`, `eneagrama_resultados`, `eneagrama_lotes`). O próprio `ATUALIZACAO.md` classificava como "específico do varejo" e "não trazido" — mas está no repositório. | `server/lib/eneagrama.js`, `scripts/importar-eneagrama.js`, `perfil-inteligente.js`, `personal.html`, `config.js` (`ENEAGRAMA_TESTE_*`), `server/lib/seguranca.js`, `server/rotas/conta.js`, `package.json` (teste) |

### C. Mecânicas de "gig economy" / despacho

| # | Sev. | Achado | Onde |
|---|---|---|---|
| C1 | Alta | **Chamado relâmpago** (urgência com bônus de R$ 10/15/25 pago pelo aluno) e **"Chamar agora"** (exclusividade de 5 min). Padrão de entrega/transporte sob demanda. 77 ocorrências em 19 arquivos; o cron do Render expira relâmpagos. | `server/rotas/relampago.js`, `server/regras.js` (`EXCLUSIVIDADE_MINUTOS`), `BONUS_RELAMPAGO_CENTAVOS`, `render.yaml` |
| C2 | Alta | **Níveis Bronze/Prata/Ouro/Platina com comissão progressiva** (25→10%) por "chamados concluídos". 39 ocorrências em 16 arquivos, 25 nos testes. | `server/split.js`, `core.js`, `config.js`, `server/lib/reputacao.js`, `gamificacao-ui.js`, `personal-jogo.js` |
| C3 | Alta | **Vidas, multas, advertências e banimento** (`VIDAS_MAX = 3`; a 3ª advertência aplica a claim `banido`). Disciplina de prestador de plataforma, não de relação profissional-cliente. 110 ocorrências em 21 arquivos. | `server/lib/reputacao.js`, `server/rotas/reputacao.js`, `server/rotas/aulas.js` (`aplicarInfracao`), `firestore.rules` (`reputacao`, `infracoes`, `niveis_historico`, claim `banido`) |
| C4 | Média | **Filtro anti-contato no chat** (bloqueia telefone, e-mail, "whatsapp", "pix"): anti-desintermediação de marketplace. Atrapalha o uso real entre personal e aluno. | `server/regras.js` (`mensagemSuspeita`, `FRASES_FUGA`) |
| C5 | Média | Gamificação do lado do aluno (`aluno-jogo.js`, `style-jogo.css`) e do personal; 1.071 linhas em reputação/jogo. Pode ser reaproveitada no futuro como **sequência de treinos/aderência**, mas hoje está ligada a níveis de comissão. | `aluno-jogo.js`, `personal-jogo.js`, `gamificacao-ui.js`, `style-jogo.css`, `test/jogo.test.cjs` |

### D. Prova de execução no estilo "promotor em loja"

| # | Sev. | Achado | Onde |
|---|---|---|---|
| D1 | Alta | **Check-in por geofencing (≤100 m do aluno) e check-out com foto do local da aula** como condição para liberar o pagamento (`exigeExecucao`, fase `executada`). É a auditoria de visita ao ponto de venda aplicada a personal trainer. Sessões online não têm "local". | `server/rotas/execucao.js`, `server/rotas/pagamentos.js:21-22`, `server/lib/reputacao.js:179`, `camera.js` (uso), `server/lib/config.js` (`GEO`, `FOTO`) |
| D2 | Alta | **Foto de checkout guardada em base64 no Firestore**, com deduplicação por SHA-256. Se esse padrão for reusado para fotos corporais, fere o requisito de LGPD (ver `ESQUELETO-TECNICO.md` §4.3 e §7). | `server/rotas/execucao.js:59-95`, coleção `fotos_checkout` |
| D3 | Média | "Auditoria da foto pelo aluno" (`/auditarFoto`) e `auditoriaAluno`. | `server/rotas/execucao.js:119-132`, `server/lib/b2b.js` |

### E. Habilitação / treinamento

| # | Sev. | Achado | Onde |
|---|---|---|---|
| E1 | Alta | **Treinamento obrigatório com vídeo anti-pulo, timer, pings e prova 100%**, por categoria. É a certificação de promotor do cliente anterior. 576 linhas; 153 ocorrências de "habilita", 138 de "treinamento". Hoje **bloqueia** o personal de ver ofertas (claim `treinado`). | `server/lib/{treinamento,habilitacao,categorias}.js`, `server/rotas/{treinamento,categorias}.js`, `cursos.js`, `scripts/semear-categorias.cjs`, `firestore.rules`, `server/rotas/admin.js:251` ("Catálogo de capacitação Personow") |
| E2 | Alta | **Colisão de nome:** no PersoNOW "treino" é a prescrição ao aluno. No código `treinamento`, `tab-treino` e `TREINO_*` significam **curso de habilitação do personal**. Construir o módulo de treinos sem renomear/remover isto gera confusão permanente. | `personal.html:144,177`, `server/lib/config.js` (`TREINO_*`), `server/lib/treinamento.js` |

### F. Fiscal

| # | Sev. | Achado | Onde |
|---|---|---|---|
| F1 | Média | Comprovante com layout **DANFE** (documento de NF-e, de venda de mercadoria): código de barras Code 128, blocos DANFE, "natureza da operação", `nfse = null`. Para serviço de treino o necessário é recibo. 388 linhas. | `server/lib/danfe.js`, `server/rotas/nota.js`, `nota.html/js/css`, `verificar.html/js`, `NOTA-COMPROVANTE.md` (removido) |

### G. Colisões de vocabulário

| # | Sev. | Achado |
|---|---|---|
| G1 | Média | **"Chamado"** tem dois sentidos: ticket de TI (`chamados_ti`, 6 índices) e "chamado concluído" para subir de nível (209 ocorrências em 39 arquivos). Após o expurgo só o primeiro deve existir. |
| G2 | Média | **"Comissão"** (119 ocorrências em 19 arquivos) é vocabulário de venda de produto. Trocar por **taxa da plataforma**. |
| G3 | Baixa | **"Serviço"** aparece como unidade genérica (`servico: {...}` no recibo em `server/rotas/pagamentos.js:81`, "finalizar o serviço" em `pagamentos.js:22`). Usar **sessão**/**plano**. |

### H. Inconsistências internas

| # | Sev. | Achado | Onde |
|---|---|---|---|
| H1 | Alta | **A documentação contradizia o código.** `ATUALIZACAO.md` dizia que carteira/saque e treinamento obrigatório "NÃO foram trazidos"; ambos estão implementados (`carteira.js` 226 linhas, `treinamento.js` 185). Dizia o mesmo do Eneagrama. | `ATUALIZACAO.md` (removido) |
| H2 | Alta | **Três modelos financeiros diferentes** convivem: (1) `split.js` — aula R$ 100, comissão R$ 25, repasse R$ 75, níveis 25→10%; (2) `regras.js` — comissão fixa de 15%, aluno propõe de R$ 30 a R$ 1.000; (3) comentário em `pagamentos.js:1` — "R$ 150 personal / R$ 50 comissão". Só o (1) é usado em produção. | `server/split.js`, `server/regras.js`, `server/rotas/pagamentos.js:1` |
| H3 | Média | **`server/regras.js` é código morto**: só é importado por `scripts/migrar-dados.cjs`. | `server/regras.js` |
| H8 | Média | O script `npm test` chama só 6 arquivos (`split`, `perfil`, `backend`, `ti`, `jogo`, `eneagrama`). Os testes `regras`, `seguranca`, `cripto-e-admin`, `server.fake`, `migracao` e os `e2e` existem em `test/` mas **não são executados** por ele — inclusive os de segurança e criptografia. Rodá-los antes da Fase 0 dá a linha de base. | `package.json`, `test/` |
| H4 | Média | `landing.html` e `manifest.json` vendem o oposto do módulo financeiro: "Sem mensalidade e sem fidelidade", "pague só depois da aula", "Treino sob demanda". Também citam "Itapira / SP" e um e-mail pessoal como emitente. | `landing.html:38,81,89`, `manifest.json:4`, `config.js` (`EMPRESA`), `server/lib/config.js` |
| H5 | Baixa | **Rastros de renomeação mecânica** (erros de concordância e palavra trocada): "os aulas", "Aulas novos/antigos", "próximos aulas", "o parceiro `exigeExecucao`" (onde era "o campo"), "operador" virou "parceiro" em `TI-MODULO.md`. Indicam um buscar-e-substituir `serviço/missão → aula`. | `server/rotas/pagamentos.js:11,21`, `server/rotas/suporte.js:33`, `core.js:80,169,171`, `admin.html:278`, `admin.js:813,820`, `personal.html:93` |
| H6 | Baixa | Regra de idade: README diz personal 18+; `SEGURANCA.md` fala em "16+" e regras de menores 16–17. | `SEGURANCA.md` §3 e §5 |
| H7 | Baixa | Migração do produto anterior (`solicitacoes → aulas`, `loja → local`, `promotor* → personal*`) ainda no repositório, apesar de a instrução ser usar projeto novo sem migrar. 158 linhas. | `scripts/migrar-dados.js/.cjs`, `test/migracao.test.cjs`, `npm run migrar` |

### I. Lacunas em relação ao escopo

| # | Sev. | Lacuna |
|---|---|---|
| I1 | Crítica | **Gestão de Treinos:** sem ficha, exercício, periodização, execução com carga, gráfico de progressão. |
| I2 | Crítica | **Evolução e Biometria:** sem peso/medidas/dobras/composição, sem fotos de progresso (só foto de local), sem metas, sem consentimento LGPD para dado de saúde. |
| I3 | Crítica | **Financeiro/Assinaturas:** sem plano, pacote, assinatura, cobrança recorrente, inadimplência. Só pagamento avulso por aula. |
| I4 | Alta | **Agenda:** `disponibilidade` guarda só `{inicio, fim}`; não há grade semanal, slots, bloqueios, recorrência nem remarcação. |
| I5 | Alta | **Vínculo personal ↔ aluno** não existe como entidade; o chat é por aula (`aulas/{id}/mensagens`). |

---

## 3. Inventário de vocabulário legado

Contagem em código, telas, configurações e documentos (sem `package-lock.json`); a coluna "testes" soma ocorrências em `test/`.

| Termo | Ocorrências | Arquivos | Testes |
|---|---:|---:|---:|
| loja / lojista | 4 | 2 | 4 |
| missão / missões (palavra inteira) | 28 | 5 | — |
| reposição | 5 | 5 | 2 |
| royalty | 4 | 3 | 0 |
| parceiro | 112 | 28 | 32 |
| b2b | 39 | 13 | 9 |
| eneagrama | 158 | 12 | 36 |
| relâmpago / relampago | 77 | 19 | 10 |
| chamar agora / exclusividade | 6 | 4 | 4 |
| habilita… | 153 | 27 | 53 |
| treinamento | 138 | 27 | 67 |
| danfe | 19 | 8 | 8 |
| check-in / check-out | 133 | 24 | 48 |
| geofencing | 9 | 7 | 4 |
| vidas / multa / banimento | 110 | 21 | 17 |
| Bronze / Prata / Ouro / Platina | 39 | 16 | 25 |
| comissão | 119 | 19 | 38 |
| carteira / saque | 223 | 30 | 53 |
| "foto do local" / `fotos_checkout` | 22 | 13 | 2 |
| chamado (palavra inteira) | 209 | 39 | — |

## 4. Tamanho dos módulos legados (linhas)

| Grupo | Linhas | Destino |
|---|---:|---|
| Reputação, níveis, gamificação | 1.071 | 🗑️ (aderência pode renascer na Fase 1) |
| Treinamento, habilitação, cursos | 576 | 🗑️ |
| Eneagrama | 404 | 🗑️ |
| Comprovante DANFE e verificação | 388 | 🔧 vira recibo |
| Execução GPS + foto | 383 | 🗑️ (inclui `lib/imagem.js`, que fica; `camera.js` fica) |
| B2B / parceiro | 280 | 🗑️ |
| Matching / perfil inteligente | 255 | 🗑️ |
| `regras.js` morto | 175 | 🗑️ (migrar `conflitoNaAgenda` e `hhmmValido` para `slots.js`) |
| Migração do produto anterior | 158 | 🗑️ |
| Relâmpago | 90 | 🗑️ |
| **Total** | **≈ 3.800** | de ≈ 18.500 linhas de código (JS/HTML/CSS) |

Contagem só de arquivos de código e teste; documentos ficam de fora.

---

## 5. Plano de expurgo (Fase 0)

Ordem pensada para manter `npm test` verde a cada passo.

1. **Congelar o estado atual** em uma branch (`legado-abastece-ja`). Não migrar dados: projeto Firebase novo.
2. **Remover módulos isolados** (sem dependência de entrada): B2B/parceiro, Eneagrama, migração, `regras.js` (guardando antes as duas funções de conflito de agenda), relâmpago.
   Remover também: entradas no `for` de `server/server.js` (`b2b`, `relampago`), em `PAINEIS`, no regex de limitação de taxa, e testes correspondentes.
3. **Remover execução GPS + foto**: tirar `exigeExecucao`/`fase` de `pagamentos.js` e `reputacao.js`; substituir pela confirmação mútua da Fase 2. Manter `camera.js` e `lib/imagem.js`.
4. **Remover treinamento/habilitação**: tirar a claim `treinado` de `firestore.rules`, `auth` e `aulas.js`; excluir a aba `treino` do personal; liberar a aprovação **só pelo CREF** (já conferido pelo admin).
5. **Remover reputação/níveis/vidas/relâmpago/gamificação**; `calcularPreco` passa a ter **uma** taxa percentual (sem `nivel`, `bonus`, `royalty`); apagar claim `banido`.
6. **Renomear** `aulas` → `sessoes` e aplicar o glossário (`ESQUELETO-TECNICO.md` §8): comissão → taxa da plataforma, missão/serviço → sessão, chamado → ticket de suporte, nota → recibo. Corrigir os rastros do achado H5.
7. **Telas:** retirar abas "ofertas" e "treino"/"habilitação", radar/mapa, "Chamar agora"; admin sem "Missões" e sem "Catálogo de capacitação"; ajustar `index.html`/`personal.html` para as abas-alvo.
8. **Landing, manifest, SW e metadados:** reescrever textos (achado H4), incrementar a versão do cache do service worker.
9. **Firestore:** remover do `firestore.rules` e do `firestore.indexes.json` as coleções/índices de 🗑️; publicar regras e índices **juntos** com o novo front.
10. **Testes:** apagar os testes dos módulos removidos; manter paridade navegador × servidor só para o que sobrou (taxa, modalidades, conflito de agenda).
11. **Verificação final:** busca textual com os termos do §3 deve retornar zero fora de `AUDITORIA-ESCOPO.md` e do glossário.

**Riscos:** (a) `treinado`/`banido` são claims lidas em vários pontos — remover de uma vez evita personais "travados"; (b) `server/lib/config.js` e `config.js` são espelhos conferidos por teste — alterar os dois juntos; (c) o front antigo quebra com regras novas — publicar tudo junto.

---

## 6. Reaproveitamento

| Peça | Uso no novo escopo |
|---|---|
| Autenticação, claims, MFA de admin, auditoria, cifragem de CPF/Pix, índice cego | ✅ integral |
| Painel de TI (operadores, auditoria encadeada, tickets, métricas, presença) | ✅ integral |
| Suporte e recado, push, PWA, tema | ✅ |
| `taxas.js` (versionamento, congelamento, validação em centavos) | 🔧 base do financeiro (taxa percentual + planos) |
| `pagamentos.js` (checkout, webhook assinado, reconsulta de valor, idempotência) | 🔧 base de cobranças |
| `carteira.js` (ledger imutável, estorno atômico, conciliação) | 🔧 só se a decisão D2 for "carteira interna" |
| Conflito de horário (`aulasConflitam`) e calendário do front | 🔧 base da agenda |
| `camera.js`, `lib/imagem.js` | ✅ fotos de progresso (mudando o destino para Storage) |
| Lista de modalidades | ✅ categorias de plano/ficha |

---

## 7. O que esta entrega alterou

- **Criados:** `ESQUELETO-TECNICO.md`, `AUDITORIA-ESCOPO.md`.
- **Reescrito:** `README.md`.
- **Removidos (documentos que descreviam o produto anterior ou contradiziam o código):** `ATUALIZACAO.md`, `LEIA-ME-ATUALIZACAO.txt`, `ENEAGRAMA-AUTOMATICO.md`, `TAXAS-DINAMICAS.md`, `NOTA-COMPROVANTE.md`. O conteúdo útil (taxas versionadas, comprovante verificável) está resumido em `ESQUELETO-TECNICO.md` §4.4.
- **Ajustados:** `SEGURANCA.md`, `TI-MODULO.md`, `DEPLOY-RENDER.md` (aviso de escopo e correção de termos).
- **Não alterado:** todo o código, telas, regras do Firestore, índices e testes. O expurgo do §5 é a próxima etapa.
- **Referências pendentes:** dois comentários de código ainda apontam para documentos removidos (`server/lib/eneagrama.js:2` → `ENEAGRAMA-AUTOMATICO.md`; `server/server.js:10` → `NOTA-COMPROVANTE.md`). Somem com o expurgo dos passos 2 e 6.
