import { CryptoChannel } from "@/mods/crypto/mod.ts";
import { WcMetadata, WcSessionRequestParams, WcSessionSettleParams } from "@/mods/wc/mod.ts";
import { RpcRequestPreinit } from "@hazae41/jsonrpc";
import { DataEvent, DataRespondableEvent } from "@hazae41/plume";

export interface WcSessionEventMap {
  error: Event

  close: CloseEvent

  settled: DataEvent<WcSessionData>

  request: DataRespondableEvent<WcSessionRequestParams<unknown>, unknown>
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

  readonly #aborter = new AbortController()

  constructor(
    readonly channel: CryptoChannel
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
    if (request.method === "wc_sessionRequest")
      return this.#onSessionRequest(event)

    return
  }

  #onSessionSettle(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const params = event.data.params as WcSessionSettleParams

    this.dispatchEvent(new DataEvent("settled", { data: params }))

    event.stopImmediatePropagation()
    event.respondWith(true)
  }

  #onSessionRequest(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<WcSessionRequestParams>

    const subevent = new DataRespondableEvent("request", { data: request.params })

    this.dispatchEvent(subevent)

    event.stopImmediatePropagation()
    event.waitUntil(subevent.extension)
    event.respondWith(subevent.response)
  }

  async subscribe() {
    await this.channel.subscribe()
  }

  async fetch() {
    await this.channel.fetch()
  }

  async delete(): Promise<void> {
    const params = { code: 6000, message: "User disconnected." }

    await this.channel.publish({ method: "wc_sessionDelete", params })

    await this.channel.close()
  }

}