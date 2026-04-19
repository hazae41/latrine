import { SafeJson } from "@/libs/json/mod.ts";
import { Jwt } from "@/libs/jwt/mod.ts";
import { SafeRpc } from "@/libs/rpc/mod.ts";
import { RpcErr, RpcError, RpcInvalidRequestError, RpcMessageInit, RpcOk, RpcRequestInit, RpcRequestPreinit } from "@hazae41/jsonrpc";
import { DataRespondableEvent } from "@hazae41/plume";

export interface IrnPublishPayload {
  readonly topic: string
  readonly message: string
  readonly prompt: boolean
  readonly tag: number
  readonly ttl: number
}

export interface IrnSubscriptionPayload {
  readonly id: string
  readonly data: IrnSubscriptionPayloadData
}

export interface IrnSubscriptionPayloadData {
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

export interface IrnClientParams {
  readonly shouldCloseOnDispose?: boolean
}

export class IrnClient extends EventTarget {

  readonly #aborter = new AbortController()

  readonly #topics = new Map<string, string>()

  #closed?: { reason?: unknown }

  constructor(
    readonly socket: WebSocket,
    readonly params: IrnClientParams = {}
  ) {
    super()

    const { signal } = this.#aborter

    socket.addEventListener("message", this.#onSocketMessage.bind(this), { signal })
    socket.addEventListener("close", this.#onSocketClose.bind(this), { signal })
    socket.addEventListener("error", this.#onSocketError.bind(this), { signal })
  }

  static async open(url = "wss://relay.walletconnect.org", projectId: string, params: IrnClientParams = {}, signal = new AbortController().signal): Promise<IrnClient> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const jwk = crypto.getRandomValues(new Uint8Array(32))
    const jwt = await Jwt.signOrThrow(jwk, url)

    const socket = new WebSocket(`${url}/?auth=${jwt}&projectId=${projectId}`)

    const { resolve, reject, promise } = Promise.withResolvers()

    socket.addEventListener("open", resolve, { signal: cleaner.signal })
    socket.addEventListener("error", reject, { signal: cleaner.signal })
    signal.addEventListener("abort", reject, { signal: cleaner.signal })

    await promise

    return new IrnClient(socket, params)
  }

  [Symbol.dispose]() {
    if (this.closed)
      return

    this.#aborter.abort()

    const { shouldCloseOnDispose = true } = this.params

    if (!shouldCloseOnDispose)
      return

    return this.close()
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
    this.socket.send(SafeJson.stringify(await this.#respond(request)))
  }

  async #respond(request: RpcRequestInit<unknown>) {
    try {
      const event = new DataRespondableEvent("request", { data: request })

      this.dispatchEvent(event)

      await event.extension

      if (event.response != null)
        return new RpcOk(request.id, await event.response)

      return new RpcErr(request.id, new RpcInvalidRequestError())
    } catch (e: unknown) {
      return new RpcErr(request.id, RpcError.rewrap(e))
    }
  }

  async subscribe(topic: string, signal = new AbortController().signal): Promise<string> {
    const subsignal = AbortSignal.any([signal, this.#aborter.signal])

    const subscription = await SafeRpc.requestOrThrow<string>(this.socket, {
      method: "irn_subscribe",
      params: { topic }
    }, subsignal).then(r => r.getOrThrow())

    this.#topics.set(subscription, topic)

    return subscription
  }

  async publish(payload: IrnPublishPayload, signal = new AbortController().signal): Promise<void> {
    const subsignal = AbortSignal.any([signal, this.#aborter.signal])

    const result = await SafeRpc.requestOrThrow<boolean>(this.socket, {
      method: "irn_publish",
      params: payload
    }, subsignal).then(r => r.getOrThrow())

    if (!result)
      throw new Error("Failed to publish")

    return
  }

  close(reason?: string) {
    this.#aborter.abort()

    this.#closed = { reason }

    const event = new CloseEvent("close", { reason })

    this.dispatchEvent(event)

    this.socket.close()
  }

}