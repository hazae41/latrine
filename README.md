# Latrine

Secure and private reimplementation of the WalletConnect protocol

```bash
npm i @hazae41/latrine
```

[**Node Package 📦**](https://www.npmjs.com/package/@hazae41/latrine)

## Features

### Current features
- 100% TypeScript and ESM
- No external dependencies
- Rust-like patterns
- Uses web standards
- Supply-chain hardened
- No trackable identifiers
- Auditable cryptography

## Usage

### Wallet-side

#### Connect

```tsx
import { Wc, Jwt, IrnClient } from "@hazae41/latrine"
import { RpcRequestPreinit } from "@hazae41/jsonrpc"
import { Some, None } from "@hazae41/option"
import { Ed25519 } from "@hazae41/ed25519"
import { Base64 } from "@hazae41/base64"

const relay = Wc.RELAY
const projectId = "<TODO>"
const chains = [1, 100, 137]
const metadata = { name: "MyWallet", description: "My wallet", url: location.origin, icons: [] }
const address = "0x..."

const wsKey = await Ed25519.get().PrivateKey.randomOrThrow()
const wsAuth = await Jwt.signOrThrow(wsKey, relay)
const wsUrl = `${relay}/?auth=${wsAuth}&projectId=${projectId}`
const wsSocket = new WebSocket(wsUrl)
// TOOD: wait socket open

const irn = new IrnClient(wsSocket)
const params = Wc.parseOrThrow(rawWcUrl)

const [session, settlement] = await Wc.pairOrThrow(irn, params, metadata, address, chains, 5000)

const wsKeyJwk = wsKey.exportJwkOrThrow()

const wcKey = session.client.key
const wcTopic = session.client.topic

const wcKeyBase64 = Base64.get().encodePaddedOrThrow(wcKey)

/**
 * Save all somewhere
 */
localStorage.setItem("wc.tpc", wcTopic)
localStorage.setItem("wc.jwk", wsKeyJwk)
localStorage.setItem("wc.key", wcKeyBase64)
localStorage.setItem("wc.mtd", JSON.stringify(session.metadata))
localStorage.setItem("wc.stl", JSON.stringify(settlement.receipt))

for (const iconUrl of session.metadata.icons) {
  try {
    const iconRes = await fetch(iconUrl)
    const iconBlob = await iconRes.blob()

    // TODO: save it and display it
    
    break
  } catch(e: unknown) {
    continue
  }
}

/**
 * Wait for settlement (user can close page)
 */
const settled = await settlement.promise.then(r => r.unwrap())

if (!settled) {
  localStorage.removeItem("wc.tpc")
  localStorage.removeItem("wc.jwk")
  localStorage.removeItem("wc.key")
  localStorage.removeItem("wc.mtd")
  localStorage.removeItem("wc.stl")

  throw new Error(`Could not connect to ${session.metadata.name}`)
}

/**
 * Settled before user closed the page
 */
localStorage.removeItem("wc.stl")

const onRequest = (suprequest: RpcRequestPreinit<unknown>) => {
  if (suprequest.method !== "wc_sessionRequest")
    return new None()

  const { chainId, request } = (suprequest as RpcRequestPreinit<WcSessionRequestParams>).params

  if (request.method === "eth_sendTransaction")
    return new Some(await eth_sendTransaction(chainId, request)) // TODO
  if (request.method === "personal_sign")
    return new Some(await personal_sign(chainId, request)) // TODO
  if (request.method === "eth_signTypedData_v4")
    return new Some(await eth_signTypedData_v4(chainId, equest)) // TODO
  return new None()
}

const stack = new DisposableStack()

const onCloseOrError = (reason?: unknown) => {
  stack.dispose()
  return new None()
}

stack.defer(session.client.events.on("request", onRequest, { passive: true }))
stack.defer(session.client.events.on("close", onCloseOrError, { passive: true }))
stack.defer(session.client.events.on("error", onCloseOrError, { passive: true }))

console.log(`Connected to ${session.metadata.name}`)
```

#### Reconnect

```tsx
import { Wc, Jwt, IrnClient, CryptoClient, WcSession } from "@hazae41/latrine"
import { RpcRequestPreinit } from "@hazae41/jsonrpc"
import { Some, None } from "@hazae41/option"
import { Ed25519 } from "@hazae41/ed25519"
import { Base64 } from "@hazae41/base64"

const relay = Wc.RELAY
const projectId = "<TODO>"
const chains = [1, 100, 137]
const metadata = { name: "MyWallet", description: "My wallet", url: location.origin, icons: [] }
const address = "0x..."

const wcTopic = localStorage.getItem("wc.tpc")
const wsKeyJwk = localStorage.getItem("wc.jwk")
const wcKeyBase64 = localStorage.getItem("wc.key")
const wcMetadata = localStorage.getItem("wc.mtd")
const wcSettlement = localStorage.getItem("wc.stl")

const wcKeyRaw = Base64.get().decodePaddedOrThrow(wcKeyBase64).copyAndDispose()
const wcKey = Bytes.castOrThrow(wcKeyRaw, 32)

const wsKey = await Ed25519.get().PrivateKey.importJwkOrThrow(wsKeyJwk)
const wsAuth = await Jwt.signOrThrow(wsKey, relay)
const wsUrl = `${relay}/?auth=${wsAuth}&projectId=${projectId}`
const wsSocket = new WebSocket(wsUrl)
await // TOOD: wait socket open

const irn = new IrnClient(wsSocket)
const client = CryptoClient.createOrThrow(irn, wcTopic, wcKey, 5000)
const metadata = JSON.parse(wcMetadata)
const session = new WcSession(sessionClient, metadata)

await irn.subscribeOrThrow(wcTopic, AbortSignal.timeout(5000))

if (wcSettlement != null) {
  const settlement = JSON.parse(wcSettlement)
  
  const settled = await session.client.waitOrThrow<boolean>(settlement).then(r => r.unwrap())

  if (!settled) {
    localStorage.removeItem("wc.tpc")
    localStorage.removeItem("wc.jwk")
    localStorage.removeItem("wc.key")
    localStorage.removeItem("wc.mtd")
    localStorage.removeItem("wc.stl")

    throw new Error(`Could not connect to ${session.metadata.name}`)
  }

  localStorage.removeItem("wc.stl")
}

const onRequest = (suprequest: RpcRequestPreinit<unknown>) => {
  if (suprequest.method !== "wc_sessionRequest")
    return new None()

  const { chainId, request } = (suprequest as RpcRequestPreinit<WcSessionRequestParams>).params

  if (request.method === "eth_sendTransaction")
    return new Some(await eth_sendTransaction(chainId, request)) // TODO
  if (request.method === "personal_sign")
    return new Some(await personal_sign(chainId, request)) // TODO
  if (request.method === "eth_signTypedData_v4")
    return new Some(await eth_signTypedData_v4(chainId, equest)) // TODO
  return new None()
}

const stack = new DisposableStack()

const onCloseOrError = (reason?: unknown) => {
  stack.dispose()
  return new None()
}

stack.defer(session.client.events.on("request", onRequest, { passive: true }))
stack.defer(session.client.events.on("close", onCloseOrError, { passive: true }))
stack.defer(session.client.events.on("error", onCloseOrError, { passive: true }))

console.log(`Reconnected to ${session.metadata.name}`)
```