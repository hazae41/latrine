// deno-lint-ignore-file no-process-global no-explicit-any

import { IrnClient } from "@/mods/mod.ts";
import { WcChannel } from "@/mods/wc/channel/mod.ts";
import { WcInvalidMethodError, WcUserRejectedError } from "@/mods/wc/errors/mod.ts";
import { WalletConnect, WcPairingParams, WcSessionRequestParams } from "@/mods/wc/mod.ts";
import { WcPairing } from "@/mods/wc/pairing/mod.ts";
import { WcSession, WcSessionEventParams, WcSessionProposeParams, WcSessionProposeResult, WcSessionSettleParams } from "@/mods/wc/session/mod.ts";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm";
import { base58 } from "@scure/base";

await chaCha20Poly1305Wasm.load()

chaCha20Poly1305.set(chaCha20Poly1305.fromWasm(chaCha20Poly1305Wasm))

const metadata = {
  name: "Latrine",
  description: "Alternative WalletConnect client",
  url: "https://github.com/hazae41/latrine",
  icons: [],
}

const namespaces = {
  eip155: {
    chains: [1].map(chainId => `eip155:${chainId}`),
    accounts: [1].map(chainId => `eip155:${chainId}:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`),
    methods: ["personal_sign"],
    events: [],
  }
}

const requiredNamespaces = {
  // eip155: {
  //   chains: ["eip155:1"],
  //   methods: ["personal_sign"],
  //   events: []
  // },
  solana: {
    chains: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
    methods: ["solana_signMessage"],
    events: []
  }
}

interface User {
  readonly wcs: WcSession,
  readonly jwk: Uint8Array,
  readonly stl: WcSessionSettleParams
}

async function propose(signal = new AbortController().signal) {
  await using stack = new AsyncDisposableStack()

  const cleaner = new AbortController()
  stack.defer(() => cleaner.abort())

  const jwk = crypto.getRandomValues(new Uint8Array(32))

  const client = await IrnClient.open(WalletConnect.RELAY, jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const pairing = await WcPairing.generate(client)

  console.log("Copy this URL to your wallet:", pairing.url)

  const upgraded = Promise.withResolvers<WcSession>()
  stack.defer(() => upgraded.reject())
  upgraded.promise.catch(() => { })

  pairing.addEventListener("upgrade", event => upgraded.resolve(event.data), { signal: cleaner.signal })
  pairing.addEventListener("close", upgraded.reject, { signal: cleaner.signal })
  signal.addEventListener("abort", upgraded.reject, { signal: cleaner.signal })

  await pairing.open()

  stack.defer(async () => await pairing.close())
  stack.defer(async () => await pairing.delete())

  await pairing.propose({ self: metadata, requiredNamespaces })

  const session = await upgraded.promise

  session.addEventListener("event", event => onevent(event.data), { signal: session.closing })
  session.addEventListener("close", () => console.log("Session closed"), { signal: session.closing })

  const settled = Promise.withResolvers<WcSessionSettleParams>()
  stack.defer(() => settled.reject())
  settled.promise.catch(() => { })

  session.addEventListener("settle", event => settled.resolve(event.data), { signal: cleaner.signal })
  session.addEventListener("close", settled.reject, { signal: cleaner.signal })
  signal.addEventListener("abort", settled.reject, { signal: cleaner.signal })

  await session.open()

  let success = false

  stack.defer(async () => success ? undefined : await session.close())
  stack.defer(async () => success ? undefined : await session.delete())

  const stl = await settled.promise

  success = true

  return { wcs: session, jwk, stl } satisfies User
}

async function respond(url: string, signal = new AbortController().signal) {
  await using stack = new AsyncDisposableStack()

  const cleaner = new AbortController()
  stack.defer(() => cleaner.abort())

  const jwk = crypto.getRandomValues(new Uint8Array(32))

  const client = await IrnClient.open(WalletConnect.RELAY, jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const pairing = await WcPairing.from(client, WcPairingParams.parse(url))

  const proposed = Promise.withResolvers<WcSessionProposeParams>()
  stack.defer(() => proposed.reject())
  proposed.promise.catch(() => { })

  const responded = Promise.withResolvers<WcSessionProposeResult>()
  stack.defer(() => responded.reject())
  responded.promise.catch(() => { })

  pairing.addEventListener("propose", event => {
    const proposal = event.data

    proposed.resolve(proposal)

    event.respondWith(responded.promise)
  }, { signal: cleaner.signal })

  const upgraded = Promise.withResolvers<WcSession>()
  stack.defer(() => upgraded.reject())
  upgraded.promise.catch(() => { })

  pairing.addEventListener("upgrade", event => upgraded.resolve(event.data), { signal: cleaner.signal })
  pairing.addEventListener("close", upgraded.reject, { signal: cleaner.signal })
  signal.addEventListener("abort", upgraded.reject, { signal: cleaner.signal })

  await pairing.open()

  stack.defer(async () => await pairing.close())
  stack.defer(async () => await pairing.delete())

  const proposal = await proposed.promise

  if (!confirm(`Do you want to connect to ${proposal.proposer.metadata.name}?`))
    responded.reject(new WcUserRejectedError())

  responded.resolve(await pairing.respond(proposal))

  await responded.promise

  const session = await upgraded.promise

  session.addEventListener("request", event => event.respondWith(onrequest(event.data)), { signal: session.closing })
  session.addEventListener("close", () => console.log("Session closed"), { signal: session.closing })

  await session.open()

  let success = false

  stack.defer(async () => success ? undefined : await session.close())
  stack.defer(async () => success ? undefined : await session.delete())

  const relay = session.channel.client.relay

  const { requiredNamespaces, optionalNamespaces } = proposal

  const controller = { publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pairing.keypair.publicKey)).toHex(), metadata }

  const expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)

  const stl = { relay, namespaces, requiredNamespaces, optionalNamespaces, pairingTopic: pairing.channel.topic, controller, expiry }

  await session.settle(stl)

  success = true

  return { wcs: session, jwk, stl } satisfies User
}

