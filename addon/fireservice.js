const LIMIT = 50;
const DELAY_MS = 2000;
const FIELD = /^[a-z][a-z0-9_.-]{0,63}$/;

function scalar(value) {
   if (value == null || typeof value === "boolean" || typeof value === "string") return value;
   if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
   if (value instanceof Error) return value.name;
   return String(value);
}

export function fields(values = {}) {
   return Object.fromEntries(Object.entries(values)
      .filter(([ key ]) => FIELD.test(key))
      .map(([ key, value ]) => [ key, scalar(value) ]));
}

export function record(prio, subsystem, message, values = {}, at = new Date()) {
   return {
      at: at.toISOString(),
      prio,
      subsystem,
      message,
      fields: fields(values)
   };
}

export function client(send, { delay = DELAY_MS, limit = LIMIT } = {}) {
   const queue = [];
   let timer = 0;

   async function flush() {
      if (timer) clearTimeout(timer);
      timer = 0;
      while (queue.length) await send(queue.splice(0, limit));
   }

   function report(prio, subsystem, message, values = {}) {
      queue.push(record(prio, subsystem, message, values));
      if (!timer) timer = setTimeout(() => void flush(), delay);
   }

   return Object.freeze({ report, flush, pending: () => queue.length });
}
