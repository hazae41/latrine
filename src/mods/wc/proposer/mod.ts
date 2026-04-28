import { IrnClient } from "@/mods/irn/mod.ts";
import { WcChannel } from "@/mods/wc/channel/mod.ts";
import { WcMetadata, WcPairParams, WcSessionProposeResult, WcSessionSettleParams } from "@/mods/wc/mod.ts";
import { WcSession } from "@/mods/wc/session/mod.ts";
import { DataEvent } from "@hazae41/plume";

export interface WcProposerEventMap {
  error: Event

  close: CloseEvent

  upgraded: DataEvent<WcSession>
}

export interface WcProposerParams {
  readonly self: WcMetadata

  readonly requiredNamespaces?: unknown
  readonly optionalNamespaces?: unknown
}

export class WcProposer extends EventTarget {

  constructor(
    readonly channel: WcChannel,
    readonly keypair: CryptoKeyPair,
    readonly params: WcProposerParams
  ) {
    super()

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.channel.closed })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.channel.closed })
  }

  static async from(client: IrnClient, params: WcProposerParams) {
    const topic = crypto.getRandomValues(new Uint8Array(32)).toHex()
    const symkey = crypto.getRandomValues(new Uint8Array(32))

    const channel = new WcChannel(client, topic, symkey)
    const keypair = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    return new WcProposer(channel, keypair, params)
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

  async propose() {
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

    const sessionKeyRaw = new Uint8Array(await crypto.subtle.deriveBits(hkdfAlg, hkdfKey, 8 * 32))
    const sessionTpcHex = new Uint8Array(await crypto.subtle.digest("SHA-256", sessionKeyRaw)).toHex()

    const session = new WcSession(new WcChannel(this.channel.client, sessionTpcHex, sessionKeyRaw))

    this.dispatchEvent(new DataEvent("upgraded", { data: session }))

    const cleaner = new AbortController()

    session.channel.addEventListener("request", (event) => {
      const request = event.data

      if (request.method !== "wc_sessionSettle")
        return

      const { controller, namespaces, requiredNamespaces, optionalNamespaces, expiry } = request.params as WcSessionSettleParams

      session.dispatchEvent(new DataEvent("settled", { data: { self, peer: controller.metadata, namespaces, requiredNamespaces, optionalNamespaces, expiry } }))

      event.stopImmediatePropagation()
      event.respondWith(true)

      cleaner.abort()
    }, { signal: cleaner.signal })

    session.channel.addEventListener("close", () => cleaner.abort(), { signal: cleaner.signal })
  }

  async close(reason?: string) {
    return this.channel.close(reason)
  }

}