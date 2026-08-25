import test from "node:test";
import assert from "node:assert/strict";
import { cifrar, decifrar, estaCifrado, cifragemAtiva } from "../src/lib/segredos.js";

// As chaves de API da OpenAI/Groq/AssemblyAI ficavam em TEXTO PURO na coleção
// `settings`. Um dump do banco — ou qualquer acesso à rede enquanto o MongoDB
// estiver sem autenticação — entregava as credenciais prontas para uso.

test("ida e volta preserva o valor", { skip: !cifragemAtiva() && "SECRETS_KEY ausente" }, () => {
  const original = "sk-proj-abc123DEF456ghi789";
  const cifrado = cifrar(original);
  assert.ok(estaCifrado(cifrado));
  assert.notEqual(cifrado, original);
  assert.ok(!cifrado.includes(original), "o texto original vazou no valor cifrado");
  assert.equal(decifrar(cifrado), original);
});

test("cifrar duas vezes não empilha camadas", { skip: !cifragemAtiva() && "SECRETS_KEY ausente" }, () => {
  const uma = cifrar("segredo");
  assert.equal(cifrar(uma), uma, "cifrar de novo deveria ser no-op");
  assert.equal(decifrar(uma), "segredo");
});

test("cada cifragem usa IV novo", { skip: !cifragemAtiva() && "SECRETS_KEY ausente" }, () => {
  // Mesmo valor cifrado duas vezes precisa gerar saídas diferentes, senão dá
  // para deduzir que duas contas usam a mesma chave só comparando o banco.
  assert.notEqual(cifrar("igual"), cifrar("igual"));
});

test("valor adulterado não decifra em lixo silencioso", { skip: !cifragemAtiva() && "SECRETS_KEY ausente" }, () => {
  const cifrado = cifrar("credencial-real");
  const partes = cifrado.split(":");
  // Troca um caractere do conteúdo: o GCM autentica, então tem que falhar.
  partes[4] = partes[4].slice(0, -2) + (partes[4].endsWith("AA") ? "BB" : "AA");
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    assert.equal(decifrar(partes.join(":")), "", "adulteração deveria falhar limpo");
  } finally {
    console.error = erroOriginal;
  }
});

test("texto puro legado atravessa sem alteração", () => {
  // É o que permite ligar a cifragem num banco já povoado sem quebrar nada.
  assert.equal(decifrar("sk-chave-antiga-em-claro"), "sk-chave-antiga-em-claro");
  assert.equal(estaCifrado("sk-chave-antiga-em-claro"), false);
});

test("vazio continua vazio", () => {
  assert.equal(cifrar(""), "");
  assert.equal(cifrar(null), "");
  assert.equal(decifrar(""), "");
});
