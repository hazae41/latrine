// deno-lint-ignore-file no-unused-vars no-process-global

import { CryptoChannel } from "@/mods/mod.ts";
import { WalletConnect, WcPairParams, WcSession } from "@/mods/wc/mod.ts";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm";

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

const jwk = crypto.getRandomValues(new Uint8Array(32))

async function pair(url: string) {
  const pair = WcPairParams.parse(url)

  const client = await WalletConnect.open(jwk, "b580c84c2c57b6e4f78ab117951de721")

  const settlement = WalletConnect.settle(client, { pair, self, namespaces })

  const { value: session } = await settlement.next()

  await settlement.next()
}

async function resume(stale: WcSession) {
  const client = await WalletConnect.open(jwk, "b580c84c2c57b6e4f78ab117951de721")

  const channel = new CryptoChannel(client, stale.channel.topic, stale.channel.key)

  return new WcSession(channel, stale.settled)
}

console.log("Pairing...")

/**
 * Start by pairing
 */
const session = await pair(process.argv[2])

console.log("Session paired")

await new Promise(resolve => setTimeout(resolve, 1000))

console.log("Simulating disconnection...")

session.channel.client.socket.close()

console.log("Session disconnected")

await new Promise(resolve => setTimeout(resolve, 10000))

console.log("Resuming session...")

const session2 = await resume(session)

console.log("Session resumed")

session2.channel.addEventListener("request", e => console.log(e.data))

await session2.channel.fetch()

// await new Promise(resolve => setTimeout(resolve, 5000))

// console.log("Closing session...")

// /**
//  * Close the session
//  */
// await session2.delete()

// console.log("Session closed")