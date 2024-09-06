import { Deferred, Stack } from "@hazae41/box"
import { RpcError, RpcInvalidRequestError, RpcRequestInit, RpcRequestPreinit, RpcResponse, RpcResponseInit } from "@hazae41/jsonrpc"
import { CloseEvents, ErrorEvents, SuperEventTarget } from "@hazae41/plume"
import { Err, Ok } from "@hazae41/result"
import { SafeJson } from "libs/json/index.js"
import { Awaitable } from "libs/promises/index.js"
import { SafeRpc } from "libs/rpc/index.js"

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

export type IrnEvents = CloseEvents & ErrorEvents & {
  request: (request: RpcRequestPreinit<unknown>) => unknown
}

export interface IrnClientLike {
  readonly events: SuperEventTarget<IrnEvents>

  subscribeOrThrow(topic: string, signal?: AbortSignal): Awaitable<string>

  publishOrThrow(payload: IrnPublishPayload, signal?: AbortSignal): Awaitable<void>

  closeOrThrow(reason?: unknown): Awaitable<void>
}

export interface IrnClientParams {
  readonly shouldCloseOnDispose?: boolean
}

export class IrnClient implements IrnClientLike {

  readonly events = new SuperEventTarget<CloseEvents & ErrorEvents & {
    request: (request: RpcRequestPreinit<unknown>) => unknown
  }>()

  readonly #stack = new Stack()
  readonly #topics = new Map<string, string>()

  #closed?: { reason?: unknown }

  constructor(
    readonly socket: WebSocket,
    readonly params: IrnClientParams = {}
  ) {
    const onSocketMessage = this.#onSocketMessage.bind(this)
    socket.addEventListener("message", onSocketMessage, { passive: true })
    this.#stack.push(new Deferred(() => socket.removeEventListener("message", onSocketMessage)))

    const onSocketClose = this.#onSocketClose.bind(this)
    socket.addEventListener("close", onSocketClose, { passive: true })
    this.#stack.push(new Deferred(() => socket.removeEventListener("close", onSocketClose)))

    const onSocketError = this.#onSocketError.bind(this)
    socket.addEventListener("error", onSocketError, { passive: true })
    this.#stack.push(new Deferred(() => socket.removeEventListener("error", onSocketError)))
  }

  [Symbol.dispose]() {
    using _ = this.#stack

    const { shouldCloseOnDispose = true } = this.params

    if (shouldCloseOnDispose)
      return void this.closeOrThrow()

    return
  }

  get closed() {
    return this.#closed
  }

  #onSocketClose(event: CloseEvent) {
    using _ = this.#stack

    this.#closed = { reason: event.reason }

    this.events.emit("close", [event.reason]).catch(console.error)
  }

  #onSocketError(event: Event) {
    using _ = this.#stack

    this.#closed = {}

    this.events.emit("error", [undefined]).catch(console.error)
  }

  #onSocketMessage(event: MessageEvent<unknown>) {
    if (typeof event.data !== "string")
      return
    const json = JSON.parse(event.data) as RpcRequestInit<unknown> | RpcResponseInit<unknown>

    if ("method" in json)
      this.#onRequest(json).catch(console.error)

    return
  }

  async #onRequest(request: RpcRequestInit<unknown>) {
    const result = await this.#routeAndWrap(request)
    const response = RpcResponse.rewrap(request.id, result)
    this.socket.send(SafeJson.stringify(response))
  }

  async #routeAndWrap(request: RpcRequestPreinit<unknown>) {
    try {
      const returned = await this.events.emit("request", request)

      if (returned.isSome())
        return new Ok(returned.inner)

      return new Err(new RpcInvalidRequestError())
    } catch (e: unknown) {
      return new Err(RpcError.rewrap(e))
    }
  }

  async subscribeOrThrow(topic: string, signal = new AbortController().signal): Promise<string> {
    const subscription = await SafeRpc.requestOrThrow<string>(this.socket, {
      method: "irn_subscribe",
      params: { topic }
    }, signal).then(r => r.getOrThrow())

    this.#topics.set(subscription, topic)

    return subscription
  }

  async publishOrThrow(payload: IrnPublishPayload, signal = new AbortController().signal): Promise<void> {
    const result = await SafeRpc.requestOrThrow<boolean>(this.socket, {
      method: "irn_publish",
      params: payload
    }, signal).then(r => r.getOrThrow())

    if (!result)
      throw new Error("Failed to publish")

    return
  }

  closeOrThrow(reason?: unknown) {
    using _ = this.#stack

    this.#closed = { reason }

    this.events.emit("close", [reason]).catch(console.error)

    this.socket.close()
  }

}