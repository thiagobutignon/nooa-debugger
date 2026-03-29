const seed = 41;
const shared = globalThis as typeof globalThis & { tracked?: number };
shared.tracked = seed;
const message = "hello";

setTimeout(() => {
  process.exit(0);
}, 15_000);

setInterval(() => {
  const result = shared.tracked! + 1;
  console.log(message, result);
}, 1_000);
