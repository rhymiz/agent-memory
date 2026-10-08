import { expect, test } from "bun:test";
import { newId } from "../src/domain/ids";

const uuidv7 =
  /^mem_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("identifiers are prefixed RFC 9562 version 7 UUIDs", () => {
  expect(newId("mem")).toMatch(uuidv7);
  expect(newId("dec").startsWith("dec_")).toBe(true);
});

test("identifiers increase strictly within one millisecond", () => {
  const ids = Array.from({ length: 5000 }, () => newId("evt"));
  expect(new Set(ids).size).toBe(ids.length);
  expect([...ids].sort()).toEqual(ids);
});

test("identifiers embed the current time", () => {
  const before = Date.now();
  const id = newId("clm");
  const ms = Number.parseInt(id.slice(4, 12) + id.slice(13, 17), 16);
  expect(ms).toBeGreaterThanOrEqual(before);
  expect(ms).toBeLessThanOrEqual(Date.now() + 1);
});
