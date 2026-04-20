// deno-lint-ignore-file no-explicit-any

import type { Uint8Array } from "@/libs/bytes/mod.ts";
import { Jwt } from "@/libs/jwt/mod.ts";
import { CryptoChannel } from "@/mods/crypto/mod.ts";
import { IrnClient } from "@/mods/irn/mod.ts";
import { RpcRequestPreinit } from "@hazae41/jsonrpc";
import { DataExtendableEvent, DataRespondableEvent } from "@hazae41/plume";
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
  readonly settle: WcSessionSettleParams
}

export interface WcSessionEventMap {
  settled: Event,
  request: DataRespondableEvent<WcSessionRequestParams<unknown>, unknown>
}

export class WcSession extends EventTarget {

  readonly #aborter = new AbortController()

  constructor(
    readonly channel: CryptoChannel,
    readonly session: WcSessionData
  ) {
    super()

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.#aborter.signal })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.#aborter.signal })

    channel.addEventListener("request", this.#onChannelRequest.bind(this), { signal: this.#aborter.signal })
  }

  addEventListener<K extends keyof WcSessionEventMap>(type: K, listener: (e: WcSessionEventMap[K]) => void, options?: AddEventListenerOptions): void

  addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void

  addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void {
    super.addEventListener(type, callback, options)
  }

  get closed() {
    return this.channel.closed
  }

  #onChannelClose(event: CloseEvent) {
    const { reason } = event

    this.#aborter.abort()

    const subevent = new CloseEvent("close", { reason })

    this.dispatchEvent(subevent)
  }

  #onChannelError() {
    this.#aborter.abort()

    const subevent = new Event("error")

    this.dispatchEvent(subevent)
  }

  #onChannelRequest(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data

    if (request.method === "wc_sessionRequest")
      return this.#onSessionRequest(event)

    return
  }

  #onSessionRequest(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionRequestParams>

    const subevent = new DataRespondableEvent("request", { data: request.params })

    this.dispatchEvent(subevent)

    event.stopImmediatePropagation()
    event.waitUntil(subevent.extension)
    event.respondWith(subevent.response)
  }

  async subscribe(signal = new AbortController().signal) {
    await this.channel.subscribe(signal)
  }

  async fetch(signal = new AbortController().signal) {
    await this.channel.fetch(signal)
  }

  async settle() {
    await this.channel.publish({ method: "wc_sessionSettle", params: this.session.settle })
  }

  async delete(): Promise<void> {
    const params = { code: 6000, message: "User disconnected." }

    await this.channel.publish({ method: "wc_sessionDelete", params })

    await this.channel.close()
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

export interface WcPairingEventMap {
  proposal: DataRespondableEvent<WcSessionProposeParams, boolean>
  upgraded: DataExtendableEvent<WcSession>
}

export interface WcPairingParams {
  readonly self: WcMetadata
  readonly peer: WcPairParams

  readonly namespaces: unknown

  readonly requiredNamespaces?: unknown
  readonly optionalNamespaces?: unknown

  readonly expiry?: number
}

export class WcPairing extends EventTarget {

  readonly #aborter = new AbortController()

  constructor(
    readonly channel: CryptoChannel,
    readonly keypair: CryptoKeyPair,
    readonly params: WcPairingParams
  ) {
    super()

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.#aborter.signal })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.#aborter.signal })

    channel.addEventListener("request", this.#onChannelRequest.bind(this), { signal: this.#aborter.signal })
  }

  addEventListener<K extends keyof WcPairingEventMap>(type: K, listener: (e: WcPairingEventMap[K]) => void, options?: AddEventListenerOptions): void

  addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void

  addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void {
    super.addEventListener(type, callback, options)
  }

  get closed() {
    return this.channel.closed
  }

  #onChannelClose(event: CloseEvent) {
    const { reason } = event

    this.#aborter.abort()

    const subevent = new CloseEvent("close", { reason })

    this.dispatchEvent(subevent)
  }

  #onChannelError() {
    this.#aborter.abort()

    const subevent = new Event("error")

    this.dispatchEvent(subevent)
  }

  #onChannelRequest(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data

    if (request.method === "wc_sessionPropose")
      return this.#onSessionPropose(event).catch(console.error)

    return
  }

  async #onSessionPropose(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    using stack = new DisposableStack()

    const request = event.data as RpcRequestPreinit<WcSessionProposeParams>

    const { resolve, reject, promise } = Promise.withResolvers<unknown>()

    stack.defer(() => reject())

    event.stopImmediatePropagation()
    event.respondWith(promise)

    const proposal = new DataRespondableEvent("proposal", { data: request.params })

    this.dispatchEvent(proposal)

    await proposal.extension

    const response = await proposal.response

    if (response !== true)
      return

    const { relay } = this.channel.client

    const selfPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.keypair.publicKey))
    const selfPubHex = selfPubRaw.toHex()

    resolve({ relay, responderPublicKey: selfPubHex })

    const peerPubRaw = Uint8Array.fromHex(request.params.proposer.publicKey)
    const peerPubKey = await crypto.subtle.importKey("raw", peerPubRaw, "X25519", false, [])

    const hkdfRaw = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peerPubKey }, this.keypair.privateKey, 256))
    const hkdfKey = await crypto.subtle.importKey("raw", hkdfRaw, "HKDF", false, ["deriveBits"])
    const hkdfAlg = { name: "HKDF", hash: "SHA-256", info: new Uint8Array(), salt: new Uint8Array() }

    const sessionKeyRaw = new Uint8Array(await crypto.subtle.deriveBits(hkdfAlg, hkdfKey, 8 * 32)) as Uint8Array<ArrayBuffer, 32>
    const sessionTpcHex = new Uint8Array(await crypto.subtle.digest("SHA-256", sessionKeyRaw)).toHex()

    const channel = new CryptoChannel(this.channel.client, sessionTpcHex, sessionKeyRaw)

    const { self } = this.params

    const peer = request.params.proposer.metadata

    const { namespaces } = this.params

    const { requiredNamespaces = request.params.requiredNamespaces } = this.params
    const { optionalNamespaces = request.params.optionalNamespaces } = this.params

    const { expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) } = this.params

    const controller = { publicKey: selfPubHex, metadata: self }

    const settle = { relay, namespaces, requiredNamespaces, optionalNamespaces, pairingTopic: this.channel.topic, controller, expiry }

    const session = new WcSession(channel, { self, peer, namespaces, requiredNamespaces, optionalNamespaces, expiry, settle })

    const upgraded = new DataExtendableEvent("upgraded", { data: session })

    this.dispatchEvent(upgraded)

    await upgraded.extension
  }

  async subscribe(signal = new AbortController().signal) {
    await this.channel.subscribe(signal)
  }

  async fetch(signal = new AbortController().signal) {
    await this.channel.fetch(signal)
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

  export async function pair(client: IrnClient, params: WcPairingParams) {
    const { pairingTopic, symKey } = params.peer

    const channel = new CryptoChannel(client, pairingTopic, symKey)
    const keypair = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    return new WcPairing(channel, keypair, params)
  }

}