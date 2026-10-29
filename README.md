# PERSONOW — personal trainers sob demanda

O aluno pede uma aula na sua academia, personais da região aceitam, o aluno paga depois do treino (Pix ou cartão, Mercado Pago) e o repasse ao personal é automático.

## Arquitetura

| Camada | Arquivos |
|---|---|
| App do aluno | `index.html`, `script.js` |
| App do personal | `personal.html`, `script-personal.js` |
| Pagamento e recibo | `pagar.html`, `recibo.html` |
| Compartilhado (navegador) | `config.js` (regras e constantes), `core.js` (funções puras), `firebase.js`, `ui.js`, `sw.js` |
| Servidor (Render) | `server/server.js`, `server/regras.js` |
| Segurança | `firestore.rules`, `database.rules.json` |
| Migração | `scripts/migrar-dados.cjs` |

**Princípio:** o navegador só lê dados em tempo real. Criar aula, aceitar, chat, avaliar, cobrar e emitir recibo passam pelo servidor, que é quem valida e grava. As regras do Firestore impedem o navegador de fazer isso direto.

## Regras de negócio (`config.js` ⇄ `server/regras.js`)

- Comissão da plataforma: **15%** do valor da aula (o personal recebe 85%, arredondamento sempre a favor dele). Taxa fixa opcional: `TAXA_FIXA_CENTAVOS` (hoje 0).
- Aula: de **30 min a 3 h**, valor de **R$ 30 a R$ 1.000**. Foco: Musculação, Hipertrofia, Emagrecimento, Corrida, Funcional, Avaliação Física.
- Personal não aceita aulas com **choque de horário** (aulas coladas, 10–11 e 11–12, são permitidas).
- "Chamar agora": o pedido fica reservado ao personal escolhido por **5 min**.
- Aluno pode ter no máximo **5 pedidos em aberto**.
- Chat: telefone, e-mail, links e Pix são bloqueados no servidor; a infração é registrada e a reincidência vai para revisão manual (não há banimento automático).
- Avaliação: uma por aula, só depois de paga, calculada no servidor.
- O pagamento só é aceito se o valor pago bater **ao centavo** e a referência for da aula.

`npm test` confere que navegador e servidor têm as mesmas constantes e o mesmo resultado para **todos** os valores de R$ 30 a R$ 1.000.

## Rodar os testes

```bash
npm install
npm test                         # regras, servidor completo (fakes em memória), migração
npm i -D playwright && npx playwright install chromium
node test/e2e.browser.cjs        # as 4 páginas no Chromium com Firebase falso
```

## Publicar

1. **Firebase:** `firebase deploy --only firestore:rules,database` (ative Authentication → Google e o Realtime Database).
2. **Render:** crie um **Web Service** (não Static Site) a partir do `render.yaml` e preencha:
   `FIREBASE_SERVICE_ACCOUNT` (JSON ou base64), `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`, `APP_URL` (https, sem barra final).
3. **Mercado Pago:** no app, cadastre a Redirect URL `https://SEU-APP.onrender.com/mpCallback` e o webhook `https://SEU-APP.onrender.com/webhookMP` (evento *Pagamentos*). `GET /diagnostico` lista o que falta configurar.
4. **`config.js`:** ajuste `URL_RENDER`, `EMPRESA` (razão social/CNPJ do recibo) e `WHATSAPP_SUPORTE`.
5. **Aprovação de personais:** no console do Firestore, depois de conferir CPF e CREF em `personais_privado/{uid}` e `personais/{uid}`, mude `status` de `pendente` para `ativo`.

## Migrar os dados antigos

```bash
node scripts/migrar-dados.cjs            # simulação
node scripts/migrar-dados.cjs --aplicar  # grava (não apaga nada do antigo)
```
Renomeia `contratantes→alunos`, `profissionais→personais (+personais_privado)`, `solicitacoes→aulas` (`loja→local`, `promotor*→personal*`, valores em centavos). Personais cujo documento tinha o CPF como id e sem conta Google **não** podem ser migrados: entram de novo pelo Google.


## Atualização (segurança, admin, perfil inteligente)
Veja **ATUALIZACAO.md** (o que entrou, o que ficou de fora e a ordem de publicação). Novos comandos: `npm run gerar-chaves`, `npm run migrar-cripto`, `npm run definir-admin -- email`. Painel: `/admin.html`.
