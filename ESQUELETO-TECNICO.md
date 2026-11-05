# PersoNOW — Esqueleto técnico

> Documento de referência do produto-alvo. Descreve **o que o PersoNOW é** e como cada módulo deve ser construído.
> O que ainda existe no código e não pertence a este escopo está listado em [`AUDITORIA-ESCOPO.md`](AUDITORIA-ESCOPO.md).

**Legenda de status** (coluna "Hoje" nas tabelas): ✅ já existe e fica · 🔧 existe e precisa ser adaptado · 🆕 não existe, construir · 🗑️ existe e deve sair.

---

## 1. Proposta de valor

O PersoNOW conecta **exclusivamente Personal Trainers a Alunos** para:

1. **Prescrição de treinos** — fichas, periodização e execução com registro de cargas;
2. **Agendamento de sessões** — presenciais ou de consultoria online;
3. **Acompanhamento da evolução física** — cargas, medidas, dobras cutâneas e fotos;
4. **Gestão de pagamentos de assessorias e pacotes** — mensalidades, pacotes de sessões e repasse seguro ao personal.

A relação central do produto é o **vínculo contínuo** entre um personal e um aluno. Tudo (treinos, agenda, evolução, cobranças, chat) pertence a um vínculo.

### Fora de escopo (não construir, não documentar, não manter)

Lojas, lojistas, vitrine, catálogo, produtos, estoque, carrinho, pedidos de loja, frete/entrega, comissão sobre produto físico, parceiros/indústrias com painel B2B, auditoria de ponto de venda, reposição, missões de campo. O **único** item comercializado na plataforma é um **serviço de treino** (sessão, pacote ou assessoria).

---

## 2. Perfis de usuário

| Perfil | Claim (`role`) | Quem é | Acesso |
|---|---|---|---|
| **Personal Trainer** | `personal` | Profissional com CREF, 18+, aprovado pela equipe | `/painel-personal` |
| **Aluno** | `aluno` | Pessoa que contrata um personal | `/painel-aluno` |
| Admin | `admin` | Equipe do PersoNOW: aprovação de CREF, financeiro, moderação | `/painel-admin` |
| TI | `ti` | Suporte e auditoria interna (ver [`TI-MODULO.md`](TI-MODULO.md)) | `/painel-ti` |

Admin e TI são papéis **operacionais** da plataforma; não são perfis de negócio. O perfil `parceiro` (academias/indústrias) **deixa de existir**.

### 2.1 Personal Trainer

| Faz | Módulo |
|---|---|
| Convida alunos (link/código) e gerencia a carteira de alunos | Vínculos |
| Cria fichas de treino (musculação, cardio, funcional), define periodização e reaproveita modelos | Treinos |
| Define agenda: horários disponíveis, locais, modalidades presencial/online, política de cancelamento | Agenda |
| Acompanha o progresso: cargas, aderência, medidas, fotos, metas | Evolução |
| Define valores de consultoria e pacotes; acompanha recebimentos e repasses | Financeiro |

### 2.2 Aluno

| Faz | Módulo |
|---|---|
| Aceita convite e vê o treino do dia | Vínculos / Treinos |
| Executa os exercícios (vídeo e instruções), registra cargas, repetições e feedback | Treinos |
| Agenda, remarca e cancela sessões nos horários do personal | Agenda |
| Registra peso, medidas e fotos; acompanha sua evolução | Evolução |
| Contrata plano/pacote, paga e consulta recibos | Financeiro |

---

## 3. Núcleo: vínculo personal ↔ aluno

`vinculos/{id}` é a entidade que liga as duas pontas e é a **fronteira de permissão** de todos os módulos.

```
convites/{codigo}  ──aceite do aluno──▶  vinculos/{id}
   personalUid, expiraEm, uso único        personalUid, alunoUid, status, planoId?, criadoEm
                                           status: convite → ativo ⇄ pausado → encerrado
```

Regras:
- Só os dois participantes (e o admin, auditado) leem dados do vínculo. Aluno de outro personal recebe **404**, nunca 403.
- Encerrar o vínculo **preserva o histórico** (treinos, medidas, financeiro) e remove o acesso de escrita do personal.
- O aluno pode ter mais de um personal (ex.: musculação e corrida); cada vínculo é independente.

