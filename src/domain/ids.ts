export type IdPrefix = "mem" | "evt" | "clm" | "dec" | "key" | "mbr";

// RFC 9562 UUIDv7 with a 12-bit counter in rand_a (method 1), so identifiers
// from one process or isolate stay strictly increasing within a millisecond and
// across small clock regressions. Uses only Web Crypto, available in every runtime.
let lastMs = 0;
let counter = 0;

function uuidv7(): string {
  let ms = Date.now();
  if (ms > lastMs) {
    const seed = new Uint16Array(1);
    crypto.getRandomValues(seed);
    // Start in the lower half so the counter has room before it carries.
    counter = (seed[0] ?? 0) & 0x7ff;
  } else {
    ms = lastMs;
    counter++;
    if (counter > 0xfff) {
      ms++;
      counter = 0;
    }
  }
  lastMs = ms;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes.subarray(8));
  for (let i = 0; i < 6; i++)
    bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${uuidv7()}`;
}
