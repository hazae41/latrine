// deno-lint-ignore-file no-explicit-any

import type { Uint8Array } from "@/libs/bytes/mod.ts";
import { Jwt } from "@/libs/jwt/mod.ts";
import { CryptoChannel, RpcReceiptAndPromise } from "@/mods/crypto/mod.ts";
import { IrnClient } from "@/mods/irn/mod.ts";
import { RpcRequestPreinit } from "@hazae41/jsonrpc";
import { Option } from "@hazae41/result-and-option";

export interface WcMetadata {
  readonly name: string
  readonly description: string
  readonly url: string
  readonly icons: string[]
}

export interface WcSessionProposeParams {
  readonly proposer: {
    /**
     * base16
     */
    readonly publicKey: string
    readonly metadata: WcMetadata
  }

  readonly relays: {
    readonly protocol: string
  }[]

  readonly requiredNamespaces: any
  readonly optionalNamespaces: any
}

export interface WcSessionSettleParams {
  readonly controller: {
    /**
     * base16
     */
    readonly publicKey: string
    readonly metadata: WcMetadata
  }

  readonly relay: {
    readonly protocol: string
  }

  readonly namespaces: any
  readonly requiredNamespaces: any
  readonly optionalNamespaces: any

  readonly pairingTopic: string
  readonly expiry: number
}

export interface WcSessionRequestParams<T = unknown> {
  /**
   * namespace:decimal
   */
  readonly chainId: `${string}:${string}`
  readonly request: RpcRequestPreinit<T>
}

export interface WcSessionData {
  readonly self: WcMetadata
  readonly peer: WcMetadata

  readonly namespaces: unknown

  readonly requiredNamespaces: unknown
  readonly optionalNamespaces: unknown

  readonly expiry: number
}

export class WcSession {

  constructor(
    readonly channel: CryptoChannel,
    readonly settled: WcSessionData
  ) { }

  async delete(reason?: string): Promise<void> {
    const params = { code: 6000, message: "User disconnected." }

    await this.channel.request({ method: "wc_sessionDelete", params })

    this.channel.close(reason)
  }

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

export interface WcSettleParams {
  readonly self: WcMetadata
  readonly pair: WcPairParams

  readonly namespaces: unknown

  readonly requiredNamespaces?: unknown
  readonly optionalNamespaces?: unknown

  readonly expiry?: number
}

export namespace WalletConnect {

  export const RELAY = "wss://relay.walletconnect.org"

  export async function open(projectId: string, signal = new AbortController().signal): Promise<IrnClient> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const jwk = crypto.getRandomValues(new Uint8Array(32))
    const jwt = await Jwt.signOrThrow(jwk, RELAY)

    const socket = new WebSocket(`${RELAY}/?auth=${jwt}&projectId=${projectId}`)

    const { resolve, reject, promise } = Promise.withResolvers()

    socket.addEventListener("open", resolve, { signal: cleaner.signal })
    socket.addEventListener("error", reject, { signal: cleaner.signal })
    signal.addEventListener("abort", reject, { signal: cleaner.signal })

    await promise

    return new IrnClient(socket)
  }

  export async function settle(client: IrnClient, params: WcSettleParams, signal = new AbortController().signal): Promise<[WcSession, RpcReceiptAndPromise<boolean>]> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const { relay } = client

    const { pairingTopic, symKey } = params.pair

    const selfKeyPair = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    const selfPubKey = selfKeyPair.publicKey
    const selfPubHex = new Uint8Array(await crypto.subtle.exportKey("raw", selfPubKey)).toHex()

    const pairing = new CryptoChannel(client, pairingTopic, symKey)

    const { resolve, reject, promise } = Promise.withResolvers<RpcRequestPreinit<WcSessionProposeParams>>()

    pairing.addEventListener("request", (event) => {
      const request = event.data

      if (request.method !== "wc_sessionPropose")
        return

      resolve(request as RpcRequestPreinit<WcSessionProposeParams>)

      event.respondWith({ relay, responderPublicKey: selfPubHex })
    }, { signal: cleaner.signal })

    signal.addEventListener("abort", reject, { signal: cleaner.signal })

    await pairing.subscribe(signal)

    const proposal = await promise

    const peerPubRaw = Uint8Array.fromHex(proposal.params.proposer.publicKey)
    const peerPubKey = await crypto.subtle.importKey("raw", peerPubRaw, "X25519", false, [])

    const hkdfRaw = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peerPubKey }, selfKeyPair.privateKey, 256))
    const hkdfKey = await crypto.subtle.importKey("raw", hkdfRaw, "HKDF", false, ["deriveBits"])
    const hkdfAlg = { name: "HKDF", hash: "SHA-256", info: new Uint8Array(), salt: new Uint8Array() }

    const sessionKeyRaw = new Uint8Array(await crypto.subtle.deriveBits(hkdfAlg, hkdfKey, 8 * 32)) as Uint8Array<ArrayBuffer, 32>
    const sessionTpcHex = new Uint8Array(await crypto.subtle.digest("SHA-256", sessionKeyRaw)).toHex()

    const settling = new CryptoChannel(client, sessionTpcHex, sessionKeyRaw)

    await settling.subscribe(signal)

    const { self } = params

    const peer = proposal.params.proposer.metadata

    const { namespaces } = params

    const { requiredNamespaces = proposal.params.requiredNamespaces } = params
    const { optionalNamespaces = proposal.params.optionalNamespaces } = params

    const { expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) } = params

    const controller = { publicKey: selfPubHex, metadata: self }

    const settlement = await settling.request<boolean>({ method: "wc_sessionSettle", params: { relay, namespaces, requiredNamespaces, optionalNamespaces, pairingTopic, controller, expiry } })

    const session = new WcSession(settling, { self, peer, namespaces, requiredNamespaces, optionalNamespaces, expiry })

    return [session, settlement]
  }

}