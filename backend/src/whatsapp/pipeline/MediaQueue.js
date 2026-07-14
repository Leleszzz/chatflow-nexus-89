// Fila assíncrona com concorrência limitada e teto de pendências, por instância.
// Usada para baixar mídia e avatares FORA do hot path do handler do Baileys, para
// que um endpoint lento do WhatsApp não gere backpressure nem esgote sockets.
export class MediaQueue {
  constructor({ concurrency = 3, maxPending = 5000, process, onError } = {}) {
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this._process = process;
    this._onError = onError || (() => {});
    this._queue = [];
    this._active = 0;
    this._draining = false;
  }

  get depth() {
    return this._queue.length + this._active;
  }

  // Retorna false se a fila estiver cheia (job descartado).
  enqueue(job) {
    if (this._queue.length >= this.maxPending) return false;
    this._queue.push(job);
    this._pump();
    return true;
  }

  _pump() {
    while (this._active < this.concurrency && this._queue.length > 0) {
      const job = this._queue.shift();
      this._active += 1;
      Promise.resolve()
        .then(() => this._process(job))
        .catch(err => this._onError(err, job))
        .finally(() => {
          this._active -= 1;
          this._pump();
        });
    }
  }

  clear() {
    this._queue.length = 0;
  }
}
