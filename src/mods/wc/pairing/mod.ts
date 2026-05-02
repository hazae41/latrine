import { IrnClient } from "@/mods/irn/mod.ts";
import { WcChannel } from "@/mods/wc/channel/mod.ts";
import { WcUserDisconnectedError } from "@/mods/wc/errors/mod.ts";
import { WcMetadata, WcSessionProposeResult } from "@/mods/wc/mod.ts";
import { WcSession, WcSessionProposeParams } from "@/mods/wc/session/mod.ts";
import { RpcError, RpcErrorInit, RpcRequestPreinit } from "@hazae41/jsonrpc";
import { DataEvent, DataRespondableEvent } from "@hazae41/plume";
import { Option } from "@hazae41/result-and-option";

export interface WcProposeParams {
  readonly self: WcMetadata

  readonly requiredNamespaces?: unknown
  readonly optionalNamespaces?: unknown
}

export interface WcRespondParams {
  readonly self: WcMetadata

  readonly namespaces: unknown

  readonly expiry?: number
}

export interface WcPairingParams {
  readonly protocol: "wc:"
  readonly version: "2"
  readonly pairingTopic: string
  readonly relayProtocol: "irn"
  readonly symKey: Uint8Array<ArrayBuffer>
}

export namespace WcPairingParams {

  export function stringify(params: WcPairingParams): string {
    const { protocol, version, pairingTopic, relayProtocol, symKey } = params

    const url = new URL(`${protocol}${pairingTopic}@${version}`)

    url.searchParams.set("relay-protocol", relayProtocol)
    url.searchParams.set("symKey", symKey.toHex())

    return url.toString()
  }

  export function parse(rawUrl: string | URL): WcPairingParams {
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
    const symKeyRaw = Uint8Array.fromHex(symKeyHex)

    return { protocol, pairingTopic, version, relayProtocol, symKey: symKeyRaw }
  }

}

export interface WcPairingEventMap {
  ping: Event

  close: CloseEvent

  propose: DataRespondableEvent<WcSessionProposeParams, WcSessionProposeResult>

  upgrade: DataEvent<WcSession>

  delete: DataEvent<RpcErrorInit>
}

export class WcPairing extends EventTarget {

  constructor(
    readonly channel: WcChannel,
    readonly keypair: CryptoKeyPair,
    readonly params: WcPairingParams
  ) {
    super()

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.closing })
    channel.addEventListener("request", this.#onChannelRequest.bind(this), { signal: this.closing })
  }

  static async generate(client: IrnClient) {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const tpc = new Uint8Array(await crypto.subtle.digest("SHA-256", key)).toHex()

    const channel = new WcChannel(client, tpc, key)
    const keypair = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    return new WcPairing(channel, keypair, { protocol: "wc:", version: "2", relayProtocol: "irn", pairingTopic: tpc, symKey: key })
  }

  static async from(client: IrnClient, params: WcPairingParams) {
    const { pairingTopic, symKey } = params

    const channel = new WcChannel(client, pairingTopic, symKey)
    const keypair = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]) as CryptoKeyPair

    return new WcPairing(channel, keypair, params)
  }

  override addEventListener<K extends keyof WcPairingEventMap>(type: K, listener: (e: WcPairingEventMap[K]) => void, options?: AddEventListenerOptions): void

  override addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void

  override addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void {
    super.addEventListener(type, callback, options)
  }

  get closing() {
    return this.channel.closing
  }

  #onChannelClose(event: CloseEvent) {
    const { reason } = event

    const subevent = new CloseEvent("close", { reason })

    this.dispatchEvent(subevent)
  }

  #onChannelRequest(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data

    if (request.method === "wc_sessionPropose")
      return this.#onSessionPropose(event)
    if (request.method === "wc_pairingPing")
      return this.#onPairingPing(event)
    if (request.method === "wc_pairingDelete")
      return this.#onPairingDelete(event)

    return
  }

  #onSessionPropose(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionProposeParams>

    const subevent = new DataRespondableEvent("propose", { data: request.params })

    this.dispatchEvent(subevent)

    event.waitUntil(subevent.extension)

    if (subevent.response == null)
      return

    event.respondWith(subevent.response)
  }

  #onPairingPing(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const subevent = new Event("ping")

    this.dispatchEvent(subevent)

    event.respondWith(true)
  }

  #onPairingDelete(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<RpcErrorInit>

    const subevent = new DataEvent("delete", { data: request.params })

    this.dispatchEvent(subevent)

    event.waitUntil(this.close())
    event.respondWith(true)
  }

  get url() {
    return WcPairingParams.stringify(this.params)
  }

  async open() {
    await this.channel.open()
  }

  async close(reason?: string) {
    await this.channel.close(reason)
  }

  async propose(params: WcProposeParams) {
    const { self, requiredNamespaces = {}, optionalNamespaces = {} } = params

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

    this.dispatchEvent(new DataEvent("upgrade", { data: session }))
  }

  async respond(proposal: WcSessionProposeParams): Promise<WcSessionProposeResult> {
    const { relay } = this.channel.client

    const selfPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.keypair.publicKey))
    const selfPubHex = selfPubRaw.toHex()

    const peerPubRaw = Uint8Array.fromHex(proposal.proposer.publicKey)
    const peerPubKey = await crypto.subtle.importKey("raw", peerPubRaw, "X25519", false, [])

    const hkdfRaw = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peerPubKey }, this.keypair.privateKey, 256))
    const hkdfKey = await crypto.subtle.importKey("raw", hkdfRaw, "HKDF", false, ["deriveBits"])
    const hkdfAlg = { name: "HKDF", hash: "SHA-256", info: new Uint8Array(), salt: new Uint8Array() }

    const sessionKeyRaw = new Uint8Array(await crypto.subtle.deriveBits(hkdfAlg, hkdfKey, 8 * 32))
    const sessionTpcHex = new Uint8Array(await crypto.subtle.digest("SHA-256", sessionKeyRaw)).toHex()

    const session = new WcSession(new WcChannel(this.channel.client, sessionTpcHex, sessionKeyRaw))

    this.dispatchEvent(new DataEvent("upgrade", { data: session }))

    return { relay, responderPublicKey: selfPubHex }
  }

  async ping(signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_pairingPing", params: {} }, signal).then(r => r.getOrThrow())
  }

  async extend(expiry: number, signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_pairingExtend", params: { expiry } }, signal).then(r => r.getOrThrow())
  }

  async delete(params: RpcError = new WcUserDisconnectedError()): Promise<void> {
    await this.channel.publish({ method: "wc_pairingDelete", params })
  }

}