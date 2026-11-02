# Eneagrama automático no onboarding

O resultado do teste (tipo, asa e instinto/subtipo) entra no perfil do personal **sem digitação**, por dois caminhos:

1. **Arquivo importado** (CSV/JSON) com `scripts/importar-eneagrama.js`.
2. **Link assinado** (`/personal.html?et=...`) enviado à pessoa pelo fluxo automatizado.

## Arquitetura (Firestore, tudo só do servidor)

O `firestore.rules` nega por padrão o que não tem regra, então **nenhuma regra nova** é necessária. Não há índice novo: tudo é busca por ID de documento.

| Coleção | ID do documento | Conteúdo | Observações |
|---|---|---|---|
| `personais_perfil` (já existia) | `uid` | `eneagrama {tipo, asa, instinto}` + **`eneagramaMeta {origem, codigo, loteId, travado, aplicadoEm, anterior?}`** | `origem`: `manual`, `importacao` ou `link`. `travado: true` = veio do teste, o usuário não digita nem altera. `anterior` guarda o preenchimento manual substituído. |
| `eneagrama_resultados` (nova) | **HMAC do e-mail** | `eneagrama`, `codigo`, `origem`, `loteId`, `importadoEm`, `expiraEm` | Resultado de quem **ainda não se cadastrou**. O e-mail nunca é gravado em claro. Uso único (apagado ao vincular). Expira. |
| `eneagrama_lotes` (nova) | `loteId` | `arquivo`, `sha256`, `linhasLidas`, `totais`, `criadoEm`, `operador` | Livro de cada importação. O `sha256` impede reimportar o mesmo arquivo sem querer. |
| `auditoria` (já existia) | auto | `acao: eneagrama.importar` ou `eneagrama.vincular`, `alvo: uid`, `detalhes {codigo, loteId, origem}` | Sem dados pessoais além do uid. |

**Ligação entre arquivo e usuário:** e-mail normalizado (minúsculas, sem espaços). O ID do pendente é `HMAC-SHA256(BLIND_INDEX_KEY, "eneagrama-email:" + e-mail)`, o mesmo mecanismo de índice cego que o projeto já usa para o CPF.

### Fluxo

```
CSV/JSON ──► importar-eneagrama.js ──┬─ conta já é personal ─────► personais_perfil (travado)
                                     ├─ sem cadastro / só no Auth ───► eneagrama_resultados/{HMAC(e-mail)}
                                     └─ conta de aluno/admin, linha inválida ─► relatório

Cadastro do personal (/cadastro/personal) ──► vincularNoCadastro():
   e-mail VERIFICADO? ─► link assinado válido (?et=) ou pendente não expirado ─► grava travado, consome o pendente, audita
   (qualquer falha é registrada no log e NUNCA derruba o cadastro)

Abrir o perfil (GET /perfil/personal/inteligente) ──► se ainda não há Eneagrama, tenta o mesmo vínculo (cobre import feito depois)
```

### Segurança
- Só vincula por **e-mail verificado** do Google. Quem tenta cadastrar um e-mail alheio não recebe o resultado.
- O link assinado é HMAC (mesma chave do índice cego, com prefixo próprio), **amarrado ao e-mail**, com validade de 30 dias. Adulterar o tipo ou encaminhar o link a outra pessoa invalida o link.
- O resultado vindo do teste fica **travado**: o `PUT /perfil/personal/inteligente` ignora tentativa de troca, e a tela mostra o resultado só para leitura.
- O PUT agora grava com `merge`. Antes ele **apagava** os campos extras do documento, e isso removeria o `eneagramaMeta`.

## Como usar

1. **Teste primeiro** (simulação, só lê, não grava):
   ```powershell
   node scripts/importar-eneagrama.js resultados.csv
   ```
   Abra o `relatorio-<lote>.csv`: cada linha mostra `direto`, `pendente`, `ignorado`, `invalido` ou `erro`, com o motivo. E-mails aparecem mascarados.
2. **Grave** (use o mesmo `BLIND_INDEX_KEY` do Render):
   ```powershell
   $env:BLIND_INDEX_KEY = "<valor do Render>"
   node scripts/importar-eneagrama.js resultados.csv --aplicar
   ```
3. **Links** para o fluxo automatizado (opcional): acrescente `--links` e use o `links-<lote>.csv` para enviar. **Apague o arquivo depois**, pois ele tem e-mails.
4. Opções: `--manter-manual` (não sobrescreve quem preencheu à mão), `--ttl-dias 180`, `--forcar` (repete um arquivo já importado), `--chave <arquivo>`.

**Formato do arquivo:** CSV (`;`, `,` ou tab) ou JSON. Colunas aceitas (qualquer caixa/acento): `email`; `codigo` (ex.: `PW-3w2-SO`) **ou** `tipo`, `asa`, `subtipo`/`instinto` (`SP`, `SX`, `SO`, ou autopreservação, sexual, social). No Excel use *Salvar como CSV UTF-8*. Não lemos `.xlsx` direto de propósito: as bibliotecas disponíveis têm falhas conhecidas.

## Instalação

1. Copie para o projeto, respeitando as pastas: `server/lib/eneagrama.js`, `scripts/_credencial.js`, `scripts/_tabela.js`, `scripts/importar-eneagrama.js`, `test/eneagrama.test.js`. Também `server/rotas/conta.js` e `script-personal.js`, que são os arquivos do projeto **com os ganchos**. Se você mexeu neles depois do último `git push`, aplique só as alterações dos arquivos `conta.js.diff` e `script-personal.js.diff` (linhas com `+` e `-`).
2. Acrescente ao `.gitignore`: `relatorio-*.csv`, `links-*.csv`.
3. Rode os testes: `node test/eneagrama.test.js` e depois `npm test` na raiz.
4. No Firebase Console → Firestore → **Time-to-live (TTL)**, crie a política na coleção `eneagrama_resultados`, campo `expiraEm`. Sem isso, o código ignora pendentes expirados, mas os documentos não são apagados sozinhos.
5. `git push`. Depois do deploy, faça a primeira importação em simulação.

## Decisões que você pode mudar
- **O teste prevalece sobre o preenchimento manual** (o valor antigo vai em `eneagramaMeta.anterior`). Para o contrário, use `--manter-manual`.
- **Validade do resultado pendente:** 180 dias (`--ttl-dias`). **Validade do link:** 30 dias (`validadeDias` em `assinarToken`).
- **Asa que não é vizinha do tipo:** é descartada com aviso no relatório, como já faz o navegador. O tipo é mantido.

## LGPD (confirmar com o advogado)
- O resultado do Eneagrama é perfil de personalidade, e a plataforma não o usa para aprovar ou reprovar (só para sugerir aulas), como diz a cláusula 7.6 dos Termos. Mesmo assim, o aviso ao titular precisa dizer que **o resultado do teste feito pelo e-mail dele é vinculado automaticamente ao cadastro**.
- Se o teste for operado por outra pessoa jurídica, o compartilhamento do resultado com a Personow precisa estar coberto no consentimento do próprio teste.
- Atualize as cláusulas 7.5 a 7.7 e 20.2 a 20.3 do rascunho dos Termos, que hoje tratam o Eneagrama como preenchimento opcional do próprio usuário.