> **Decisão D1 (em aberto):** como o aluno encontra o personal? **Recomendado:** só por convite do personal (link/código/QR) na v1; diretório público com busca opcional numa fase posterior. O código atual descobre personais por região/GPS ("Perto de mim", radar), o que é lógica de marketplace sob demanda e sai na Fase 0.

---

## 4. Módulos

### 4.1 Gestão de Treinos

**Objetivo:** o personal prescreve, o aluno executa e registra, ambos veem a progressão.

| Entidade | Coleção | Campos principais | Hoje |
|---|---|---|---|
| Exercício | `exercicios` | nome, grupoMuscular, equipamento, tipo (`forca`·`cardio`·`funcional`·`mobilidade`), videoUrl, instrucoes, autor (`global`/uid do personal) | 🆕 |
| Ficha | `fichas` | vinculoId (ou `modelo: true`), nome, objetivo, modalidade, periodizacao, status (`rascunho`·`ativa`·`arquivada`), versao | 🆕 |
| Treino da ficha | `fichas/{id}/treinos` | rótulo (A/B/C), diasSemana, itens[] | 🆕 |
| Item do treino | dentro do treino | exercicioId, ordem, séries, repetições (faixa), cargaPrevistaKg, descansoSeg, cadência, observação; cardio: duração, zona, distância | 🆕 |
| Periodização | dentro da ficha | fases[{nome, semanas, foco, volume/intensidade}], início, fim | 🆕 |
| Execução | `execucoes` | vinculoId, fichaId, treinoId, data, séries[{exercicioId, reps, cargaKg, rpe}], esforçoPercebido, feedback, duraçãoMin | 🆕 |
| Progressão | `progressao/{vinculo_exercicio}` | cargaMax, volumeSemanal, 1RM estimado, série temporal (agregada na gravação da execução) | 🆕 |

**Regras**
- Só o personal do vínculo cria/edita ficha; só o aluno do vínculo grava execução (e só do treino da ficha **ativa**).
- Editar uma ficha em uso cria **nova versão**; execuções antigas continuam apontando para a versão em que foram feitas.
- Validação no servidor: carga 0–1000 kg em passos de 0,5; reps 1–200; séries 1–20; descanso 0–900 s; tamanhos máximos de texto.
- Histórico de execuções e **gráficos**: carga máxima por exercício, volume semanal (séries × reps × carga), aderência (% de treinos prescritos que foram feitos).
- Vídeos de exercício: URL de provedor externo (ou Storage); a API valida host permitido. Nada de upload de vídeo pesado no servidor.

**Reaproveitável do código atual:** lista de modalidades (`MODALIDADES` em `core.js`/`server/lib/config.js`) ✅ como categorias; `camera.js` ✅; padrão de validação estrita (`server/lib/validacao.js`) ✅.

### 4.2 Agenda / Agendamento

**Objetivo:** marcar aulas presenciais ou consultoria online dentro dos horários que o personal publica.

| Entidade | Coleção | Campos principais | Hoje |
|---|---|---|---|
| Disponibilidade | `disponibilidade/{personalUid}` | grade semanal [{diaSemana, início, fim, tipo (`presencial`·`online`), local}], duraçãoPadrãoMin, antecedênciaMinH, janelaCancelamentoH | 🔧 (hoje só `inicio`/`fim` simples em `personais.disponibilidade`) |
| Bloqueio | `bloqueios` | personalUid, de, até, motivo | 🆕 |
| Sessão | `sessoes` (hoje `aulas`) | vinculoId, personalUid, alunoUid, início, fim, modalidade (`presencial`·`online`), local ou linkOnline, status, origem (`avulsa`·`pacote`·`recorrente`), consumoPacoteId, canceladoPor, motivo | 🔧 |
| Recorrência | `recorrencias` | vinculoId, regra semanal, geraAté | 🆕 |

**Status da sessão:** `solicitada → confirmada → concluida` · `cancelada` · `falta_aluno` · `falta_personal` · `remarcada`.