interface UserData {
  readonly tpc: string
  readonly key: string
  readonly jwk: string
  readonly stl: WcSessionSettleParams
}

async function save(user: User) {
  const tpc = user.wcs.channel.topic
  const key = user.wcs.channel.key.toBase64()
  const jwk = user.jwk.toBase64()
  const stl = user.stl

  return { tpc, key, jwk, stl } satisfies UserData
}

async function resume(save: UserData) {
  const tpc = save.tpc
  const key = Uint8Array.fromBase64(save.key)
  const jwk = Uint8Array.fromBase64(save.jwk)
  const stl = save.stl

  const client = await IrnClient.open(WalletConnect.RELAY, jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const channel = new WcChannel(client, tpc, key)
  const session = new WcSession(channel)

  session.addEventListener("event", event => onevent(event.data), { signal: session.closing })
  session.addEventListener("request", event => event.respondWith(onrequest(event.data)), { signal: session.closing })
  session.addEventListener("close", () => console.log("Session closed"), { signal: session.closing })

  await session.open()

  if (session.closing.aborted)
    return

  return { wcs: session, jwk, stl } satisfies User
}

async function onrequest(data: WcSessionRequestParams<unknown>) {
  const { request, chainId } = data

  console.log(chainId, request)

  if (request.method === "personal_sign")
    return "0x4d7920656d61696c206973206a6f686e40646f652e636f6d202d2031373736373030303335353530"

  throw new WcInvalidMethodError()
}

async function onevent(data: WcSessionEventParams) {
  const { event, chainId } = data

  console.log(chainId, event)
}

console.log("Pairing...")

const user = process.argv[2] ? await respond(process.argv[2]) : await propose()

console.log("Session paired")

const msgraw = crypto.getRandomValues(new Uint8Array(32))

const pubkey = (user.stl.namespaces as any).solana.accounts[0].split(":")[2]
const message = base58.encode(msgraw)

const request = { method: "solana_signMessage", params: { pubkey, message } }

const response = await user.wcs.request<{ signature: string }>({ chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", request })

const sigraw = new Uint8Array(base58.decode(response.signature))

const pubraw = new Uint8Array(base58.decode(pubkey))
const pubref = await crypto.subtle.importKey("raw", pubraw, { name: "Ed25519" }, false, ["verify"])

console.log(await crypto.subtle.verify({ name: "Ed25519" }, pubref, sigraw, msgraw))

// await new Promise(resolve => setTimeout(resolve, 1000))

// user.wcs.channel.client.socket.close()

// console.log("Session disconnected")

// await new Promise(resolve => setTimeout(resolve, 10000))

// console.log("Resuming session...")

// const user2 = await resume(await save(user))

// if (user2 != null) {
//   console.log("Session resumed")

//   await new Promise(resolve => setTimeout(resolve, 5000))

//   console.log("Closing session...")

//   await user2.wcs.delete()
//   await user2.wcs.close()
// }

// console.log("Finished")