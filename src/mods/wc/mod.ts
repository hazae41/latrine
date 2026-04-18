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

    this.client.irn.close(reason)
  }

}

export interface WcPairParams {
  readonly protocol: "wc:"
  readonly version: "2"
  readonly pairingTopic: string
  readonly relayProtocol: "irn"
  readonly symKey: Uint8Array<ArrayBuffer, 32>
}

export interface WcSessionParams {
  readonly protocol: "wc:"
  readonly version: "2"
  readonly sessionTopic: string
  readonly relayProtocol: "irn"
  readonly symKey: Uint8Array<ArrayBuffer, 32>
}

export namespace Wc {

  export const RELAY = "wss://relay.walletconnect.org"

  export function parseOrThrow(rawUrl: string | URL): WcPairParams {
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

  export async function pairOrThrow(irn: IrnClient, params: WcPairParams, metadata: WcMetadata, address: string, chains: number[], timeout: number): Promise<[WcSession, RpcReceiptAndPromise<boolean>]> {
    const { pairingTopic, symKey } = params

    const pairing = CryptoClient.createOrThrow(irn, pairingTopic, symKey, timeout)

    const relay = { protocol: "irn" }

    const selfPairRef = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    const selfPrivateRef = selfPairRef.privateKey
    const selfPublicRef = selfPairRef.publicKey

    const selfPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", selfPublicRef))
    const selfPublicHex = selfPublicRaw.toHex()

    await irn.subscribe(pairingTopic, AbortSignal.timeout(timeout))

    const preproposal = Promise.withResolvers<RpcRequestPreinit<WcSessionProposeParams>>()

    pairing.addEventListener("request", (event) => {
      const request = event.data

      if (request.method !== "wc_sessionPropose")
        return

      preproposal.resolve(request as RpcRequestPreinit<WcSessionProposeParams>)

      event.respondWith({ relay, responderPublicKey: selfPublicHex })
    }, { once: true })

    const proposal = await preproposal.promise

    const peerPublicRaw = Uint8Array.fromHex(proposal.params.proposer.publicKey)
    const peerPublicRef = await crypto.subtle.importKey("raw", peerPublicRaw, "X25519", false, [])

    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peerPublicRef }, selfPrivateRef, 256))

    const hdfk_key = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"])
    const hkdf_params = { name: "HKDF", hash: "SHA-256", info: new Uint8Array(), salt: new Uint8Array() }

    const sessionKey = new Uint8Array(await crypto.subtle.deriveBits(hkdf_params, hdfk_key, 8 * 32)) as Uint8Array<ArrayBuffer, 32>
    const sessionTopic = new Uint8Array(await crypto.subtle.digest("SHA-256", sessionKey)).toHex()
    const session = CryptoClient.createOrThrow(irn, sessionTopic, sessionKey, timeout)

    await irn.subscribe(sessionTopic, AbortSignal.timeout(timeout))

    {
      const { proposer, requiredNamespaces, optionalNamespaces } = proposal.params

      const namespaces = {
        eip155: {
          chains: chains.map(chainId => `eip155:${chainId}`),
          methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
          events: ["chainChanged", "accountsChanged"],
          accounts: chains.map(chainId => `eip155:${chainId}:${address}`)
        }
      }

      const controller = { publicKey: selfPublicHex, metadata }
      const expiry = Math.floor((Date.now() + (7 * 24 * 60 * 60 * 1000)) / 1000)
      const params: WcSessionSettleParams = { relay, namespaces, requiredNamespaces, optionalNamespaces, pairingTopic, controller, expiry }

      const settlement = await session.requestOrThrow<boolean>({ method: "wc_sessionSettle", params })

      return [new WcSession(session, proposer.metadata), settlement]
    }
  }

}