**Regras**
- Os **slots livres** são calculados no servidor: grade de disponibilidade − bloqueios − sessões ocupadas. O cliente nunca decide conflito.
- Conflito de horário: `aulasConflitam`/`conflitoNaAgenda` ✅ (encostar fim/início não é conflito).
- Cancelamento tardio (janela configurável pelo personal, padrão 12 h): sessão de pacote **é debitada**; sessão avulsa paga segue a política do plano. Hoje existe `CANCELAMENTO_TARDIO_HORAS = 12` ✅ 🔧.
- Confirmação de realização: o personal marca "realizada" e o aluno confirma (ou contesta em até 24 h). **Substitui** check-in por GPS + foto do local.
- Lembretes por push (`push.js`) ✅ 24 h e 1 h antes. Exportar `.ics` é opcional.
- Online: o campo `linkOnline` é do personal (Meet/Zoom/etc.); o PersoNOW não hospeda vídeo.

### 4.3 Evolução e Biometria

**Objetivo:** histórico corporal do aluno, visível ao personal do vínculo.

| Entidade | Coleção | Campos principais | Hoje |
|---|---|---|---|
| Medidas | `medidas` | vinculoId, data, pesoKg, alturaCm, circunferências (pescoço, ombro, tórax, cintura, abdômen, quadril, braço D/E, antebraço, coxa D/E, panturrilha D/E), dobras cutâneas em mm (tríceps, subescapular, peitoral, axilar média, suprailíaca, abdominal, coxa), protocolo, registradoPor | 🆕 |
| Composição (derivada) | calculada | IMC, %gordura (protocolo escolhido: 3 ou 7 dobras + equação de densidade corporal), massa magra, massa gorda | 🆕 |
| Fotos de progresso | `fotos_progresso` | vinculoId, data, pose (`frente`·`lado`·`costas`), caminho no Storage, sha256, visibilidade | 🆕 |
| Metas | `metas` | vinculoId, tipo (peso, %gordura, medida, carga), alvo, prazo, status | 🆕 |

**Regras**
- Cálculos de composição em módulo **puro e testável** (`server/lib/biometria.js`), espelhado no front só para exibição; o servidor recalcula.
- Faixas de validação por campo (ex.: peso 20–400 kg; dobra 1–80 mm); datas não podem estar no futuro.
- **Comparativo de fotos:** o usuário escolhe duas datas e a mesma pose; a tela mostra lado a lado.
- **Gráficos:** peso, cada circunferência, %gordura e carga por exercício, com a mesma escala de tempo.
- Quem registra: o aluno (peso, fotos, circunferências) e o personal (dobras, avaliação). Cada registro guarda o autor.

**Reaproveitável:** `camera.js` ✅ (captura/compressão no cliente), `server/lib/imagem.js` ✅ (validação de JPEG).
**Mudança obrigatória:** hoje as fotos de check-out ficam **em base64 dentro do Firestore** (`fotos_checkout`). Fotos corporais devem ir para o **Storage**, com URL assinada de vida curta e acesso só pelo vínculo.

### 4.4 Financeiro / Assinaturas

**Objetivo:** o personal define o que vende; o aluno paga; o personal recebe com segurança.

| Entidade | Coleção | Campos principais | Hoje |
|---|---|---|---|
| Plano | `planos` | personalUid, tipo (`assessoria_mensal`·`pacote_sessoes`·`sessao_avulsa`·`consultoria_online`), nome, valorCentavos, recorrência (`mensal`·`trimestral`·`unica`), sessõesIncluídas, validadeDias, ativo | 🆕 |
| Assinatura | `assinaturas` | vinculoId, planoId, **valor e taxa congelados**, status (`pendente`·`ativa`·`inadimplente`·`pausada`·`cancelada`·`encerrada`), próximaCobrança, saldoSessoes | 🆕 |
| Cobrança | `cobrancas` (hoje `pagamentos_internos`) | assinaturaId, competência, valor, vencimento, status (`pendente`·`paga`·`vencida`·`estornada`), método (`pix`·`cartao`), idDoGateway, pagoEm | 🔧 |
| Lançamento / repasse | `lancamentos`, `repasses` | ledger imutável e idempotente | ✅ (se D2 = B) |
| Recibo | `recibos` (hoje `notas`) | cobrançaId, número, valores, verificação pública | 🔧 |

