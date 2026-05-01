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

```tsx
const jwk = crypto.getRandomValues(new Uint8Array(32))
```

```tsx
const client = await IrnClient.open(WalletConnect.RELAY, jwk, "c6c9bacd35afa3eb9e6cccf6d8464395")
```

### App-side

```tsx
const pairing = await WcPairing.generate(client)

pairing.addEventListener("upgrade", async e => {
  const session = e.data

  session.addEventListener("settle", e => console.log("Session ready to use"))
  session.addEventListener("event", e => console.log(e.data))
  session.addEventListener("close", () => console.log("Session closed"))

  await session.open()
})

await pairing.open()

await pairing.propose(...)
```

See `./run/mod.ts` for a full example

### Wallet-side

```tsx
const pairing = await WcPairing.from(client, WcPairingParams.parse(url))

pairing.addEventListener("propose", event => {
  event.respondWith(pairing.respond(event.data))
}, { signal: cleaner.signal })

pairing.addEventListener("upgrade", async e => {
  const session = e.data

  session.addEventListener("request", e => e.respondWith(...))
  session.addEventListener("close", () => console.log("Session closed"))

  await session.open()
  
  const relay = session.channel.client.relay

  const { requiredNamespaces, optionalNamespaces } = proposal

  const controller = { metadata, publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pairing.keypair.publicKey)).toHex() }

  const expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)

  await session.settle({ relay, namespaces, requiredNamespaces, optionalNamespaces, pairingTopic: pairing.channel.topic, controller, expiry })

  console.log("Session ready to use")
})

await pairing.open()
```

See `./run/mod.ts` for a full example