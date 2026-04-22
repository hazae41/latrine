// deno-lint-ignore-file no-unused-vars no-process-global

import { WcChannel } from "@/mods/wc/channel/mod.ts";
import { WalletConnect, WcPairParams } from "@/mods/wc/mod.ts";
import { WcSession } from "@/mods/wc/session/mod.ts";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm";
import { RpcMethodNotFoundError, RpcRequestPreinit } from "@hazae41/jsonrpc";

await chaCha20Poly1305Wasm.load()

chaCha20Poly1305.set(chaCha20Poly1305.fromWasm(chaCha20Poly1305Wasm))

const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
const chains = [1]

const self = {
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

const optionalNamespaces = {
  eip155: {
    chains: ["eip155:1"],
    methods: ["eth_sendTransaction", "personal_sign"],
    events: ["chainChanged", "accountsChanged"]
  }
}

const jwk = crypto.getRandomValues(new Uint8Array(32))

async function propose() {
  const client = await WalletConnect.open(jwk, "b580c84c2c57b6e4f78ab117951de721")
  const pairing = await WalletConnect.propose(client, { self, optionalNamespaces })

  console.log(pairing.url)

  const upgraded = Promise.withResolvers<WcSession>()

  pairing.addEventListener("upgraded", event => upgraded.resolve(event.data))

  await pairing.subscribe()

  await pairing.fetch()

  await pairing.propose()

  const session = await upgraded.promise

  session.addEventListener("request", event => event.respondWith(onrequest(event.data.request)))
  session.addEventListener("settled", event => console.log(event.data))

  await session.subscribe()

  await session.fetch()

  return session
}

async function respond(url: string) {
  const peer = WcPairParams.parse(url)

  const client = await WalletConnect.open(jwk, "b580c84c2c57b6e4f78ab117951de721")
  const pairing = await WalletConnect.respond(client, { self, peer, namespaces })

  pairing.addEventListener("proposal", (event) => event.respondWith(true))

  const upgraded = Promise.withResolvers<WcSession>()

  pairing.addEventListener("upgraded", event => upgraded.resolve(event.data))

  await pairing.subscribe()

  await pairing.fetch()

  const session = await upgraded.promise

  session.addEventListener("event", event => console.log(event.data))
  session.addEventListener("request", event => event.respondWith(onrequest(event.data.request)))
  session.addEventListener("settled", event => console.log(event.data))

  await session.subscribe()

  await session.fetch()

  return session
}

async function resume(stale: WcSession) {
  const client = await WalletConnect.open(jwk, "b580c84c2c57b6e4f78ab117951de721")

  const session = new WcSession(new WcChannel(client, stale.channel.topic, stale.channel.key))

  session.addEventListener("event", event => console.log(event.data))
  session.addEventListener("request", event => event.respondWith(onrequest(event.data.request)))

  await session.subscribe()

  await session.fetch()

  return session
}

async function onrequest(request: RpcRequestPreinit<unknown>) {
  const { method, params } = request

  console.log(method, params)

  if (method === "personal_sign")
    return "0x4d7920656d61696c206973206a6f686e40646f652e636f6d202d2031373736373030303335353530"

  throw new RpcMethodNotFoundError()
}

console.log("Pairing...")

/**
 * Start by pairing
 */
const session = process.argv[2] ? await respond(process.argv[2]) : await propose()

console.log("Session paired")

await new Promise(resolve => setTimeout(resolve, 1000))

console.log("Simulating disconnection...")

session.channel.client.socket.close()

console.log("Session disconnected")

await new Promise(resolve => setTimeout(resolve, 10000))

console.log("Resuming session...")

const session2 = await resume(session)

console.log("Session resumed")

// await new Promise(resolve => setTimeout(resolve, 5000))

// console.log("Closing session...")

// /**
//  * Close the session
//  */
// await session2.delete()

// console.log("Session closed")