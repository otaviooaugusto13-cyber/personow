# Personow — reestruturação nos moldes do Abastece Já

## Login e perfis
- E-mail+senha e Google (redirect via proxy `/__/auth/*`) para aluno, personal e admin. E-mail precisa ser verificado em contas de senha.
- `POST /sessao` decide o estado (ok / cadastro / outro-perfil / escolher) sem nunca derrubar a sessão. Uma conta pode ser aluno e personal; claim `role` = perfil ativo, `perfis` = lista.
- Painéis: `/painel-aluno`, `/painel-personal`, `/painel-admin`, `/painel-ti`; `verificar.html` (público) e `academia.html` (academia parceira).

## Novos módulos (todos adaptados ao nicho)
Níveis/missões, formação (4 módulos, quiz ≥70%), extrato (somente leitura, CSV), comprovante com código HMAC + PDF + verificação pública, suporte, painel de TI, presença online, academias parceiras, abas de admin (taxas, níveis, TI, academias), selo no ranking de personais.

## Variáveis de ambiente
`NOTA_HMAC_KEY`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_EXIGE_MFA` (opcional), além das já existentes (Firebase, Mercado Pago).

## Console Firebase
1. Authentication → habilitar **E-mail/senha** e **Google**.
2. Domínios autorizados: o domínio `*.onrender.com` do site.
3. OAuth do Google: URI de redirecionamento `https://<site>.onrender.com/__/auth/handler`.

## Decisões / limitações
- Comissão segue 15%; comissão por nível existe como opção em `config/taxas`, **desligada** por padrão.
- Carteira custodial do Abastece NÃO foi portada (risco regulatório): vira extrato.
- Não testado contra Firebase/Mercado Pago reais (testes usam fakes + Playwright com stubs).
- A query de aulas do painel da academia pode exigir índice composto (status + data) — o console do Firestore mostra o link ao primeiro erro.
- Pendente: aba admin de formação, login "modo teste", polimento visual de telas antigas, atualizar lista de cache do `sw.js`.
