# Deploy no Render

O servidor (`server/`) serve a API **e** o site; use **Web Service** (não Static Site). O `render.yaml` já lista todas as variáveis.

1. Conecte o repositório no Render (Blueprint) · `rootDir: server` · build `npm install` · start `npm start` · health check `/saude`.
2. Variáveis obrigatórias em produção: `AMBIENTE=producao`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `APP_URL`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `DATA_ENCRYPTION_KEYS`, `DATA_ENCRYPTION_KEY_ID`, `BLIND_INDEX_KEY` (gere com `npm run gerar-chaves`). `MODO_TESTE` é recusado em produção.
3. Firebase → Authentication: ative **E-mail/Senha** e **Google** e inclua o domínio do Render em *Domínios autorizados*. Para login Google por redirecionamento no mesmo domínio, adicione `https://SEU-SERVICO.onrender.com/__/auth/handler` nas URIs de redirecionamento do cliente OAuth.
4. Cron de manutenção: chame `POST /interno/manutencao` com o header `x-cron-secret` (já previsto no `render.yaml`).
5. Primeiro admin: `ADMIN_BOOTSTRAP_EMAIL` (remova depois de entrar) ou `node scripts/definir-admin.js seu@email`.

Para homologação use `AMBIENTE=homolog` + `MODO_TESTE=1`.
