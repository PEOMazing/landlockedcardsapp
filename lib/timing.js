// lib/timing.js - lightweight server-side phase timing for API routes.
//
// Usage:
//   const t = createTimer();
//   ... await airtable stuff ...
//   t.mark('db');
//   ... await anthropic stuff ...
//   t.mark('ai');
//   t.finish(res, '/api/whatever');   // sets Server-Timing header + logs JSON
//
// The Server-Timing header shows up in browser devtools (Network tab) and the
// JSON log line shows up in Vercel runtime logs, so both sides of a slow
// request are measurable without redeploying instrumentation.

export function createTimer() {
  const t0 = Date.now();
  let last = t0;
  const phases = [];

  return {
    // Record the time since the previous mark under `name`.
    mark(name) {
      const now = Date.now();
      phases.push({ name, ms: now - last });
      last = now;
    },
    // Set the Server-Timing header (if headers not sent) and emit one JSON
    // log line. Never throws — timing must not break the route.
    finish(res, route) {
      const total = Date.now() - t0;
      try {
        if (res && !res.headersSent) {
          const header = [
            ...phases.map((p) => `${p.name};dur=${p.ms}`),
            `total;dur=${total}`,
          ].join(', ');
          res.setHeader('Server-Timing', header);
        }
      } catch (_) { /* ignore */ }
      try {
        console.log(JSON.stringify({ tag: 'perf', route, totalMs: total, phases }));
      } catch (_) { /* ignore */ }
      return total;
    },
  };
}
