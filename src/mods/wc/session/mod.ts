import { WcChannel } from "@/mods/wc/channel/mod.ts";
import { WcUserDisconnectedError } from "@/mods/wc/errors/mod.ts";
import { WcIdentity, WcRelay } from "@/mods/wc/mod.ts";
import { RpcError, RpcErrorInit, RpcRequestPreinit } from "@hazae41/jsonrpc";
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
  readonly request: WcRequest<T>
}

export interface WcRequest<T = unknown> {
  readonly method: string
  readonly params: T
  readonly expiry?: number
}

export interface WcSessionDeleteParams {
  readonly code: number
  readonly message: string
}

export interface WcSessionEventMap {
  ping: Event

  error: Event

  close: CloseEvent

  event: DataEvent<WcEventAndChain>

  settled: DataEvent<WcSessionSettleParams>

  request: DataRespondableEvent<WcSessionRequestParams<unknown>, unknown>

  deleted: DataEvent<RpcErrorInit>
}

export class WcSession extends EventTarget {

  readonly #aborter = new AbortController()

  constructor(
    readonly channel: WcChannel
  ) {
    super()

    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.closed })
    channel.addEventListener("error", this.#onChannelError.bind(this), { signal: this.closed })

    channel.addEventListener("request", this.#onChannelRequest.bind(this), { signal: this.closed })
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

    if (request.method === "wc_sessionSettle")
      return this.#onSessionSettle(event)
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

  #onSessionSettle(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionSettleParams>

    const subevent = new DataEvent("settled", { data: request.params })

    this.dispatchEvent(subevent)
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

  async open() {
    await this.channel.open()
  }

  async close(reason?: string) {
    return await this.channel.close(reason)
  }

  async settle(params: WcSessionSettleParams, signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionSettle", params }, signal).then(r => r.getOrThrow())
  }

  async ping(signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionPing", params: {} }, signal).then(r => r.getOrThrow())
  }

  async event(event: { name: string, data?: unknown }, chainId: number, signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionEvent", params: { event, chainId } }, signal).then(r => r.getOrThrow())
  }

  async extend(expiry: number, signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionExtend", params: { expiry } }, signal).then(r => r.getOrThrow())
  }

  async delete(params: RpcError = new WcUserDisconnectedError()): Promise<void> {
    await this.channel.publish({ method: "wc_sessionDelete", params })
  }

}