**Regras**
- **Preço congelado por assinatura:** o que o aluno viu ao contratar é o que é cobrado, mesmo que o admin mude a taxa depois. O mecanismo de taxas versionadas e a validação em centavos inteiros já existem em `server/lib/taxas.js` ✅ 🔧.
- **Taxa da plataforma** = percentual sobre cada cobrança de serviço, editável pelo admin (versionado, auditado). Substitui o modelo "aula fixa de R$ 100 / comissão / níveis".
- Webhook do gateway **assinado e reconsultado** (valor ao centavo, referência, idempotência) ✅ — `server/rotas/pagamentos.js`.
- Cobrança mensal gerada pelo servidor (cron `POST /interno/manutencao`, já existente ✅) com Pix/cartão pelo checkout atual.
- Inadimplência: lembrete → carência configurável → bloqueio de **novos agendamentos** (o treino já prescrito não é bloqueado). Nunca apagar histórico.
- Pacote de sessões: saldo debitado quando a sessão é `concluida` (ou falta tardia); expira em `validadeDias`.
- Estorno desfaz cobrança, repasse e taxa de forma atômica ✅ (`server/lib/carteira.js`).

> **Decisão D2 (em aberto) — como o dinheiro chega ao personal.**
> **A (recomendado):** split nativo do gateway (o valor do personal nunca fica em conta da plataforma). Reduz risco regulatório de custódia.
> **B:** manter a carteira interna + saque manual (o que existe hoje em `carteira.js`). Funciona, mas a plataforma passa a guardar dinheiro de terceiros; o próprio histórico do projeto (`ATUALIZACAO.md`, removido) já apontava esse risco. Validar com contador/advogado.
> Antes de implementar A, **confirmar na documentação atual do Mercado Pago** o que o split e as assinaturas recorrentes suportam; este documento não verificou isso.

> **Decisão D3 (em aberto) — fiscal.** Hoje o "comprovante" usa layout de DANFE (documento de NF-e, conceito de venda de mercadoria). Para serviços de treino o correto é um **recibo simples** de pagamento. A emissão de nota de serviço pelo personal (MEI/autônomo) e pela plataforma sobre a taxa deve ser definida com um contador.

---

## 5. Modelo de dados (Firestore)

Princípio mantido: **deny-by-default** em `firestore.rules`; o navegador lê o que é seu e quase não escreve; regra de negócio, dinheiro e dados sensíveis só no servidor.

| Grupo | Coleções | Destino |
|---|---|---|
| Identidade | `usuarios`, `alunos`, `personais`, `personais_privado` (CPF/Pix cifrados) | ✅ manter |
| Vínculo | `convites`, `vinculos`, `vinculos/{id}/mensagens` (chat) | 🆕 (chat 🔧 sai de `aulas/{id}/mensagens`) |
| Treinos | `exercicios`, `fichas`, `fichas/{id}/treinos`, `execucoes`, `progressao` | 🆕 |
| Agenda | `disponibilidade`, `bloqueios`, `sessoes`, `recorrencias` | 🆕 / 🔧 `aulas` → `sessoes` |
| Evolução | `medidas`, `fotos_progresso`, `metas` | 🆕 |
| Financeiro | `planos`, `assinaturas`, `cobrancas`, `recibos`, `lancamentos`, `repasses`, `estornos`, `configuracoes/taxas` | 🔧 / 🆕 |
| Plataforma | `auditoria`, `suporte_*`, `push_tokens`, `ti_*`, `chamados_ti`, `presenca_instancias` | ✅ manter |
| **Remover** | `parceiros`, `fotos_checkout`, `presencas`, `alertas_personal`, `treinamento_modulos`, `treinamento_progresso`, `habilitacao_categorias`, `habilitacao_sessoes`, `reputacao`, `infracoes`, `niveis_historico`, `eneagrama_resultados`, `eneagrama_lotes`, `aulas_financeiro` | 🗑️ |

