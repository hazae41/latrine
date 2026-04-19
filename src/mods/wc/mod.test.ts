import { CryptoChannel } from "@/mods/mod.ts";
import { WalletConnect, WcPairParams, WcSession } from "@/mods/wc/mod.ts";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm";

await chaCha20Poly1305Wasm.load()

chaCha20Poly1305.set(chaCha20Poly1305.fromWasm(chaCha20Poly1305Wasm))

const address = "0xD231b3331C831Fc99152b5BEE366335B9C6c71e7"
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

async function pair(url: string) {
  const pair = WcPairParams.parse(url)

  const client = await WalletConnect.open("b580c84c2c57b6e4f78ab117951de721")

  const [session, settlement] = await WalletConnect.settle(client, { pair, self, namespaces })

  console.log(session.settled)

  await settlement.promise

  return session
}

async function resume(stale: WcSession) {
  const client = await WalletConnect.open("b580c84c2c57b6e4f78ab117951de721")

  const channel = new CryptoChannel(client, stale.channel.topic, stale.channel.key)

  await channel.subscribe()

  return new WcSession(channel, stale.settled)
}

console.log("Pairing...")

/**
 * Start by pairing
 */
const session = await pair("wc:c55fc237597d7eee090367a0be2b56c1cae73a7bead9d238bef16b763da1f42c@2?relay-protocol=irn&symKey=904e1bbe5a68d43dd945158f163b27da2ca2f468eb8d2aa0c09eea537664abff&expiryTimestamp=1776571946")

console.log("Session paired")

session.channel.addEventListener("request", console.log)

await new Promise(resolve => setTimeout(resolve, 5000))

console.log("Simulating disconnection...")

session.channel.client.socket.close()

console.log("Session disconnected")

await new Promise(resolve => setTimeout(resolve, 5000))

console.log("Resuming session...")

const session2 = await resume(session)

console.log("Session resumed")

session2.channel.addEventListener("request", console.log)

await new Promise(resolve => setTimeout(resolve, 5000))

console.log("Closing session...")

/**
 * Close the session
 */
await session2.delete()

console.log("Session closed")