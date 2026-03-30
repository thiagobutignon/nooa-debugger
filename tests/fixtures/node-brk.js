const tracked = 41;
globalThis.__tracked = tracked;

setInterval(() => {
  globalThis.__tracked = tracked;
}, 250);
