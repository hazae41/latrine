// deno-lint-ignore-file no-explicit-any

import type { Uint8Array } from "@/libs/bytes/mod.ts";
import { Jwt } from "@/libs/jwt/mod.ts";
import { CryptoChannel } from "@/mods/crypto/mod.ts";
import { IrnClient } from "@/mods/irn/mod.ts";
import { WcProposer, WcProposerParams } from "@/mods/wc/proposer/mod.ts";
import { WcResponder, WcResponderParams } from "@/mods/wc/responder/mod.ts";
import { RpcRequestPreinit } from "@hazae41/jsonrpc";
import { Option } from "@hazae41/result-and-option";

export interface WcRelay {
  readonly protocol: string
}

export interface WcMetadata {
  readonly name: string
  readonly description: string
  readonly url: string
  readonly icons: string[]
}

export interface WcIdentity {
  readonly publicKey: string
  readonly metadata: WcMetadata
}

export interface WcSessionProposeParams {
  readonly relays: WcRelay[]

  readonly proposer: WcIdentity

  readonly requiredNamespaces: any
  readonly optionalNamespaces: any
}

export interface WcSessionProposeResult {
  readonly relay: WcRelay
  readonly responderPublicKey: string
}

export interface WcSessionSettleParams {
  readonly relay: WcRelay

  readonly controller: WcIdentity

  readonly namespaces: any
  readonly requiredNamespaces: any
  readonly optionalNamespaces: any

  readonly pairingTopic: string
  readonly expiry: number
}

export interface WcSessionRequestParams<T = unknown> {
  readonly chainId: `${string}:${string}`
  readonly request: RpcRequestPreinit<T>
}

export interface WcPairParams {
  readonly protocol: "wc:"
  readonly version: "2"
  readonly pairingTopic: string
  readonly relayProtocol: "irn"
  readonly symKey: Uint8Array<ArrayBuffer, 32>
}

export namespace WcPairParams {

  export function stringify(params: WcPairParams): string {
    const { protocol, version, pairingTopic, relayProtocol, symKey } = params

    const url = new URL(`${protocol}${pairingTopic}@${version}`)

    url.searchParams.set("relay-protocol", relayProtocol)
    url.searchParams.set("symKey", symKey.toHex())

    return url.toString()
  }

  export function parse(rawUrl: string | URL): WcPairParams {
    const { protocol, pathname, searchParams } = new URL(rawUrl)

    if (protocol !== "wc:")
      throw new Error(`Unknown protocol`)

    const [pairingTopic, version] = pathname.split("@")

    if (version !== "2")
      throw new Error(`Unknown version`)

    const relayProtocol = Option.wrap(searchParams.get("relay-protocol")).getOrThrow()

    if (relayProtocol !== "irn")
      throw new Error(`Unknown relay protocol`)

    const symKeyHex = Option.wrap(searchParams.get("symKey")).getOrThrow()
    const symKeyRaw = Uint8Array.fromHex(symKeyHex) as Uint8Array<ArrayBuffer, 32>

    return { protocol, pairingTopic, version, relayProtocol, symKey: symKeyRaw }
  }

}

export namespace WalletConnect {

  export const RELAY = "wss://relay.walletconnect.org"

  export async function open(jwk: Uint8Array<ArrayBuffer, 32>, projectId: string, signal = new AbortController().signal): Promise<IrnClient> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const jwt = await Jwt.signOrThrow(jwk, RELAY)

    const socket = new WebSocket(`${RELAY}/?auth=${jwt}&projectId=${projectId}`)

    const { resolve, reject, promise } = Promise.withResolvers()

    socket.addEventListener("open", resolve, { signal: cleaner.signal })
    socket.addEventListener("error", reject, { signal: cleaner.signal })
    signal.addEventListener("abort", reject, { signal: cleaner.signal })

    await promise

    return new IrnClient(socket)
  }

  export async function propose(client: IrnClient, params: WcProposerParams) {
    const topic = crypto.getRandomValues(new Uint8Array(32)).toHex()
    const symkey = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer, 32>

    const channel = new CryptoChannel(client, topic, symkey)
    const keypair = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    return new WcProposer(channel, keypair, params)
  }

  export async function respond(client: IrnClient, params: WcResponderParams) {
    const { pairingTopic, symKey } = params.peer

    const channel = new CryptoChannel(client, pairingTopic, symKey)
    const keypair = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    return new WcResponder(channel, keypair, params)
  }

}