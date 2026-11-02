// Pool de workers: cada worker tem sua própria instância do kernel exato e regenera
// variantes do documento em paralelo. Estudos paramétricos, otimização e lotes de
// exportação escalam com o número de núcleos da máquina.
import { Worker } from 'node:worker_threads';
import os from 'node:os';

export class KernelPool {
  constructor(size) {
    const cores = os.availableParallelism();
    // deixa 2 threads livres para a interface e o processo principal
    this.size = Math.max(1, Math.min(size || Number(process.env.PROJETISTA_WORKERS) || cores - 2, cores));
    this.workers = [];
    this.queue = [];
    this.nextId = 1;
    this.busy = 0;
    this.completed = 0;
    // memória por worker: proporcional à RAM total, até 4 GB (limite do WASM de 32 bits)
    this.heapMb = Math.min(4096, Math.floor(os.totalmem() / 1024 / 1024 / (this.size + 2)));
  }

  spawn() {
    const w = new Worker(new URL('./worker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: this.heapMb } });
    const slot = { w, job: null, ready: false };
    w.on('message', (m) => {
      if (m.type === 'ready') { slot.ready = true; this.pump(); return; }
      const job = slot.job;
      slot.job = null; this.busy--; this.completed++;
      if (job) (m.ok ? job.resolve(m.result) : job.reject(new Error(m.error)));
      slot.idleSince = Date.now();
      this.pump();
      this.scheduleReap();
    });
    w.on('error', (e) => { if (slot.job) { slot.job.reject(e); slot.job = null; this.busy--; } this.workers = this.workers.filter((x) => x !== slot); this.pump(); });
    this.workers.push(slot);
    return slot;
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, task, resolve, reject });
      while (this.workers.length < Math.min(this.size, this.queue.length + this.busy)) this.spawn();
      this.pump();
    });
  }

  pump() {
    for (const slot of this.workers) {
      if (!slot.ready || slot.job || !this.queue.length) continue;
      const job = this.queue.shift();
      slot.job = job; this.busy++;
      slot.w.postMessage({ id: job.id, task: job.task });
    }
  }

  /** Workers ociosos por mais de 60 s são encerrados (devolvem a RAM ao sistema). */
  scheduleReap() {
    clearTimeout(this.reapTimer);
    this.reapTimer = setTimeout(() => {
      for (const slot of [...this.workers]) {
        if (!slot.job && Date.now() - (slot.idleSince || 0) > 59000) { slot.w.terminate(); this.workers = this.workers.filter((x) => x !== slot); }
      }
    }, 60000);
    this.reapTimer.unref();
  }

  stats() {
    return { workers: this.workers.length, maxWorkers: this.size, busy: this.busy, queued: this.queue.length, completed: this.completed, heapLimitMbPerWorker: this.heapMb };
  }

  async close() { await Promise.all(this.workers.map((s) => s.w.terminate())); this.workers = []; }
}
