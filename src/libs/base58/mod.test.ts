import { base58 } from "@/libs/base58/mod.ts";
import { assert, test } from "@hazae41/phobos";

test("base58 random", async () => {
  for (let i = 0; i < 1024; i++) {
    const length = crypto.getRandomValues(new Uint8Array(1))[0] + 1

    const sourced = crypto.getRandomValues(new Uint8Array(length))

    const encoded = base58.encode(sourced)
    const decoded = base58.decode(encoded)

    try {
      assert(sourced.toHex() === decoded.toHex())
    } catch (error) {
      console.debug(sourced.toHex())

      console.debug(encoded)

      console.debug(decoded.toHex())

      throw error
    }
  }
})

test("base58 #0", async () => {
  const sourced = Uint8Array.fromHex("00")

  const encoded = base58.encode(sourced)
  const decoded = base58.decode(encoded)

  assert(encoded === "1")

  assert(sourced.toHex() === decoded.toHex())
})

test("base58 #1", async () => {
  const sourced = Uint8Array.fromHex("deadbeef")

  const encoded = base58.encode(sourced)
  const decoded = base58.decode(encoded)

  assert(encoded === "6h8cQN")

  assert(sourced.toHex() === decoded.toHex())
})

test("base58 #2", async () => {
  const sourced = Uint8Array.fromHex("cafebabe")

  const encoded = base58.encode(sourced)
  const decoded = base58.decode(encoded)

  assert(encoded === "6Bx4TP")

  assert(sourced.toHex() === decoded.toHex())
})

test("base58 #3", async () => {
  const sourced = Uint8Array.fromHex("7978b714453cd3e87aeb1fc09bf067f96cd2d4d69b571395aa9bf186aff9da3f")

  const encoded = base58.encode(sourced)
  const decoded = base58.decode(encoded)

  assert(encoded === "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump")

  assert(sourced.toHex() === decoded.toHex())
})