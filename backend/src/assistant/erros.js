// O erro que uma ferramenta levanta.
//
// Mora sozinho, e não em contexto.js, porque validacao.js precisa dele e é um
// arquivo puro: importar de contexto.js arrastaria a camada inteira de storage
// para dentro de um módulo que só valida formato de data.

/**
 * Falha de ferramenta.
 *
 * Nunca derruba o turno: o laço devolve a mensagem ao modelo como resultado da
 * tool call, e ele se recupera — corrige o formato da data, pergunta o nome
 * certo, tenta outra ferramenta. Perder a pergunta inteira porque um argumento
 * veio errado seria pior para quem está conversando.
 *
 * Por isso a mensagem é escrita PARA O MODELO ler: diz o que se esperava, não
 * só que deu errado.
 */
export class AssistantToolError extends Error {
  constructor(message, codigo = "FERRAMENTA_FALHOU") {
    super(message);
    this.name = "AssistantToolError";
    this.codigo = codigo;
  }
}
