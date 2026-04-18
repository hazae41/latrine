import { IrnClient } from "@/mod.ts";
import { Jwt } from "@/mods/jwt/mod.ts";
import { CryptoClient } from "@/mods/mod.ts";
import { Wc, WcSession } from "@/mods/wc/mod.ts";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm";

await chaCha20Poly1305Wasm.load()

chaCha20Poly1305.set(chaCha20Poly1305.fromWasm(chaCha20Poly1305Wasm))

const address = "0xD231b3331C831Fc99152b5BEE366335B9C6c71e7"
const chains = [1]

const metadata = {
  name: "Latrine",
  description: "A secure and private wallet for the web.",
  url: "https://latrine.hazae41.com",
  icons: ["https://latrine.hazae41.com/icon.png"],
}

const namespaces = {
  eip155: {
    chains: chains.map(chainId => `eip155:${chainId}`),
    methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
    events: ["chainChanged", "accountsChanged"],
    accounts: chains.map(chainId => `eip155:${chainId}:${address}`)
  }
}

async function open(url: string, token: string, projectId: string) {
  using stack = new DisposableStack()

  const cleaner = new AbortController()
  stack.defer(() => cleaner.abort())

  const socket = new WebSocket(`${url}/?auth=${token}&projectId=${projectId}`)

  const { resolve, reject, promise } = Promise.withResolvers()

  socket.addEventListener("open", resolve, { signal: cleaner.signal })
  socket.addEventListener("error", reject, { signal: cleaner.signal })

  await promise

  return new IrnClient(socket)
}

async function pair(url: string) {
  const params = Wc.parseOrThrow(url)

  const jwk = crypto.getRandomValues(new Uint8Array(32))
  const jwt = await Jwt.signOrThrow(jwk, Wc.RELAY)
  const irn = await open(Wc.RELAY, jwt, "b580c84c2c57b6e4f78ab117951de721")

  const [session, settlement] = await Wc.pairOrThrow(irn, params, metadata, namespaces)

  console.log(session.metadata)

  await settlement.promise

  return session
}

async function resume(stale: WcSession) {
  const jwk = crypto.getRandomValues(new Uint8Array(32))
  const jwt = await Jwt.signOrThrow(jwk, Wc.RELAY)
  const irn = await open(Wc.RELAY, jwt, "b580c84c2c57b6e4f78ab117951de721")

  const client = new CryptoClient(irn, stale.client.topic, stale.client.key)

  await irn.subscribe(stale.client.topic)

  return new WcSession(client, stale.metadata)
}

console.log("Pairing...")

/**
 * Start by pairing
 */
const session = await pair("wc:9a3fba7a17f1ee820304c4e96ce30aa0398c5e0a0ef6070e578430b7b6edd6ce@2?relay-protocol=irn&symKey=04b4c54ccf543914bc06ad4808e27c2c7b7a6fb4ec5eb56c6408b93f176c0733&expiryTimestamp=1776529608")

console.log("Session paired")

session.client.addEventListener("request", console.log)

await new Promise(resolve => setTimeout(resolve, 5000))

console.log("Simulating disconnection...")

session.client.irn.socket.close()

console.log("Session disconnected")

await new Promise(resolve => setTimeout(resolve, 5000))

console.log("Resuming session...")

const session2 = await resume(session)

console.log("Session resumed")

session2.client.addEventListener("request", console.log)

await new Promise(resolve => setTimeout(resolve, 5000))

console.log("Closing session...")

/**
 * Close the session
 */
session2.close()

console.log("Session closed")