Índices novos previstos: `sessoes(personalUid, inicio)`, `sessoes(alunoUid, inicio)`, `execucoes(vinculoId, data desc)`, `medidas(vinculoId, data desc)`, `cobrancas(assinaturaId, vencimento)`, `cobrancas(status, vencimento)`.

---

## 6. API (resumo por módulo)

Todas exigem token verificado com checagem de revogação; papéis conforme a coluna. Corpo JSON, validação estrita, erros com `codigo`.

| Módulo | Rota | Papel |
|---|---|---|
| Vínculos | `POST /vinculos/convites` · `POST /vinculos/convites/:codigo/aceitar` · `GET /vinculos` · `POST /vinculos/:id/{pausar,encerrar}` | personal / aluno |
| Treinos | `GET·POST /exercicios` · `GET·POST·PUT /fichas` · `POST /fichas/:id/{ativar,duplicar,arquivar}` · `GET /treino/hoje` · `POST /execucoes` · `GET /progressao?exercicioId=` | personal / aluno |
| Agenda | `PUT /agenda/disponibilidade` · `GET /agenda/slots?personalUid=&de=&ate=` · `POST /sessoes` · `POST /sessoes/:id/{confirmar,cancelar,remarcar,realizada,contestar}` | personal / aluno |
| Evolução | `POST·GET /medidas` · `POST /fotos-progresso` · `GET /fotos-progresso/:id` (URL assinada) · `GET /evolucao/comparativo` · `POST·GET /metas` | aluno / personal |
| Financeiro | `POST·GET /planos` · `POST /assinaturas` · `POST /assinaturas/:id/{pausar,cancelar}` · `GET /cobrancas` · `POST /cobrancas/:id/pagar` · `POST /webhookMP` · `GET /financeiro/resumo` · `GET /recibos/:id` | personal / aluno |
| Admin | `PUT /admin/taxas` · aprovação de CREF · estornos · conciliação · auditoria (já existem ✅) | admin |

---

## 7. Segurança e LGPD

O modelo de segurança atual (ver [`SEGURANCA.md`](SEGURANCA.md)) **permanece**: RBAC por claim, deny-by-default, cifragem em repouso, auditoria, CSP, rate limit, webhook assinado. Acrescenta-se, por causa do novo escopo:

- **Dados de saúde e imagem corporal são dados pessoais sensíveis** (LGPD, art. 11). Exigem consentimento específico e destacado do aluno para medidas e fotos; registrar data, versão do texto e revogação.
- **Fotos:** Storage privado, URL assinada de curta duração, acesso só pelos dois participantes do vínculo (+ admin auditado), nunca em coleção pública, nunca em base64 no Firestore.
- **Direitos do titular:** exportar e excluir os próprios dados (medidas, fotos, execuções) pela API; encerrar o vínculo não apaga automaticamente — o aluno decide.
- **Retenção:** política definida (ex.: apagar fotos X meses após encerramento, se o aluno pedir). Valor a definir com o jurídico.
- **Menores de 18:** aluno menor exige responsável e tratamento específico (LGPD, art. 14). Hoje o código aceita aluno 16+; confirmar a regra com o jurídico antes de abrir cadastro.
- **Conteúdo prescrito:** o PersoNOW é ferramenta de trabalho do profissional; a responsabilidade técnica da prescrição é do personal (CREF). Isso precisa constar nos Termos.
- **Chat:** ver decisão D4 abaixo.

> **Decisão D4 (em aberto) — filtro anti-contato no chat.** Hoje `mensagemSuspeita` bloqueia telefone, e-mail, "whatsapp", "pix" etc. É um mecanismo de marketplace para evitar que as partes negociem fora da plataforma. Num vínculo contínuo entre personal e aluno ele atrapalha o uso real (combinar horário, enviar link da chamada). **Recomendado:** remover.

---

## 8. Glossário — vocabulário PersoNOW

