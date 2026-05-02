import { SafeJson } from "@/libs/json/mod.ts";
import { Jwt } from "@/libs/jwt/mod.ts";
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
  close: CloseEvent

  request: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>
}

export class IrnClient extends EventTarget {

  readonly #closing = new AbortController()

  constructor(
    readonly socket: WebSocket
  ) {
    super()

    socket.addEventListener("message", this.#onSocketMessage.bind(this), { signal: this.closing })
    socket.addEventListener("close", this.#onSocketClose.bind(this), { signal: this.closing })
  }

  static async open(relay: string, jwk: Uint8Array<ArrayBuffer>, projectId: string, signal = new AbortController().signal): Promise<IrnClient> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const jwt = await Jwt.signOrThrow(jwk, relay)

    const socket = new WebSocket(`${relay}/?auth=${jwt}&projectId=${projectId}`)

    const opened = Promise.withResolvers()
    stack.defer(() => opened.reject())
    opened.promise.catch(() => { })

    socket.addEventListener("open", opened.resolve, { signal: cleaner.signal })
    signal.addEventListener("abort", opened.reject, { signal: cleaner.signal })

    await opened.promise

    return new IrnClient(socket)
  }

  [Symbol.dispose]() {
    this.close()
  }

  override addEventListener<K extends keyof IrnClientEventMap>(type: K, listener: (e: IrnClientEventMap[K]) => void, options?: AddEventListenerOptions): void

  override addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void

  override addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void {
    super.addEventListener(type, callback, options)
  }

  get closing() {
    return this.#closing.signal
  }

  get relay() {
    return { protocol: "irn" }
  }

  #onSocketClose(event: CloseEvent) {
    if (this.closing.aborted)
      return

    const { reason } = event

    const subevent = new CloseEvent("close", { reason })

    this.dispatchEvent(subevent)

    this.#closing.abort(reason)
  }

  #onSocketMessage(event: MessageEvent<unknown>) {
    if (typeof event.data !== "string")
      return

    const message = JSON.parse(event.data) as RpcMessageInit

    if ("method" in message === false)
      return

    this.#onRequest(message).catch(console.error)
  }

  async #onRequest(request: RpcRequestInit<unknown>) {
    const result = await Result.runAndWrap(() => this.#respond(request))

    const response = RpcResponse.rewrap(request.id, result)

    this.socket.send(SafeJson.stringify(response))
  }

  async #respond(request: RpcRequestPreinit<unknown>) {
    const subevent = new DataRespondableEvent("request", { data: request })

    this.dispatchEvent(subevent)

    await subevent.extension

    if (subevent.response != null)
      return await subevent.response

    throw new RpcInvalidRequestError()
  }

  async subscribe(topic: string): Promise<string> {
    return await SafeRpc.requestOrThrow<string>(this.socket, {
      method: "irn_subscribe",
      params: { topic }
    }).then(r => r.getOrThrow())
  }

  async unsubscribe(id: string, topic: string): Promise<void> {
    await SafeRpc.requestOrThrow<true>(this.socket, {
      method: "irn_unsubscribe",
      params: { id, topic }
    }).then(r => r.getOrThrow())
  }

  async* fetch(topic: string): AsyncGenerator<IrnMessage> {
    while (true) {
      const data = await SafeRpc.requestOrThrow<{ messages: IrnMessage[], hasMore: boolean }>(this.socket, {
        method: "irn_fetchMessages",
        params: { topic }
      }).then(r => r.getOrThrow())

      for (const message of data.messages)
        yield message

      if (!data.hasMore)
        break

      continue
    }
  }

  async publish(payload: IrnPublishPayload): Promise<void> {
    await SafeRpc.requestOrThrow<true>(this.socket, {
      method: "irn_publish",
      params: payload
    }).then(r => r.getOrThrow())
  }

  close(reason?: string) {
    this.socket.close(undefined, reason)
  }

}