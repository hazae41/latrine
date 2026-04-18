import { IrnClient } from "@/mod.ts";
import { Jwt } from "@/mods/jwt/mod.ts";
import { Wc } from "@/mods/wc/mod.ts";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { chaCha20Poly1305Wasm } from "@hazae41/chacha20poly1305-wasm";

await chaCha20Poly1305Wasm.load()

chaCha20Poly1305.set(chaCha20Poly1305.fromWasm(chaCha20Poly1305Wasm))

const params = Wc.parseOrThrow("wc:7b20a9bb5d8a0735fd2fb5c40bff1d7e823cf8bbec25567d17bbb518b374446f@2?relay-protocol=irn&symKey=37f973869cea2ff5059c717784e2757722c4d748bc9dd2692b8c608b2c29f9d1&expiryTimestamp=1776527795")

const token = await Jwt.signOrThrow(crypto.getRandomValues(new Uint8Array(32)), Wc.RELAY)

const socket = new WebSocket(`${Wc.RELAY}/?auth=${token}&projectId=b580c84c2c57b6e4f78ab117951de721`)

const { resolve, reject, promise } = Promise.withResolvers()

socket.addEventListener("open", resolve, {})
socket.addEventListener("error", event => reject(event), {})

await promise

const irn = new IrnClient(socket)

const address = "0xD231b3331C831Fc99152b5BEE366335B9C6c71e7"
const chains = [1]

const [session] = await Wc.pairOrThrow(irn, params, {
  name: "Latrine",
  description: "A secure and private wallet for the web.",
  url: "https://latrine.hazae41.com",
  icons: ["https://latrine.hazae41.com/icon.png"],
}, {
  eip155: {
    chains: chains.map(chainId => `eip155:${chainId}`),
    methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
    events: ["chainChanged", "accountsChanged"],
    accounts: chains.map(chainId => `eip155:${chainId}:${address}`)
  }
})

console.log(session.metadata)