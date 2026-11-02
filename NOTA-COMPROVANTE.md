# Comprovante de serviço (layout DANFE simplificado)

**Não é documento fiscal.** DANFE é a impressão de uma NF-e autorizada pela SEFAZ (XML assinado + protocolo). A plataforma hoje não emite documento fiscal (`notas.fiscal.nfse = null`), então a folha sai como *COMPROVANTE DE SERVIÇO — SEM VALOR FISCAL* (marca d'água), com a mesma estrutura de blocos do DANFE.

- **Emissão:** `POST /nota/:id/emitir` (aluno dona da nota ou equipe). Valores = snapshot gravado no pagamento; estorno lido ao vivo; cada aula conta uma via (auditado). Se itens ≠ total, devolve 409 `nota-inconsistente` e não imprime.
- **Código de barras:** Code 128 do *código de verificação* de 24 dígitos (HMAC do id, número, total e data). Segredo: `NOTA_HMAC_KEY` (ou `BLIND_INDEX_KEY`). Nunca é uma "chave de acesso" inventada.
- **Verificação pública:** `verificar.html` → `POST /nota/verificar` (id + 24 dígitos; sem login, sem dados pessoais).
- **Modo fiscal (futuro):** só se `nota.fiscal.documento` trouxer `chaveAcesso` (44 dígitos, DV módulo 11) + `protocolo` (≥15 dígitos) + `autorizadaEm` (dados de um emissor autorizado, p.ex. provedor de NFS-e/NF-e). Aí o título, o código de barras (chave) e o marca d'água mudam; em `ambiente: "homologacao"` continua "sem valor fiscal".
- **Impressão:** `nota.css` (`@page A4 portrait`, 8 mm, linhas de tabela sem quebra, cabeçalho repetido, marca d'água em todas as páginas). PDF = "Imprimir / salvar em PDF" do navegador (sem Puppeteer no servidor).
