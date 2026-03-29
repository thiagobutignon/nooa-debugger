console.error("debug target booting");
setTimeout(() => {
  process.exit(0);
}, 15_000);
setInterval(() => {
  console.log("tick");
}, 1000);
