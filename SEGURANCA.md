# Segurança — modelo de ameaças, mapeamento OWASP e checklist de pentest

## 1. Arquitetura de confiança
- **Navegador = não confiável.** Preço, split, status de aula, idade, treinamento, papel, saldo e notas são decididos **só no servidor**.
- **Papéis (RBAC)** = custom claim assinada `role` ∈ `aluno | personal | admin` (+ `treinado`). Só o servidor/Admin SDK concede (`/cadastro/*`, `scripts/definir-admin.js`). Uma conta Google = um papel.
- **Firestore** em *deny-by-default* (`firestore.rules`): o cliente lê o que é seu e escreve apenas campos públicos de perfil (lista fechada). Dinheiro, dados sensíveis, treinamento, auditoria: nenhum acesso do cliente.
- **Dados sensíveis cifrados em repouso** (AES-256-GCM, AAD = coleção/campo/uid, chaves versionadas): CPF, nascimento, telefone, Pix, dados do responsável. CPF duplicado via índice cego HMAC.

## 2. OWASP Top 10 (2021)
| # | Risco | Controle implementado | Onde |
|---|-------|-----------------------|------|
| A01 | Broken Access Control / **IDOR** | `exigir(papel)` em toda rota; checagem de dono em transação; recurso alheio devolve **404** (não confirma existência); regras do Firestore por dono/papel; ofertas só com claim `treinado` | `lib/seguranca.js`, `rotas/*`, `firestore.rules` |
| A02 | Falhas criptográficas | AES-256-GCM com AAD, chaves por ambiente com rotação (`v1.`, `v2.`), HMAC para índice, HSTS, CPF mascarado nas notas e respostas | `lib/cripto.js` |
| A03 | **Injeção** (SQLi / NoSQLi / XSS / CSV) | Não há SQL (Firestore); o equivalente NoSQL é bloqueado por validação estrita de tipo/tamanho/enum (objeto no lugar de string → 400), IDs `^[\w-]{1,128}$`, *mass assignment* barrado por `somente()`/`soMuda()`. XSS: `esc()` em todo HTML dinâmico + **CSP sem `unsafe-inline` em scripts**. **CSV/formula injection** neutralizada | `lib/validacao.js`, `lib/csv.js`, CSP |
| A04 | Design inseguro | Ledger imutável + idempotência, transações, falha fechada (sem módulos de treino = ninguém habilitado), trava de data de nascimento/CPF, carência de saque, 24 h de trava após trocar Pix | `lib/carteira.js` |
| A05 | Configuração incorreta | Cabeçalhos (CSP, HSTS, XFO, nosniff, COOP, Permissions-Policy), CORS fechado, estáticos por allowlist (sem `server/`, `.rules`, `.env`), `MODO_TESTE` **proibido** em produção (o processo não sobe), segredos obrigatórios em produção | `server.js` |
| A06 | Componentes vulneráveis | Dependências mínimas (express, cors, firebase-admin). Rodar `npm audit` no CI | — |
| A07 | **Falhas de autenticação** | `verifyIdToken(checkRevoked=true)`; e-mail verificado; token **somente** no cabeçalho `Authorization` (removido de query/body); login recente (≤5 min) para Pix/saque/estorno; revogação de sessões ao bloquear; MFA obrigatório p/ admin (`ADMIN_EXIGE_MFA=1`); rate limit por IP e usuário | `lib/seguranca.js` |
| A08 | Integridade de software/dados | **Webhook do Mercado Pago com HMAC-SHA256** (`x-signature`, comparação em tempo constante); o corpo do webhook **não é confiável** — o pagamento é reconsultado na API e validado (referência, moeda, valor ao centavo); idempotência por id determinístico | `rotas/pagamentos.js` |
| A09 | Logging/monitoramento | Coleção `auditoria` (quem, papel, ação, alvo, IP, UA) para toda ação administrativa e financeira; erros internos nunca vazam stack | `lib/seguranca.js` |
| A10 | SSRF | O servidor só chama `api.mercadopago.com` (host fixo); URLs de vídeo `mp4` só `https` e só são usadas no navegador | — |

**CSRF:** a API usa token em cabeçalho (não cookie), então CSRF clássico não se aplica. Mesmo assim: métodos que alteram estado exigem `Content-Type: application/json` (força preflight CORS) e `Origin` na lista permitida.

