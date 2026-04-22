import type { Uint8Array } from "@/libs/bytes/mod.ts";
import { WcMetadata, WcPairParams, WcSessionProposeParams } from "@/mod.ts";
import { CryptoChannel } from "@/mods/crypto/mod.ts";
import { WcSession } from "@/mods/wc/session/mod.ts";
import { RpcRequestPreinit } from "@hazae41/jsonrpc";
import { DataExtendableEvent, DataRespondableEvent } from "@hazae41/plume";

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

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.closed })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.closed })

    channel.addEventListener("request", this.#onChannelRequest.bind(this), { signal: this.closed })
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

  async subscribe() {
    await this.channel.subscribe()
  }

  async fetch() {
    await this.channel.fetch()
  }

}