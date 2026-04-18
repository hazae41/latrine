// deno-lint-ignore-file no-explicit-any

import type { Uint8Array } from "@/libs/bytes/mod.ts";
import { CryptoClient, RpcReceiptAndPromise } from "@/mods/crypto/mod.ts";
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

export class WcSession {

  constructor(
    readonly client: CryptoClient,
    readonly metadata: WcMetadata
  ) { }

  async close(reason?: string): Promise<void> {
    const params = { code: 6000, message: "User disconnected." }

    await this.client.requestOrThrow({ method: "wc_sessionDelete", params })

    this.client.close(reason)
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
      throw new Error(`Invalid protocol`)

    const [pairingTopic, version] = pathname.split("@")

    if (version !== "2")
      throw new Error(`Invalid version`)

    const relayProtocol = Option.wrap(searchParams.get("relay-protocol")).getOrThrow()

    if (relayProtocol !== "irn")
      throw new Error(`Invalid relay protocol`)

    const symKeyHex = Option.wrap(searchParams.get("symKey")).getOrThrow()
    const symKeyRaw = Uint8Array.fromHex(symKeyHex) as Uint8Array<ArrayBuffer, 32>

    return { protocol, pairingTopic, version, relayProtocol, symKey: symKeyRaw }
  }

}

export interface WcSessionParams {
  readonly protocol: "wc:"
  readonly version: "2"
  readonly sessionTopic: string
  readonly relayProtocol: "irn"
  readonly symKey: Uint8Array<ArrayBuffer, 32>
}

export namespace WcSessionParams {

  export function stringify(params: WcSessionParams): string {
    const { protocol, version, sessionTopic, relayProtocol, symKey } = params

    const url = new URL(`${protocol}${sessionTopic}@${version}`)

    url.searchParams.set("relay-protocol", relayProtocol)
    url.searchParams.set("symKey", symKey.toHex())

    return url.toString()
  }

  export function parse(rawUrl: string | URL): WcSessionParams {
    const { protocol, pathname, searchParams } = new URL(rawUrl)

    if (protocol !== "wc:")
      throw new Error(`Invalid protocol`)

    const [sessionTopic, version] = pathname.split("@")

    if (version !== "2")
      throw new Error(`Invalid version`)

    const relayProtocol = Option.wrap(searchParams.get("relay-protocol")).getOrThrow()

    if (relayProtocol !== "irn")
      throw new Error(`Invalid relay protocol`)

    const symKeyHex = Option.wrap(searchParams.get("symKey")).getOrThrow()
    const symKeyRaw = Uint8Array.fromHex(symKeyHex) as Uint8Array<ArrayBuffer, 32>

    return { protocol, sessionTopic, version, relayProtocol, symKey: symKeyRaw }
  }

}

export namespace Wc {

  export const RELAY = "wss://relay.walletconnect.org"

  export async function pair(irn: IrnClient, params: WcPairParams, metadata: WcMetadata, namespaces: unknown, signal = new AbortController().signal): Promise<[WcSession, RpcReceiptAndPromise<boolean>]> {
    const relay = { protocol: "irn" }

    const pairing = new CryptoClient(irn, params.pairingTopic, params.symKey)

    await irn.subscribe(params.pairingTopic, signal)

    const selfKeyPair = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    const selfPubKey = selfKeyPair.publicKey
    const selfPubHex = new Uint8Array(await crypto.subtle.exportKey("raw", selfPubKey)).toHex()

    const preproposal = Promise.withResolvers<RpcRequestPreinit<WcSessionProposeParams>>()

    pairing.addEventListener("request", (event) => {
      const request = event.data

      if (request.method !== "wc_sessionPropose")
        return

      preproposal.resolve(request as RpcRequestPreinit<WcSessionProposeParams>)

      event.respondWith({ relay, responderPublicKey: selfPubHex })
    }, { once: true })

    const proposal = await preproposal.promise

    const peerPubRaw = Uint8Array.fromHex(proposal.params.proposer.publicKey)
    const peerPubKey = await crypto.subtle.importKey("raw", peerPubRaw, "X25519", false, [])

    const hkdfRaw = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peerPubKey }, selfKeyPair.privateKey, 256))
    const hkdfKey = await crypto.subtle.importKey("raw", hkdfRaw, "HKDF", false, ["deriveBits"])

    const hkdf = { name: "HKDF", hash: "SHA-256", info: new Uint8Array(), salt: new Uint8Array() }

    const sessionKeyRaw = new Uint8Array(await crypto.subtle.deriveBits(hkdf, hkdfKey, 8 * 32)) as Uint8Array<ArrayBuffer, 32>
    const sessionTpcHex = new Uint8Array(await crypto.subtle.digest("SHA-256", sessionKeyRaw)).toHex()

    const session = new CryptoClient(irn, sessionTpcHex, sessionKeyRaw)

    await irn.subscribe(sessionTpcHex, signal)

    const { proposer, requiredNamespaces, optionalNamespaces } = proposal.params

    const controller = { publicKey: selfPubHex, metadata }
    const expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)

    const params2: WcSessionSettleParams = { relay, namespaces, requiredNamespaces, optionalNamespaces, pairingTopic: params.pairingTopic, controller, expiry }

    const settlement = await session.requestOrThrow<boolean>({ method: "wc_sessionSettle", params: params2 })

    return [new WcSession(session, proposer.metadata), settlement]
  }

}