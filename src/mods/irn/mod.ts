import { SafeJson } from "@/libs/json/mod.ts";
import { SafeRpc } from "@/libs/rpc/mod.ts";
import { RpcInvalidRequestError, RpcMessageInit, RpcRequestInit, RpcRequestPreinit, RpcResponse } from "@hazae41/jsonrpc";
import { DataRespondableEvent } from "@hazae41/plume";
import { Result } from "@hazae41/result-and-option";

export interface IrnPublishPayload {
  readonly topic: string
  readonly message: string
  readonly prompt: boolean
  readonly tag: number
  readonly ttl: number
}

export interface IrnSubscriptionPayload {
  readonly id: string
  readonly data: IrnMessage
}

export interface IrnMessage {
  readonly topic: string
  readonly message: string
  readonly publishedAt: number
  readonly tag: number
}

export interface IrnClientEventMap {
  error: Event

  close: CloseEvent

  request: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>
}

export class IrnClient extends EventTarget {

  readonly #aborter = new AbortController()

  readonly #topics = new Map<string, string>()

  #closed?: { reason?: unknown }

  constructor(
    readonly socket: WebSocket
  ) {
    super()

    const { signal } = this.#aborter

    socket.addEventListener("message", this.#onSocketMessage.bind(this), { signal })
    socket.addEventListener("close", this.#onSocketClose.bind(this), { signal })
    socket.addEventListener("error", this.#onSocketError.bind(this), { signal })
  }

  [Symbol.dispose]() {
    this.close()
  }

  addEventListener<K extends keyof IrnClientEventMap>(type: K, listener: (e: IrnClientEventMap[K]) => void, options?: AddEventListenerOptions): void

  addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void

  addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void {
    super.addEventListener(type, callback, options)
  }

  get closed() {
    return this.#closed
  }

  get relay() {
    return { protocol: "irn" }
  }

  #onSocketClose(event: CloseEvent) {
    const { reason } = event

    this.#aborter.abort()

    this.#closed = { reason }

    const subevent = new CloseEvent("close", { reason })

    this.dispatchEvent(subevent)
  }

  #onSocketError() {
    this.#aborter.abort()

    this.#closed = {}

    const subevent = new Event("error")

    this.dispatchEvent(subevent)
  }

  #onSocketMessage(event: MessageEvent<unknown>) {
    if (typeof event.data !== "string")
      return

    const message = JSON.parse(event.data) as RpcMessageInit

    if ("method" in message)
      this.#onRequest(message).catch(console.error)

    return
  }

  async #onRequest(request: RpcRequestInit<unknown>) {
    const result = await Result.runAndWrap(() => this.#respond(request))

    const response = RpcResponse.rewrap(request.id, result)

    this.socket.send(SafeJson.stringify(response))
  }

  async #respond(request: RpcRequestInit<unknown>) {
    const event = new DataRespondableEvent("request", { data: request })

    this.dispatchEvent(event)

    await event.extension

    if (event.response != null)
      return await event.response

    throw new RpcInvalidRequestError()
  }

  async subscribe(topic: string, signal = new AbortController().signal): Promise<string> {
    const subsignal = AbortSignal.any([signal, this.#aborter.signal])

    const id = await SafeRpc.requestOrThrow<string>(this.socket, {
      method: "irn_subscribe",
      params: { topic }
    }, subsignal).then(r => r.getOrThrow())

    return id
  }

  async unsubscribe(id: string, topic: string, signal = new AbortController().signal): Promise<void> {
    const subsignal = AbortSignal.any([signal, this.#aborter.signal])

    await SafeRpc.requestOrThrow<true>(this.socket, {
      method: "irn_unsubscribe",
      params: { id, topic }
    }, subsignal).then(r => r.getOrThrow())

    return
  }

  async* fetch(topic: string, signal = new AbortController().signal): AsyncGenerator<IrnMessage> {
    const subsignal = AbortSignal.any([signal, this.#aborter.signal])

    while (true) {
      const data = await SafeRpc.requestOrThrow<{ messages: IrnMessage[], hasMore: boolean }>(this.socket, {
        method: "irn_fetchMessages",
        params: { topic }
      }, subsignal).then(r => r.getOrThrow())

      for (const message of data.messages)
        yield message

      if (!data.hasMore)
        break

      continue
    }
  }

  async publish(payload: IrnPublishPayload, signal = new AbortController().signal): Promise<void> {
    const subsignal = AbortSignal.any([signal, this.#aborter.signal])

    await SafeRpc.requestOrThrow<true>(this.socket, {
      method: "irn_publish",
      params: payload
    }, subsignal).then(r => r.getOrThrow())
  }

  close(reason?: string) {
    this.#aborter.abort()

    this.#closed = { reason }

    const event = new CloseEvent("close", { reason })

    this.dispatchEvent(event)

    this.socket.close()
  }

}