// scripts/definir-admin.js
// Uso: node scripts/definir-admin.js [email]
// O e-mail do administrador é obrigatório (sem valor padrão embutido no código).
//
// Requisitos: "type": "module" no package.json e `npm i firebase-admin`.
// Credencial (ordem de prioridade):
//   1) variável de ambiente FIREBASE_SERVICE_ACCOUNT (JSON completo)
//   2) arquivo local serviceAccountKey.json (raiz do projeto)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

// ---------- Configuração ----------
const COLECAO_USUARIOS = 'usuarios'; // ajuste se sua coleção tiver outro nome

// Em ES Modules não existem __dirname/__filename; recriamos aqui.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAIZ_PROJETO = path.resolve(__dirname, '..');
const CAMINHO_CHAVE = path.join(RAIZ_PROJETO, 'serviceAccountKey.json');

// ---------- Leitura do arquivo com detecção de codificação ----------
function decodificarBuffer(buf) {
  // UTF-8 com BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  // UTF-16 LE com BOM (comum quando o arquivo é gerado com `>` no PowerShell)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  // UTF-16 BE com BOM: inverte os bytes e lê como LE
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const sem = Buffer.from(buf.subarray(2));
    sem.swap16();
    return sem.toString('utf16le');
  }
  // UTF-16 LE sem BOM: o JSON começa com "{" seguido de byte nulo
  if (buf.length >= 2 && buf[0] === 0x7b && buf[1] === 0x00) {
    return buf.toString('utf16le');
  }
  return buf.toString('utf8');
}

function lerCredencial() {
  let bruto;
  let origem;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
    origem = 'variável de ambiente FIREBASE_SERVICE_ACCOUNT';
  } else {
    if (!fs.existsSync(CAMINHO_CHAVE)) {
      throw new Error(
        `Arquivo não encontrado: ${CAMINHO_CHAVE}\n` +
          'Baixe a chave em Firebase Console > Configurações do projeto > ' +
          'Contas de serviço > Gerar nova chave privada, e salve como ' +
          'serviceAccountKey.json na raiz do projeto.'
      );
    }
    bruto = decodificarBuffer(fs.readFileSync(CAMINHO_CHAVE));
    origem = CAMINHO_CHAVE;
  }

  // Remove BOM residual e espaços
  bruto = bruto.replace(/^\uFEFF/, '').trim();

  let cred;
  try {
    cred = JSON.parse(bruto);
  } catch (e) {
    throw new Error(`JSON inválido em ${origem}: ${e.message}`);
  }

  // Se a chave foi colada com "\n" literais, converte em quebras de linha reais
  if (typeof cred.private_key === 'string') {
    cred.private_key = cred.private_key.replace(/\\n/g, '\n');
  }

  for (const campo of ['project_id', 'client_email', 'private_key']) {
    if (!cred[campo]) throw new Error(`Credencial sem o campo "${campo}" (${origem}).`);
  }

  console.log(`Credencial carregada de: ${origem}`);
  return cred;
}

// ---------- Execução principal ----------
async function main() {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error(`E-mail inválido: "${email}"`);
  }

  const credencial = lerCredencial();
  admin.initializeApp({ credential: admin.credential.cert(credencial) });

  // 1) Localiza o usuário no Firebase Auth
  let usuario;
  try {
    usuario = await admin.auth().getUserByEmail(email);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      throw new Error(
        `O e-mail ${email} ainda não existe no Firebase Auth do projeto "${credencial.project_id}". ` +
          'Faça login/cadastro uma vez no app e rode o script novamente.'
      );
    }
    throw e;
  }

  // 2) Define as custom claims (preserva as claims já existentes)
  const claimsAtuais = usuario.customClaims || {};
  await admin.auth().setCustomUserClaims(usuario.uid, {
    ...claimsAtuais,
    admin: true,
    role: 'admin',
  });

  // 3) Espelha o papel no Firestore
  await admin
    .firestore()
    .collection(COLECAO_USUARIOS)
    .doc(usuario.uid)
    .set(
      {
        email,
        role: 'admin',
        admin: true,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  console.log('\n✅ Admin definido com sucesso!');
  console.log(`   Projeto: ${credencial.project_id}`);
  console.log(`   E-mail : ${email}`);
  console.log(`   UID    : ${usuario.uid}`);
  console.log('\nO usuário precisa sair e entrar novamente (ou chamar getIdToken(true)) para o token receber a nova claim.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Erro:', err.message || err);
    process.exit(1);
  });
