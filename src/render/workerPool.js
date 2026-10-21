// A small pool of tile workers. Returns null where module workers or
// OffscreenCanvas are missing, so the caller can render on the main thread.

export function createTilePool(size) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  const workers = [];
  const idle = [];
  const waiting = [];
  const pending = new Map();
  let nextId = 1;
  let broken = false;

  const dispatch = () => {
    while (idle.length && waiting.length) {
      const w = idle.pop();
      const job = waiting.shift();
      pending.set(job.id, { ...job, worker: w });
      w.postMessage(job.msg);
    }
  };

  const fail = (err) => {
    broken = true;
    for (const job of [...pending.values(), ...waiting]) job.reject(err);
    pending.clear();
    waiting.length = 0;
  };

  try {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./tileWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const job = pending.get(e.data.id);
        pending.delete(e.data.id);
        idle.push(w);
        if (job) {
          if (e.data.error) job.reject(new Error(e.data.error));
          else job.resolve(e.data.bitmap);
        }
        dispatch();
      };
      w.onerror = (e) => {
        e.preventDefault();
        fail(new Error(e.message || 'Tile worker failed to start'));
      };
      workers.push(w);
      idle.push(w);
    }
  } catch {
    return null;
  }

  return {
    get broken() {
      return broken;
    },
    run(msg) {
      if (broken) return Promise.reject(new Error('Tile workers unavailable'));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.push({ id, msg: { ...msg, id }, resolve, reject });
        dispatch();
      });
    },
    terminate() {
      for (const w of workers) w.terminate();
    },
  };
}
