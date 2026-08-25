/**
 * Map com teto de entradas, descartando o menos recentemente usado.
 *
 * `WhatsAppConnection` guardava `chatsById` e `contactsByJid` como Map comum,
 * povoados por TODO o histórico sincronizado e nunca podados. Com 20 mil
 * contatos por instância, e várias instâncias no mesmo processo, isso é memória
 * que só sobe até o processo morrer — e leva junto todas as conexões de
 * WhatsApp abertas.
 *
 * O conteúdo aqui é cache (nome de contato, metadado de chat): perder uma
 * entrada antiga custa uma consulta a mais, não corretude.
 *
 * A ordem de inserção do Map de JavaScript é o que faz o LRU: reinserir move a
 * chave para o fim, e a primeira chave do iterador é sempre a mais antiga.
 */
export class LruMap {
  constructor(maxEntradas = 5000) {
    this.max = Math.max(1, maxEntradas);
    this._m = new Map();
  }

  get size() { return this._m.size; }

  has(chave) { return this._m.has(chave); }

  get(chave) {
    if (!this._m.has(chave)) return undefined;
    const valor = this._m.get(chave);
    // Releitura conta como uso: volta para o fim da fila.
    this._m.delete(chave);
    this._m.set(chave, valor);
    return valor;
  }

  set(chave, valor) {
    if (this._m.has(chave)) this._m.delete(chave);
    this._m.set(chave, valor);
    while (this._m.size > this.max) {
      const maisAntiga = this._m.keys().next().value;
      this._m.delete(maisAntiga);
    }
    return this;
  }

  delete(chave) { return this._m.delete(chave); }
  clear() { this._m.clear(); }
  keys() { return this._m.keys(); }
  values() { return this._m.values(); }
  entries() { return this._m.entries(); }
  [Symbol.iterator]() { return this._m[Symbol.iterator](); }
}
