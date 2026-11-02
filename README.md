# Personow

Marketplace sob demanda (estilo Uber) que conecta **Alunos** a **Personal Trainers** registrados no CREF, para aulas e consultorias de treino.

- **Modelo (padrão, ajustável no Admin → Taxas):** aula de **R$ 100,00** → **R$ 25,00** de comissão da plataforma (nível Bronze) + **R$ 75,00** na carteira digital do personal. Níveis Bronze/Prata/Ouro/Platina reduzem a comissão para 25/20/15/10%.
- **Papéis:** `aluno` · `personal` (18+ e CREF, aprovado pelo admin) · `admin` · `ti` · `parceiro` (academias/estúdios, painel B2B).
- **Stack:** HTML/CSS/JS (módulos ES, sem bundler) + Firebase Auth/Firestore + servidor Node/Express (Render) + Mercado Pago.
- **Regras de negócio e dinheiro vivem no servidor** (`server/`). O navegador só exibe.
- **Login:** e-mail/senha (com verificação de e-mail) e Google (popup, com fallback para redirect). Cada portal (aluno, personal, admin, TI, parceiro) usa um app Firebase e chaves de armazenamento próprios (`portal.js`), então as sessões não se misturam.

## Coleções principais (Firestore)
`alunos` · `personais` · `personais_privado` (dados sensíveis cifrados) · `aulas` · `pagamentos_internos` · `carteiras` · `lancamentos` · `saques` · `reputacao` · `habilitacao_categorias` · `treinamento_modulos` · `suporte_conversas` · `parceiros` · `configuracoes`

```
server/  server.js (composição + hardening) · split.js (modelo financeiro) · lib/ (cripto, validação, carteira, treinamento, habilitação, segurança) · rotas/
*.html + *.js   aluno (index), personal (personal), admin, ti, parceiro, pagar, nota, landing
portal.js · firebase.js · acesso.js · login-email.js · entrada.js   (autenticação e isolamento de sessão)
firestore.rules · firestore.indexes.json · scripts/ (definir-admin, gerar-chaves, migrar-dados, semear-categorias) · test/
```

## Rodar
```bash
npm install --prefix server
npm test                      # paridade navegador×servidor + testes de backend (sem rede)
MODO_TESTE=1 npm start        # sandbox local: contas fictícias e pagamento simulado (proibido em produção)
```

## Antes de publicar
1. Firebase: crie o projeto, ative **E-mail/Senha** e **Google** em Authentication, autorize o domínio do site e cole os dados do app web em `config.js` (`FIREBASE_CONFIG`).
2. Render: defina as variáveis do `render.yaml` (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `APP_URL`, `MP_*`, chaves de criptografia — `npm run gerar-chaves`).
3. Admin: informe seu e-mail em `ADMIN_BOOTSTRAP_EMAIL` (ou `node scripts/definir-admin.js seu@email`).
4. Ajuste `EMPRESA` (razão social/CNPJ) em `config.js` e `server/lib/config.js` — o teste de paridade confere os dois.
5. `node scripts/semear-categorias.cjs` cria as 6 categorias de habilitação (inativas); no Admin informe vídeo e revise as perguntas com um profissional de Educação Física.

**Painel de TI** (`/painel-ti`): veja **TI-MODULO.md**. Segurança: **SEGURANCA.md**. Taxas: **TAXAS-DINAMICAS.md**. Deploy: **DEPLOY-RENDER.md**.
