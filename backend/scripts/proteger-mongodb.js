#!/usr/bin/env node
/**
 * Diagnóstico e receita de hardening do MongoDB.
 *
 * O banco guarda hash de senha, transcrição de consulta médica, CPF da lista de
 * leads e as chaves de API da OpenAI/Groq/AssemblyAI. A configuração padrão do
 * projeto era `mongodb://127.0.0.1:27018` — SEM usuário e SEM senha. Num host
 * com IP público, uma porta aberta por engano (ou um container com a porta
 * publicada) entrega tudo isso sem nem precisar de exploit.
 *
 * Este script não altera nada: ele CONFERE o estado atual e imprime os comandos
 * exatos para você aplicar. Habilitar autenticação exige reiniciar o mongod, e
 * isso é decisão de quem opera o servidor.
 *
 * Uso:  node scripts/proteger-mongodb.js
 */
import { MongoClient } from "mongodb";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27018";
const DB = process.env.MONGODB_DB || "chatflow";

const vermelho = t => `\x1b[31m${t}\x1b[0m`;
const verde = t => `\x1b[32m${t}\x1b[0m`;
const amarelo = t => `\x1b[33m${t}\x1b[0m`;
const negrito = t => `\x1b[1m${t}\x1b[0m`;

async function main() {
  console.log(negrito("\n=== Diagnóstico do MongoDB ===\n"));
  console.log(`URI configurada: ${URI.replace(/\/\/[^@]*@/, "//***:***@")}`);
  console.log(`Banco: ${DB}\n`);

  const temCredencialNaUri = /\/\/[^/@]+@/.test(URI);
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });

  let conectou = false;
  try {
    await client.connect();
    await client.db(DB).command({ ping: 1 });
    conectou = true;
  } catch (err) {
    console.log(vermelho(`Não foi possível conectar: ${err.message}`));
    console.log("\nSe o erro for de autenticação, ótimo — significa que o banco JÁ exige credencial.");
    process.exit(1);
  }

  const problemas = [];

  // 1. Autenticação habilitada?
  if (!temCredencialNaUri && conectou) {
    problemas.push({
      titulo: "MongoDB SEM autenticação",
      detalhe:
        "Conectamos e lemos o banco sem apresentar credencial nenhuma. Qualquer\n" +
        "  processo que alcance a porta 27018 faz o mesmo — incluindo ler os hashes\n" +
        "  de senha, as transcrições de consulta e as chaves de API.",
    });
  }

  // 2. A porta escuta só em localhost?
  try {
    const admin = client.db("admin");
    const params = await admin.command({ getCmdLineOpts: 1 }).catch(() => null);
    const bindIp = params?.parsed?.net?.bindIp;
    if (bindIp && !/^(127\.0\.0\.1|localhost)$/.test(String(bindIp))) {
      problemas.push({
        titulo: `MongoDB escutando em "${bindIp}"`,
        detalhe:
          "Com IP público exposto, isso é acesso direto ao banco pela internet.\n" +
          "  O ideal é bindIp: 127.0.0.1 e o backend na mesma máquina.",
      });
    } else if (bindIp) {
      console.log(verde(`✓ bindIp = ${bindIp} (só local)`));
    }
  } catch {
    console.log(amarelo("~ não foi possível ler a configuração de rede do mongod"));
  }

  // 3. Chaves de API em texto puro?
  try {
    const settings = await client.db(DB).collection("settings").findOne({ _id: "app" });
    const emTextoPuro = [];
    if (settings?.openai?.apiKey?.startsWith("sk-")) emTextoPuro.push("OpenAI");
    if (settings?.transcription?.groqApiKey?.length > 10) emTextoPuro.push("Groq");
    if (settings?.transcription?.assemblyaiApiKey?.length > 10) emTextoPuro.push("AssemblyAI");
    if (emTextoPuro.length) {
      problemas.push({
        titulo: `Chaves de API em texto puro no banco: ${emTextoPuro.join(", ")}`,
        detalhe:
          "Quem ler a coleção `settings` usa essas chaves diretamente, na conta de\n" +
          "  vocês. Defina SECRETS_KEY no .env para cifrá-las em repouso.",
      });
    } else {
      console.log(verde("✓ nenhuma chave de API detectada em texto puro"));
    }
  } catch {
    console.log(amarelo("~ não foi possível inspecionar a coleção settings"));
  }

  await client.close();

  if (!problemas.length) {
    console.log(verde(negrito("\n✓ Nada crítico encontrado.\n")));
    return;
  }

  console.log(vermelho(negrito(`\n${problemas.length} problema(s) encontrado(s):\n`)));
  for (const p of problemas) {
    console.log(vermelho(`  ✗ ${p.titulo}`));
    console.log(`  ${p.detalhe}\n`);
  }

  const senha = crypto.randomBytes(24).toString("base64url");
  console.log(negrito("=== Receita ===\n"));
  console.log("1) Crie o usuário da aplicação (com o mongod ainda SEM autenticação):\n");
  console.log(`   mongosh "${URI}" --eval '
     db.getSiblingDB("admin").createUser({
       user: "chatflow_app",
       pwd: "${senha}",
       roles: [{ role: "readWrite", db: "${DB}" }]
     })'`);
  console.log("\n2) Habilite a autenticação no mongod.conf:\n");
  console.log("   security:\n     authorization: enabled\n   net:\n     bindIp: 127.0.0.1\n     port: 27018");
  console.log("\n3) Reinicie o mongod e ponha a credencial no backend/.env:\n");
  console.log(`   MONGODB_URI=mongodb://chatflow_app:${senha}@127.0.0.1:27018/?authSource=admin`);
  console.log("\n4) Bloqueie a porta no firewall (o backend fala por localhost):\n");
  console.log("   Linux:   sudo ufw deny 27018");
  console.log("   Windows: New-NetFirewallRule -DisplayName \"Bloquear MongoDB\" -Direction Inbound -LocalPort 27018 -Protocol TCP -Action Block");
  console.log("\n5) Rode este script de novo para confirmar.\n");
  console.log(amarelo("A senha acima foi gerada agora, só para você. Ela não foi salva em lugar nenhum.\n"));
}

main().catch(err => {
  console.error("falhou:", err.message);
  process.exit(1);
});
