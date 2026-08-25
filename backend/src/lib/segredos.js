import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Cifragem em repouso das credenciais de terceiros (OpenAI, Groq, AssemblyAI).
 *
 * As chaves ficavam em TEXTO PURO na coleção `settings`. Quem lesse o banco —
 * um backup mal guardado, um dump, ou qualquer processo na rede enquanto o
 * MongoDB estiver sem autenticação — usava as chaves direto, na conta da
 * clínica. Cifrar aqui não substitui proteger o banco, mas garante que o dump
 * sozinho não vale nada.
 *
 * AES-256-GCM: além de cifrar, autentica. Um valor adulterado no banco falha a
 * verificação em vez de decifrar em lixo silencioso.
 *
 * Formato guardado: "enc:v1:<iv>:<tag>:<conteúdo>", tudo em base64url. O prefixo
 * permite conviver com valores antigos em texto puro sem migração forçada — o
 * que estava lá continua funcionando e é recifrado na próxima gravação.
 */

const PREFIXO = "enc:v1:";
const IV_BYTES = 12; // tamanho recomendado para GCM

const b64 = buf => Buffer.from(buf).toString("base64url");
const debase64 = txt => Buffer.from(txt, "base64url");

/** A cifragem está configurada? Sem SECRETS_KEY, os valores seguem em claro. */
export function cifragemAtiva() {
  return Boolean(config.secretsKey);
}

export function estaCifrado(valor) {
  return typeof valor === "string" && valor.startsWith(PREFIXO);
}

/** Cifra um segredo. Sem chave configurada, devolve o valor como veio. */
export function cifrar(texto) {
  const valor = String(texto ?? "");
  if (!valor || !config.secretsKey) return valor;
  if (estaCifrado(valor)) return valor; // idempotente

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", config.secretsKey, iv);
  const conteudo = Buffer.concat([cipher.update(valor, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIXO}${b64(iv)}:${b64(tag)}:${b64(conteudo)}`;
}

/**
 * Decifra. Valor em texto puro (legado) atravessa sem alteração — é o que
 * permite ligar a cifragem num banco já povoado sem quebrar nada.
 */
export function decifrar(valor) {
  if (!estaCifrado(valor)) return valor;
  if (!config.secretsKey) {
    // Valor cifrado sem a chave para abrir: quase sempre é SECRETS_KEY removida
    // ou trocada. Devolver a string cifrada faria a aplicação mandá-la como se
    // fosse a credencial, e o erro apareceria lá na OpenAI, sem explicação.
    console.error("[segredos] valor cifrado no banco mas SECRETS_KEY não está definida");
    return "";
  }
  try {
    const [, , iv, tag, conteudo] = valor.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", config.secretsKey, debase64(iv));
    decipher.setAuthTag(debase64(tag));
    return Buffer.concat([decipher.update(debase64(conteudo)), decipher.final()]).toString("utf8");
  } catch (err) {
    // Chave trocada ou dado adulterado. Falhar limpo é melhor que devolver lixo.
    console.error(`[segredos] não foi possível decifrar (SECRETS_KEY mudou?): ${err.message}`);
    return "";
  }
}
