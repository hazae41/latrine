# Latrine

Secure and private WalletConnect client

```bash
npm i @hazae41/latrine
```

[**NPM 📦**](https://www.npmjs.com/package/@hazae41/latrine)

## Features

### Current features
- Uses web standards
- Supply-chain hardened
- No trackable identifiers
- Auditable cryptography
- Minimalist and reliable
- Can work on Deno/Node

## Usage

### Wallet-side

```tsx
import { WalletConnect, WcChannel, WcSession, WcPairParams, WcSessionRequestParams} from "@hazae41/latrine";
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

const jwk = crypto.getRandomValues(new Uint8Array(32))

async function respond(url: string) {
  const peer = WcPairParams.parse(url)

  const client = await WalletConnect.open(jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const session = await WalletConnect.respond(client, (proposal) => {
    return confirm(`Do you want to connect to ${proposal.proposer.metadata.name}?`)
  }, { self, peer, namespaces })

  session.addEventListener("request", event => event.respondWith(onrequest(event.data)))

  await session.subscribe()

  await session.fetch()

  console.log(await session.settled)

  return session
}

async function save(session: WcSession) {
  const { topic } = session.channel

  const key = session.channel.key.toBase64()
  const settled = await session.settled

  await session.channel.close()

  return JSON.stringify({ topic, key, settled })
}

async function resume(saved: string) {
  const parsed = JSON.parse(saved)

  const { topic, settled } = parsed.topic
  const key = Uint8Array.fromBase64(parsed.key)

  const client = await WalletConnect.open(jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const channel = new WcChannel(client, topic, key)
  const session = new WcSession(channel, settled)

  session.addEventListener("request", event => event.respondWith(onrequest(event.data)))

  await session.subscribe()

  await session.fetch()

  return session
}

async function onrequest(data: WcSessionRequestParams<unknown>) {
  const { request, chainId } = data

  console.log(chainId, request)

  if (request.method === "personal_sign")
    return "0x4d7920656d61696c206973206a6f686e40646f652e636f6d202d2031373736373030303335353530"

  throw new Error("Not found")
}

const session = await respond(process.argv[2])

const saved = await save(session)

const resumed = await resume(session)
```

### Webapp-side

```tsx
import { WalletConnect, WcChannel, WcSession, WcPairParams } from "@hazae41/latrine";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm"

await chaCha20Poly1305Wasm.load()

chaCha20Poly1305.set(chaCha20Poly1305.fromWasm(chaCha20Poly1305Wasm))

const self = {
  name: "Latrine",
  description: "Alternative WalletConnect client",
  url: "https://github.com/hazae41/latrine",
  icons: [],
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
  const client = await WalletConnect.open(jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const session = await WalletConnect.propose(client, url => {
    console.log("Copy this URL to your wallet:", url)
  }, { self, optionalNamespaces })

  session.addEventListener("event", event => console.log(event.data))
  session.addEventListener("request", event => event.respondWith(onrequest(event.data)))

  await session.subscribe()

  await session.fetch()

  console.log(await session.settled)

  return session
}


async function save(session: WcSession) {
  const { topic } = session.channel

  const key = session.channel.key.toBase64()
  const settled = await session.settled

  await session.channel.close()

  return JSON.stringify({ topic, key, settled })
}

async function resume(saved: string) {
  const parsed = JSON.parse(saved)

  const { topic, settled } = parsed.topic
  const key = Uint8Array.fromBase64(parsed.key)

  const client = await WalletConnect.open(jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")

  const channel = new WcChannel(client, topic, key)
  const session = new WcSession(channel, settled)

  session.addEventListener("request", event => event.respondWith(onrequest(event.data.request)))

  await session.subscribe()

  await session.fetch()

  return session
}

async function onevent(data: WcEventAndChain) {
  const { event, chainId } = data

  console.log(chainId, event)
}

const session = await propose()

const saved = await save(session)

const resumed = await resume(session)
```