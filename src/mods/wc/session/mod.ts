import { CryptoChannel } from "@/mods/crypto/mod.ts";
import { WcMetadata, WcSessionRequestParams, WcSessionSettleParams } from "@/mods/wc/mod.ts";
import { RpcRequestPreinit } from "@hazae41/jsonrpc";
import { DataRespondableEvent } from "@hazae41/plume";

export interface WcSessionEventMap {
  error: Event

  close: CloseEvent

  request: DataRespondableEvent<WcSessionRequestParams<unknown>, unknown>
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