| Termo legado (não usar) | Termo PersoNOW |
|---|---|
| loja, lojista, ponto de venda | **local de treino** (academia, estúdio, parque, domicílio) |
| produto, estoque, pedido, carrinho, vitrine | *(não existem)* — o que se contrata é **plano**, **pacote** ou **sessão** |
| pedido de aula, chamado, chamar agora, relâmpago | **solicitação de sessão** / **sessão** |
| missão, serviço (de campo), promotor | **sessão** / **personal trainer** |
| comissão, royalty | **taxa da plataforma** |
| repasse | **repasse** (mantém: valor que vai ao personal) |
| carteira digital | **recebimentos** (ou "carteira" só se D2 = B) |
| parceiro, indústria, B2B | *(removido)* |
| treinamento (curso de habilitação do personal) | *(removido)*; **treino** = prescrição ao aluno |
| nível Bronze/Prata/Ouro/Platina | *(removido)* |
| nota / DANFE | **recibo** |
| chamado (ticket de TI) | **ticket de suporte** (único uso permitido de "chamado") |

---

## 9. Telas-alvo

**Aluno** (barra inferior): **Hoje** (treino do dia + próxima sessão) · **Treinos** (fichas e histórico) · **Agenda** · **Evolução** · **Pagamentos** · **Menu** (perfil, chat, suporte).
**Personal:** **Alunos** (carteira, convites, aderência) · **Treinos** (construtor de fichas e modelos) · **Agenda** (grade e sessões) · **Financeiro** (planos, assinaturas, recebimentos) · **Menu**.

Telas atuais do aluno: `home · aulas · agenda · carteira · chat · menu`. Do personal: `inicio · ofertas · agenda · carteira · treino · chat · menu` — onde `treino` é o **curso de habilitação**, não prescrição de treinos (colisão de nome; ver auditoria).

---

## 10. Estrutura de código-alvo

Mantém a stack atual (HTML + ES modules sem bundler, Firebase Auth/Firestore, Express no Render, Mercado Pago). Novos arquivos, por módulo:

```
server/rotas/   vinculos.js · treinos.js · agenda.js · evolucao.js · financeiro.js   (🆕)
server/lib/     periodizacao.js · progressao.js · slots.js · biometria.js · cobrancas.js   (🆕, funções puras com teste)
server/rotas/   conta.js · admin.js · pagamentos.js · suporte.js · ti.js             (✅ 🔧)
front           aluno-*.js · personal-*.js por aba; core.js só com constantes e funções puras
test/           um arquivo por módulo; paridade navegador × servidor para as funções puras
```

---

## 11. Roadmap

| Fase | Entrega | Pronto quando |
|---|---|---|
| **0 — Expurgo** | Remover o que está em 🗑️; renomear vocabulário; `aulas` → `sessoes`; limpar telas, regras, índices, testes e landing | `npm test` verde; nenhum termo do glossário legado no código; regras do Firestore sem coleções removidas |
| **1 — Vínculo + Treinos** | Convites, vínculos, biblioteca de exercícios, construtor de fichas, execução com cargas, gráficos de progressão | Personal prescreve e aluno executa e vê a evolução de carga |
| **2 — Agenda** | Disponibilidade, slots, sessões, cancelamento/remarcação, lembretes, confirmação mútua | Aluno marca sessão num slot livre; conflito impossível |
| **3 — Evolução** | Medidas, dobras, composição, fotos no Storage, comparativo, metas, consentimento LGPD | Comparativo de fotos e gráficos de medidas funcionando |
| **4 — Financeiro** | Planos, assinaturas, cobranças recorrentes, inadimplência, pacotes, recibos, repasse (D2) | Aluno paga a mensalidade e o personal vê o recebimento |
| **5 — Endurecimento** | Testes de regras com Emulator, MFA de admin, App Check, backup de chaves, revisão jurídica | Checklist de `SEGURANCA.md` completo |

---

## 12. Decisões em aberto

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Como o aluno encontra o personal? | Só convite na v1 |
| D2 | Split do gateway ou carteira interna? | Split do gateway (validar capacidades no Mercado Pago) |
| D3 | Documento fiscal / recibo | Recibo simples; fiscal definido com contador |
| D4 | Filtro anti-contato no chat | Remover |
| D5 | Aluno menor de 18 | Definir com jurídico antes de abrir cadastro |
