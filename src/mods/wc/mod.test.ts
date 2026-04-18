import { IrnClient } from "@/mod.ts";
import { Jwt } from "@/mods/jwt/mod.ts";
import { Wc } from "@/mods/wc/mod.ts";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm";

await chaCha20Poly1305Wasm.load()

chaCha20Poly1305.set(chaCha20Poly1305.fromWasm(chaCha20Poly1305Wasm))

const params = Wc.parseOrThrow("wc:fbca0cf2ff8f4f667a368a7456f738e8aed2136a0a9c5536f3526479944e8d70@2?relay-protocol=irn&symKey=2e3bcd3b9f3df65610fa5f4b7d094e78bbf6d8a200d5b80405d98d781058e8f4&expiryTimestamp=1776526310")

const token = await Jwt.signOrThrow(crypto.getRandomValues(new Uint8Array(32)), Wc.RELAY)

const socket = new WebSocket(`${Wc.RELAY}/?auth=${token}&projectId=b580c84c2c57b6e4f78ab117951de721`)

const { resolve, reject, promise } = Promise.withResolvers()

socket.addEventListener("open", resolve, {})
socket.addEventListener("error", event => reject(event), {})

await promise

const [session] = await Wc.pairOrThrow(new IrnClient(socket), params, {
  name: "Latrine",
  description: "A secure and private wallet for the web.",
  url: "https://latrine.hazae41.com",
  icons: ["https://latrine.hazae41.com/icon.png"],
}, "0xD231b3331C831Fc99152b5BEE366335B9C6c71e7", [1], 10000)

console.log(session.metadata)