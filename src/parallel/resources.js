// Monitor de recursos da máquina: CPU por núcleo, RAM, workers e GPU (NVIDIA via nvidia-smi).
import os from 'node:os';
import { execFile } from 'node:child_process';

let lastCpu = os.cpus();
let gpuCache = { t: 0, data: null };

function cpuLoad() {
  const now = os.cpus();
  const per = now.map((c, i) => {
    const a = lastCpu[i]?.times || c.times, b = c.times;
    const idle = b.idle - a.idle;
    const total = Object.keys(b).reduce((s, k) => s + (b[k] - a[k]), 0);
    return total > 0 ? +(100 * (1 - idle / total)).toFixed(1) : 0;
  });
  lastCpu = now;
  return { model: now[0]?.model.trim(), logical: now.length, perCore: per, average: +(per.reduce((s, x) => s + x, 0) / per.length).toFixed(1) };
}

function gpu() {
  if (Date.now() - gpuCache.t < 2000) return Promise.resolve(gpuCache.data);
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 1500, windowsHide: true }, (err, out) => {
      let data = null;
      if (!err) {
        data = out.trim().split('\n').map((l) => {
          const [name, total, used, util, temp] = l.split(',').map((s) => s.trim());
          return { name, vramTotalMb: +total, vramUsedMb: +used, utilization: +util, temperatureC: +temp };
        });
      }
      gpuCache = { t: Date.now(), data };
      resolve(data);
    });
  });
}

export async function resources(pool, extra = {}) {
  const mem = process.memoryUsage();
  return {
    cpu: cpuLoad(),
    memory: {
      systemTotalGb: +(os.totalmem() / 2 ** 30).toFixed(1), systemFreeGb: +(os.freemem() / 2 ** 30).toFixed(1),
      processRssMb: +(mem.rss / 2 ** 20).toFixed(0), kernelHeapMb: +((extra.wasmBytes || 0) / 2 ** 20).toFixed(0),
    },
    pool: pool?.stats() || null,
    gpu: await gpu(),
    kernelThreads: extra.threads || 1,
  };
}
