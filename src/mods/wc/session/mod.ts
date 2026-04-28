import { WcChannel } from "@/mods/wc/channel/mod.ts";
import { WcIdentity, WcMetadata, WcRelay } from "@/mods/wc/mod.ts";
import { RpcRequestPreinit } from "@hazae41/jsonrpc";
import { DataEvent, DataRespondableEvent } from "@hazae41/plume";

export interface WcEvent {
  readonly name: string
  readonly data?: unknown
}

export interface WcEventAndChain {
  readonly event: WcEvent
  readonly chainId: number
}

export interface WcSessionProposeParams {
  readonly relays: WcRelay[]

  readonly proposer: WcIdentity

  readonly requiredNamespaces: unknown
  readonly optionalNamespaces: unknown
}

export interface WcSessionProposeResult {
  readonly relay: WcRelay
  readonly responderPublicKey: string
}

export interface WcSessionSettleParams {
  readonly relay: WcRelay

  readonly controller: WcIdentity

  readonly namespaces: unknown

  readonly requiredNamespaces: unknown
  readonly optionalNamespaces: unknown

  readonly pairingTopic: string
  readonly expiry: number
}

export interface WcSessionRequestParams<T = unknown> {
  readonly chainId: `${string}:${string}`
  readonly request: RpcRequestPreinit<T>
}

export interface WcSessionEventMap {
  ping: Event

  error: Event

  close: CloseEvent

  event: DataEvent<WcEventAndChain>

  settled: DataEvent<WcSessionData>

  request: DataRespondableEvent<WcSessionRequestParams<unknown>, unknown>

  deleted: DataEvent<{ code: number, message: string }>
}

export interface WcSessionData {
  readonly self: WcMetadata
  readonly peer: WcMetadata

  readonly namespaces: unknown

  readonly requiredNamespaces: unknown
  readonly optionalNamespaces: unknown

  readonly expiry: number
}

export class WcSession extends EventTarget {

  readonly channel: WcChannel

  readonly #aborter = new AbortController()

  readonly settled: Promise<WcSessionData>

  constructor(channel: WcChannel, settled?: WcSessionData) {
    super()

    this.channel = channel

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.closed })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.closed })

    channel.addEventListener("request", this.#onChannelRequest.bind(this), { signal: this.closed })

    if (settled == null) {
      const { resolve, reject, promise } = Promise.withResolvers<WcSessionData>()

      this.addEventListener("settled", e => resolve(e.data), { signal: this.closed })
      this.#aborter.signal.addEventListener("abort", reject, { signal: this.closed })

      this.settled = promise
    } else {
      this.settled = Promise.resolve(settled)
    }
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

    if (request.method === "wc_sessionPing")
      return this.#onSessionPing(event)
    if (request.method === "wc_sessionEvent")
      return this.#onSessionEvent(event)
    if (request.method === "wc_sessionRequest")
      return this.#onSessionRequest(event)
    if (request.method === "wc_sessionDelete")
      return

    return
  }

  #onSessionPing(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const subevent = new Event("ping")

    this.dispatchEvent(subevent)

    event.stopImmediatePropagation()
    event.respondWith(true)
  }

  #onSessionEvent(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcEventAndChain>

    const subevent = new DataEvent("event", { data: request.params })

    this.dispatchEvent(subevent)

    event.stopImmediatePropagation()
    event.respondWith(true)
  }

  #onSessionRequest(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionRequestParams>

    const subevent = new DataRespondableEvent("request", { data: request.params })

    this.dispatchEvent(subevent)

    event.waitUntil(subevent.extension)

    if (subevent.response == null)
      return

    event.stopImmediatePropagation()
    event.respondWith(subevent.response)
  }

  async subscribe() {
    await this.channel.subscribe()
  }

  async fetch() {
    await this.channel.fetch()
  }

  async ping(signal = new AbortController().signal) {
    await this.channel.request<true>({
      method: "wc_sessionPing",
      params: {}
    }, signal).then(r => r.getOrThrow())
  }

  async event(event: { name: string, data?: unknown }, chainId: number, signal = new AbortController().signal) {
    await this.channel.request<true>({
      method: "wc_sessionEvent",
      params: { event, chainId }
    }, signal).then(r => r.getOrThrow())
  }

  async delete(): Promise<void> {
    const params = { code: 6000, message: "User disconnected." }

    await this.channel.publish({ method: "wc_sessionDelete", params })

    await this.channel.close()
  }

}