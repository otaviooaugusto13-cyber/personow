#!/usr/bin/env node
// Gera as chaves de criptografia. Cole a saída em Render > Environment (nunca no Git) e guarde um backup seguro:
// PERDER a chave = perder os dados cifrados (CPF, Pix etc.). Para rotacionar: gere outra chave, acrescente em DATA_ENCRYPTION_KEYS
// ("1:...,2:..."), mude DATA_ENCRYPTION_KEY_ID e rode scripts/migrar-cripto.cjs --aplicar para recifrar.
const c = require("crypto"), k = () => c.randomBytes(32).toString("base64");
console.log(`DATA_ENCRYPTION_KEYS=1:${k()}\nDATA_ENCRYPTION_KEY_ID=1\nBLIND_INDEX_KEY=${k()}\nMP_WEBHOOK_SECRET=<copie do painel do Mercado Pago>`);
