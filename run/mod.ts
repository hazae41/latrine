// deno-lint-ignore-file no-unused-vars no-process-global

import { IrnClient } from "@/mods/mod.ts";
import { WcChannel } from "@/mods/wc/channel/mod.ts";
import { WcInvalidMethodError, WcUserRejectedError } from "@/mods/wc/errors/mod.ts";
import { WalletConnect, WcPairingParams, WcSessionRequestParams } from "@/mods/wc/mod.ts";
import { WcPairing } from "@/mods/wc/pairing/mod.ts";
import { WcEventAndChain, WcSession, WcSessionProposeParams, WcSessionSettleParams } from "@/mods/wc/session/mod.ts";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm";

await chaCha20Poly1305Wasm.load()

chaCha20Poly1305.set(chaCha20Poly1305.fromWasm(chaCha20Poly1305Wasm))

const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
const chains = [1]

const self = {
  name: "Latrine",
  description: "Alternative WalletConnect client",
  url: "https://github.com/hazae41/latrine",
  icons: [],
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

async function propose(signal = new AbortController().signal) {
  await using stack = new AsyncDisposableStack()

  const cleaner = new AbortController()
  stack.defer(() => cleaner.abort())

  const client = await IrnClient.open(WalletConnect.RELAY, jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const pairing = await WcPairing.generate(client)

  console.log("Copy this URL to your wallet:", pairing.url)

  const upgraded = Promise.withResolvers<WcSession>()
  stack.defer(() => upgraded.reject())
  upgraded.promise.catch(() => { })

  pairing.addEventListener("upgraded", event => upgraded.resolve(event.data), { signal: cleaner.signal })
  pairing.addEventListener("close", upgraded.reject, { signal: cleaner.signal })
  signal.addEventListener("abort", upgraded.reject, { signal: cleaner.signal })

  await pairing.open()

  stack.defer(async () => await pairing.close())
  stack.defer(async () => await pairing.delete())

  await pairing.propose({ self, optionalNamespaces })

  const session = await upgraded.promise

  session.addEventListener("event", event => console.log(event.data))
  session.addEventListener("request", event => event.respondWith(onrequest(event.data)))

  const settled = Promise.withResolvers<WcSessionSettleParams>()
  stack.defer(() => settled.reject())
  settled.promise.catch(() => { })

  session.addEventListener("settled", event => settled.resolve(event.data), { signal: cleaner.signal })
  session.addEventListener("close", settled.reject, { signal: cleaner.signal })
  signal.addEventListener("abort", settled.reject, { signal: cleaner.signal })

  await session.open()

  let success = false

  stack.defer(async () => success ? undefined : await session.close())
  stack.defer(async () => success ? undefined : await session.delete())

  const settlement = await settled.promise

  success = true

  return { session, settled: settlement }
}

async function respond(url: string, signal = new AbortController().signal) {
  await using stack = new AsyncDisposableStack()

  const cleaner = new AbortController()
  stack.defer(() => cleaner.abort())

  const client = await IrnClient.open(WalletConnect.RELAY, jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const pairing = await WcPairing.from(client, WcPairingParams.parse(url))

  const upgraded = Promise.withResolvers<WcSession>()
  stack.defer(() => upgraded.reject())
  upgraded.promise.catch(() => { })

  pairing.addEventListener("proposal", event => event.respondWith(onpropose(event.data)), { signal: cleaner.signal })
  pairing.addEventListener("upgraded", event => upgraded.resolve(event.data), { signal: cleaner.signal })
  pairing.addEventListener("close", upgraded.reject, { signal: cleaner.signal })
  signal.addEventListener("abort", upgraded.reject, { signal: cleaner.signal })

  await pairing.open()

  stack.defer(async () => await pairing.close())
  stack.defer(async () => await pairing.delete())

  const settled = await pairing.respond({ self, namespaces })

  const session = await upgraded.promise

  session.addEventListener("event", event => console.log(event.data))
  session.addEventListener("request", event => event.respondWith(onrequest(event.data)))

  await session.open()

  let success = false

  stack.defer(async () => success ? undefined : await session.close())
  stack.defer(async () => success ? undefined : await session.delete())

  await session.settle(settled)

  success = true

  return { session }
}

interface WcSave {
  readonly channel: { topic: string, key: string }
}

async function save(session: WcSession) {
  const topic = session.channel.topic
  const key = session.channel.key.toBase64()

  const channel = { topic, key }

  return { channel } satisfies WcSave
}

async function resume(saved: WcSave) {
  const key = Uint8Array.fromBase64(saved.channel.key)

  const client = await IrnClient.open(WalletConnect.RELAY, jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const channel = new WcChannel(client, saved.channel.topic, key)
  const session = new WcSession(channel)

  session.addEventListener("event", event => console.log(event.data))
  session.addEventListener("request", event => event.respondWith(onrequest(event.data)))

  await session.open()

  return { session }
}

async function onpropose(proposed: WcSessionProposeParams) {
  const peer = proposed.proposer.metadata

  if (!confirm(`Do you want to connect to ${peer.name}?`))
    throw new WcUserRejectedError()

  return true
}

async function onrequest(data: WcSessionRequestParams<unknown>) {
  const { request, chainId } = data

  console.log(chainId, request)

  if (request.method === "personal_sign")
    return "0x4d7920656d61696c206973206a6f686e40646f652e636f6d202d2031373736373030303335353530"

  throw new WcInvalidMethodError()
}

async function onevent(data: WcEventAndChain) {
  const { event, chainId } = data

  console.log(chainId, event)
}

console.log("Pairing...")

/**
 * Start by pairing
 */
const { session } = process.argv[2] ? await respond(process.argv[2]) : await propose()

console.log("Session paired")

await new Promise(resolve => setTimeout(resolve, 1000))

console.log("Simulating disconnection...")

session.channel.client.socket.close()

console.log("Session disconnected")

await new Promise(resolve => setTimeout(resolve, 10000))

console.log("Resuming session...")

const { session: session2 } = await resume(await save(session))

console.log("Session resumed")

// await new Promise(resolve => setTimeout(resolve, 5000))

// console.log("Closing session...")

// /**
//  * Close the session
//  */
// await session2.delete()

// console.log("Session closed")