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

export interface WcResponderEventMap {
  error: Event

  close: CloseEvent

  proposal: DataRespondableEvent<WcSessionProposeParams, boolean>

  upgraded: DataExtendableEvent<WcSession>
}

export interface WcResponderParams {
  readonly self: WcMetadata
  readonly peer: WcPairParams

  readonly namespaces: unknown

  readonly requiredNamespaces?: unknown
  readonly optionalNamespaces?: unknown

  readonly expiry?: number
}

export class WcResponder extends EventTarget {

  readonly #aborter = new AbortController()

  constructor(
    readonly channel: CryptoChannel,
    readonly keypair: CryptoKeyPair,
    readonly params: WcResponderParams
  ) {
    super()

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.#aborter.signal })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.#aborter.signal })

    channel.addEventListener("request", this.#onChannelRequest.bind(this), { signal: this.#aborter.signal })
  }

  addEventListener<K extends keyof WcResponderEventMap>(type: K, listener: (e: WcResponderEventMap[K]) => void, options?: AddEventListenerOptions): void

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

export interface WcProposerEventMap {
  error: Event

  close: CloseEvent

  upgraded: DataExtendableEvent<WcSession>
}

export interface WcProposerParams {
  readonly self: WcMetadata

  readonly requiredNamespaces?: unknown
  readonly optionalNamespaces?: unknown
}

export class WcProposer extends EventTarget {

  readonly #aborter = new AbortController()

  constructor(
    readonly channel: CryptoChannel,
    readonly keypair: CryptoKeyPair,
    readonly params: WcProposerParams
  ) {
    super()

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.#aborter.signal })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.#aborter.signal })
  }

  addEventListener<K extends keyof WcProposerEventMap>(type: K, listener: (e: WcProposerEventMap[K]) => void, options?: AddEventListenerOptions): void

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

  get url() {
    return WcPairParams.stringify({ protocol: "wc:", version: "2", relayProtocol: "irn", pairingTopic: this.channel.topic, symKey: this.channel.key })
  }

  async subscribe(signal = new AbortController().signal) {
    await this.channel.subscribe(signal)
  }

  async fetch(signal = new AbortController().signal) {
    await this.channel.fetch(signal)
  }

  async propose(): Promise<WcSession> {
    const { self, requiredNamespaces = {}, optionalNamespaces = {} } = this.params

    const selfPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.keypair.publicKey))
    const selfPubHex = selfPubRaw.toHex()

    const proposer = { publicKey: selfPubHex, metadata: self }

    const relays = [this.channel.client.relay]

    const response = await this.channel.request<{
      relay: { protocol: string }
      responderPublicKey: string
    }>({
      method: "wc_sessionPropose",
      params: { proposer, relays, requiredNamespaces, optionalNamespaces }
    }).then(r => r.getOrThrow())

    const peerPubRaw = Uint8Array.fromHex(response.responderPublicKey)
    const peerPubKey = await crypto.subtle.importKey("raw", peerPubRaw, "X25519", false, [])

    const hkdfRaw = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peerPubKey }, this.keypair.privateKey, 256))
    const hkdfKey = await crypto.subtle.importKey("raw", hkdfRaw, "HKDF", false, ["deriveBits"])
    const hkdfAlg = { name: "HKDF", hash: "SHA-256", info: new Uint8Array(), salt: new Uint8Array() }

    const sessionKeyRaw = new Uint8Array(await crypto.subtle.deriveBits(hkdfAlg, hkdfKey, 8 * 32)) as Uint8Array<ArrayBuffer, 32>
    const sessionTpcHex = new Uint8Array(await crypto.subtle.digest("SHA-256", sessionKeyRaw)).toHex()

    const channel = new CryptoChannel(this.channel.client, sessionTpcHex, sessionKeyRaw)

    const { resolve, promise } = Promise.withResolvers<WcSessionSettleParams>()

    channel.addEventListener("request", event => {
      const request = event.data

      if (request.method !== "wc_sessionSettle")
        return

      resolve(request.params as WcSessionSettleParams)
    })

    await channel.subscribe()

    await channel.fetch()

    const settle = await promise

    {
      const { namespaces, requiredNamespaces = {}, optionalNamespaces = {}, expiry } = settle

      const session = new WcSession(channel, { self, peer: settle.controller.metadata, namespaces, requiredNamespaces, optionalNamespaces, expiry, settle })

      return session
    }
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