## 3. Achados do código original (corrigidos)
1. **Escalada de privilégio**: regras permitiam ao usuário gravar o próprio `role`; o cliente alterava `status` de aulas direto (`updateDoc`) — avaliação, cancelamento e "desistir" agora passam pelo servidor.
2. **Estado OAuth (`/mpCallback`) estático e sem expiração**, vazável em URL → risco de vincular conta MP de terceiro. O fluxo foi **removido** (a plataforma recebe e repassa pela carteira).
3. **Webhook ausente** no servidor de produção (só em `functions/`, código duplicado e divergente). Implementado e assinado; `functions/` removido.
4. **Valor do pagamento não era comparado** (README dizia que sim). Agora conferido ao centavo.
5. **Token de login aceito em body/query** (vaza em logs/proxy). Só cabeçalho.
6. **CPF/nascimento/Pix em texto puro** e legíveis pelo cliente; **e-mail e IDs do gateway** expostos a todos os alunos. Cifrados/movidos para coleções só-servidor.
7. **Estáticos**: o servidor servia a raiz do repositório quase inteira. Agora allowlist.
8. `/cartao/remover` era chamada pelo app mas **não existia**. Criada.
9. `personalPreferido` casava por **nome** (colisão/fraude). Agora por UID.
10. `/diagnostico` e `/saude` revelavam configuração. Removido / mínimo.
11. Sem validação de idade alguma (só um campo de data). Agora 16+ no servidor, travada após gravada.

## 4. Riscos residuais (aceitos/pendentes) — leia antes de ir a produção
- **Rate limit em memória**: vale para 1 instância. Com escala horizontal, trocar por Redis/Upstash.
- **Perfil público `personais`** é legível por qualquer aluno com status `ativo` (nome, cidade, bio, nota). Não contém e-mail/CPF, mas o ideal é separar uma projeção pública (`personais_publico`).
- **Conciliação percorre coleções inteiras** (paginado). Ok até dezenas de milhares de lançamentos; depois, agendar/exportar para BigQuery.
- **Saque é aprovado e pago manualmente** (Pix feito pelo financeiro, comprovante registrado). Não há payout automático.
- **CSP** mantém `style-src 'unsafe-inline'` (muitos `style=""` no HTML). Risco baixo (sem execução de script), mas dá para eliminar refatorando.
- **Regras do Firestore** foram escritas e revisadas, mas só testáveis com o Emulator (`firebase emulators:exec`); recomendo rodar o conjunto de testes de regras antes de publicar.
- **Sem WAF/anti-bot** (reCAPTCHA/App Check) — recomendado ativar **Firebase App Check** e Cloudflare na frente.
- **Backup/recuperação das chaves de criptografia**: perder `DATA_ENCRYPTION_KEYS` = perder os dados cifrados.

## 5. Checklist de pentest (roteiro manual)
- [ ] Trocar `role`/`treinado`/`status` via SDK do Firestore com token de um personal → deve falhar (PERMISSION_DENIED).
- [ ] Personal chama `/criarAula`, `/admin/*`, `/aluno/exportar.csv` → 403. Aluno chama `/aceitarAula`, `/carteira` → 403.
- [ ] Trocar `aulaId` por IDs de outros alunos em `/cancelarAula`, `/criarCobranca`, `/confirmarPagamento`, `/desistirAula`, `/avaliarServico` → 404.
- [ ] Enviar `{"$ne":null}`/arrays/números onde se espera string em todas as rotas → 400.
- [ ] Webhook sem assinatura / com assinatura de outro `data.id` / replay → 401 / idempotente.
- [ ] `/confirmarPagamento` com `paymentId` de outra aula ou de valor menor → 400.
- [ ] Pular vídeo (seek para o fim), acelerar (playbackRate), enviar pings em rajada, repetir 1 trecho → módulo não conclui; `ping-rapido` 429.
- [ ] Cadastro com 15 anos 364 dias; datas 31/02, futuras, 1850 → recusado. Trocar nascimento depois de gravado → 409.
- [ ] Menor (16–17): aceitar aula noturno/modalidade vedado/sem responsável → 403.
- [ ] Concorrência: dois `aceitarAula` simultâneos; duas confirmações do mesmo pagamento; dois saques que somados excedem o saldo → um só vence / sem crédito duplo / `saldo-insuficiente`.
- [ ] CSV: nome de aluno `=HYPERLINK(...)` → aparece com apóstrofo.
- [ ] `curl -I` na raiz: CSP/HSTS/XFO presentes. `GET /server/server.js`, `/firestore.rules`, `/.env`, `/package.json` → 404.
- [ ] 6+ cadastros/minuto do mesmo IP → 429.
- [ ] Bloquear um personal no admin → próximas chamadas dele dão 401 (sessão revogada).
