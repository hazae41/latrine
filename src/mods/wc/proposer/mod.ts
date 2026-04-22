import type { Uint8Array } from "@/libs/bytes/mod.ts";
import { CryptoChannel } from "@/mods/crypto/mod.ts";
import { WcMetadata, WcPairParams, WcSessionProposeResult, WcSessionSettleParams } from "@/mods/wc/mod.ts";
import { WcSession } from "@/mods/wc/session/mod.ts";
import { DataExtendableEvent } from "@hazae41/plume";

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

  constructor(
    readonly channel: CryptoChannel,
    readonly keypair: CryptoKeyPair,
    readonly params: WcProposerParams
  ) {
    super()

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.channel.closed })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.channel.closed })
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

    const subevent = new CloseEvent("close", { reason })

    this.dispatchEvent(subevent)
  }

  #onChannelError() {
    this.dispatchEvent(new Event("error"))
  }

  get url() {
    return WcPairParams.stringify({ protocol: "wc:", version: "2", relayProtocol: "irn", pairingTopic: this.channel.topic, symKey: this.channel.key })
  }

  async subscribe() {
    await this.channel.subscribe()
  }

  async fetch() {
    await this.channel.fetch()
  }

  async propose(signal = new AbortController().signal): Promise<WcSession> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const { self, requiredNamespaces = {}, optionalNamespaces = {} } = this.params

    const selfPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.keypair.publicKey))
    const selfPubHex = selfPubRaw.toHex()

    const proposer = { publicKey: selfPubHex, metadata: self }

    const relays = [this.channel.client.relay]

    const response = await this.channel.request<WcSessionProposeResult>({
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

    const { resolve, reject, promise } = Promise.withResolvers<WcSessionSettleParams>()

    channel.addEventListener("request", event => {
      const request = event.data

      if (request.method !== "wc_sessionSettle")
        return

      resolve(request.params as WcSessionSettleParams)

      event.stopImmediatePropagation()
      event.respondWith(true)
    }, { signal: cleaner.signal })

    signal.addEventListener("abort", reject, { signal: cleaner.signal })

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