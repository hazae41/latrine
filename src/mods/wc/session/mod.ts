import { WcChannel } from "@/mods/wc/channel/mod.ts";
import { WcUserDisconnectedError } from "@/mods/wc/errors/mod.ts";
import { WcIdentity, WcRelay } from "@/mods/wc/mod.ts";
import { RpcError, RpcErrorInit, RpcRequestPreinit } from "@hazae41/jsonrpc";
import { DataEvent, DataRespondableEvent } from "@hazae41/plume";

export interface WcEvent {
  readonly name: string
  readonly data?: unknown
}

export interface WcRequest<T = unknown> {
  readonly method: string
  readonly params: T
  readonly expiry?: number
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

export interface WcSessionExtendParams {
  readonly expiry: number
}

export interface WcSessionEventParams {
  readonly event: WcEvent
  readonly chainId: number
}

export interface WcSessionUpdateParams {
  readonly namespaces: unknown
}

export interface WcSessionRequestParams<T = unknown> {
  readonly chainId: `${string}:${string}`
  readonly request: WcRequest<T>
}
export interface WcSessionDeleteParams {
  readonly code: number
  readonly message: string
}

export interface WcSessionEventMap {
  ping: Event

  close: CloseEvent

  settle: DataEvent<WcSessionSettleParams>

  extend: DataEvent<WcSessionExtendParams>

  event: DataEvent<WcSessionEventParams>

  update: DataEvent<WcSessionUpdateParams>

  request: DataRespondableEvent<WcSessionRequestParams<unknown>, unknown>

  delete: DataEvent<RpcErrorInit>
}

export class WcSession extends EventTarget {

  readonly channel: WcChannel

  constructor(channel: WcChannel) {
    super()

    this.channel = channel

    channel.addEventListener("request", this.#onChannelRequest.bind(this), { signal: this.closing })
    channel.addEventListener("close", this.#onChannelClose.bind(this), { signal: this.closing })
  }

  override addEventListener<K extends keyof WcSessionEventMap>(type: K, listener: (e: WcSessionEventMap[K]) => void, options?: AddEventListenerOptions): void

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

    if (request.method === "wc_sessionPing")
      return this.#onSessionPing(event)
    if (request.method === "wc_sessionSettle")
      return this.#onSessionSettle(event)
    if (request.method === "wc_sessionExtend")
      return this.#onSessionExtend(event)
    if (request.method === "wc_sessionEvent")
      return this.#onSessionEvent(event)
    if (request.method === "wc_sessionUpdate")
      return this.#onSessionUpdate(event)
    if (request.method === "wc_sessionRequest")
      return this.#onSessionRequest(event)
    if (request.method === "wc_sessionDelete")
      return this.#onSessionDelete(event)

    return
  }

  #onSessionPing(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const subevent = new Event("ping")

    this.dispatchEvent(subevent)

    event.respondWith(true)
  }

  #onSessionSettle(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionSettleParams>

    const subevent = new DataEvent("settle", { data: request.params })

    this.dispatchEvent(subevent)

    event.respondWith(true)
  }

  #onSessionExtend(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionExtendParams>

    const subevent = new DataEvent("extend", { data: request.params })

    this.dispatchEvent(subevent)

    event.respondWith(true)
  }

  #onSessionEvent(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionEventParams>

    const subevent = new DataEvent("event", { data: request.params })

    this.dispatchEvent(subevent)

    event.respondWith(true)
  }

  #onSessionUpdate(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionUpdateParams>

    const subevent = new DataEvent("update", { data: request.params })

    this.dispatchEvent(subevent)

    event.respondWith(true)
  }

  #onSessionRequest(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionRequestParams>

    const subevent = new DataRespondableEvent("request", { data: request.params })

    this.dispatchEvent(subevent)

    event.waitUntil(subevent.extension)

    if (subevent.response == null)
      return

    event.respondWith(subevent.response)
  }

  #onSessionDelete(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<RpcErrorInit>

    const subevent = new DataEvent("delete", { data: request.params })

    this.dispatchEvent(subevent)

    event.waitUntil(this.close())
    event.respondWith(true)
  }

  async open() {
    await this.channel.open()
  }

  async close(reason?: string) {
    await this.channel.close(reason)
  }

  async ping(signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionPing", params: {} }, signal).then(r => r.getOrThrow())
  }

  async settle(params: WcSessionSettleParams, signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionSettle", params }, signal).then(r => r.getOrThrow())
  }

  async extend(params: WcSessionExtendParams, signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionExtend", params }, signal).then(r => r.getOrThrow())
  }

  async event(params: WcSessionEventParams, signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionEvent", params }, signal).then(r => r.getOrThrow())
  }

  async update(params: WcSessionUpdateParams, signal = new AbortController().signal) {
    await this.channel.request<true>({ method: "wc_sessionUpdate", params }, signal).then(r => r.getOrThrow())
  }

  async request<T>(params: WcSessionRequestParams<unknown>, signal = new AbortController().signal) {
    return await this.channel.request<T>({ method: "wc_sessionRequest", params }, signal).then(r => r.getOrThrow())
  }

  async delete(params: RpcError = new WcUserDisconnectedError()): Promise<void> {
    await this.channel.publish({ method: "wc_sessionDelete", params })
  }

}