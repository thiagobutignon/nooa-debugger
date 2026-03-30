setInterval(() => {
  const tracked = 41;
  globalThis.__tracked = tracked;
  console.log(tracked);
}, 150);
