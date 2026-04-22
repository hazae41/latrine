import type { Uint8Array } from "@/libs/bytes/mod.ts";
import { Ciphertext, Envelope, EnvelopeTypeZero, Plaintext } from "@/libs/crypto/mod.ts";
import { SafeJson } from "@/libs/json/mod.ts";
import { SafeRpc } from "@/libs/rpc/mod.ts";
import { IrnSubscriptionPayload } from "@/mods/irn/mod.ts";
import { IrnClient } from "@/mods/mod.ts";
import { Readable, Unknown, Writable } from "@hazae41/binary";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { RpcId, RpcInvalidRequestError, RpcMessageInit, RpcRequestInit, RpcRequestPreinit, RpcResponse, RpcResponseInit } from "@hazae41/jsonrpc";
import { DataExtendableEvent, DataRespondableEvent } from "@hazae41/plume";
import { Result } from "@hazae41/result-and-option";

export interface RpcOpts {
  readonly prompt: boolean
  readonly ttl: number
  readonly tag: number
}

export const ENGINE_RPC_OPTS: Record<string, { req: RpcOpts, res: RpcOpts }> = {
  wc_sessionPropose: {
    req: {
      ttl: 5 * 60,
      prompt: true,
      tag: 1100,
    },
    res: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1101,
    },
  },
  wc_sessionSettle: {
    req: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1102,
    },
    res: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1103,
    },
  },
  wc_sessionUpdate: {
    req: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1104,
    },
    res: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1105,
    },
  },
  wc_sessionExtend: {
    req: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1106,
    },
    res: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1107,
    },
  },
  wc_sessionRequest: {
    req: {
      ttl: 5 * 60,
      prompt: true,
      tag: 1108,
    },
    res: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1109,
    },
  },
  wc_sessionEvent: {
    req: {
      ttl: 5 * 60,
      prompt: true,
      tag: 1110,
    },
    res: {
      ttl: 5 * 60,
      prompt: false,
      tag: 1111,
    },
  },
  wc_sessionDelete: {
    req: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1112,
    },
    res: {
      ttl: 24 * 60 * 60,
      prompt: false,
      tag: 1113,
    },
  },
  wc_sessionPing: {
    req: {
      ttl: 30,
      prompt: false,
      tag: 1114,
    },
    res: {
      ttl: 30,
      prompt: false,
      tag: 1115,
    },
  },
} as const

export interface RpcReceipt {
  readonly id: RpcId

  /**
   * Absolute ttl in milliseconds
   * = (Date.now() + (ttl * 1000))
   */
  readonly end: number
}

export interface RpcReceiptAndPromise<T> {
  readonly receipt: RpcReceipt
  readonly promise: Promise<RpcResponse<T>>
}

export interface CryptoClientEventMap {
  error: Event

  close: CloseEvent

  request: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>

  response: DataExtendableEvent<RpcResponseInit<unknown>>
}

export class CryptoChannel extends EventTarget {

  readonly #aborter = new AbortController()

  #cipher: chaCha20Poly1305.Abstract.ChaCha20Poly1305Cipher

  #acks = new Set<number>()

  #id?: string

  constructor(
    readonly client: IrnClient,
    readonly topic: string,
    readonly key: Uint8Array<ArrayBuffer, 32>,
  ) {
    super()

    const { Memory, ChaCha20Poly1305Cipher } = chaCha20Poly1305.get().getOrThrow()

    this.#cipher = ChaCha20Poly1305Cipher.importOrThrow(Memory.fromOrThrow(key))

    const { signal } = this.#aborter

    client.addEventListener("close", this.#onClientClose.bind(this), { signal })
    client.addEventListener("error", this.#onClientError.bind(this), { signal })

    client.addEventListener("request", this.#onClientRequest.bind(this), { signal })
  }

  [Symbol.dispose]() {
    this.close()
  }

  addEventListener<K extends keyof CryptoClientEventMap>(type: K, listener: (e: CryptoClientEventMap[K]) => void, options?: AddEventListenerOptions): void

  addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void

  addEventListener(type: string, callback: (e: Event) => void, options?: AddEventListenerOptions): void {
    super.addEventListener(type, callback, options)
  }

  get closed() {
    return this.#aborter.signal
  }

  #onClientClose(event: CloseEvent) {
    const { reason } = event

    this.#aborter.abort()

    const subevent = new CloseEvent("close", { reason })

    this.dispatchEvent(subevent)
  }

  #onClientError() {
    this.#aborter.abort()

    const subevent = new Event("error")

    this.dispatchEvent(subevent)
  }

  #onClientRequest(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data

    if (request.method === "irn_subscription")
      return this.#onIrnSubscription(event)

    return
  }

  #onIrnSubscription(event: DataRespondableEvent<RpcRequestPreinit<unknown>, unknown>) {
    const request = event.data as RpcRequestPreinit<IrnSubscriptionPayload>

    if (request.params.data.topic !== this.topic)
      return

    this.#onIrnMessage(request.params.data.message).catch(console.error)

    event.stopImmediatePropagation()
    event.respondWith(true)
  }

  async #onIrnMessage(message: string) {
    const written = Uint8Array.fromBase64(message)
    const wrapper = Readable.readFromBytesOrThrow(Envelope, written)

    const encrypted = wrapper.fragment.readIntoOrThrow(Ciphertext)
    const decrypted = encrypted.decryptOrThrow(this.#cipher)

    const json = new TextDecoder().decode(decrypted.fragment.bytes)
    const data = SafeJson.parse(json) as RpcMessageInit

    if ("method" in data)
      await this.#onRequest(data)
    else
      await this.#onResponse(data)

    return
  }

  async #onRequest(request: RpcRequestInit<unknown>): Promise<void> {
    if (typeof request.id !== "number")
      return
    if (this.#acks.has(request.id))
      return

    this.#acks.add(request.id)

    const result = await Result.runAndWrap(() => this.#respond(request))

    const response = RpcResponse.rewrap(request.id, result)

    const { topic } = this
    const { prompt, tag, ttl } = ENGINE_RPC_OPTS[request.method].res

    const message = this.#encryptOrThrow(response)

    const payload = { topic, message, prompt, tag, ttl }

    await this.client.publish(payload)
  }

  async #respond(request: RpcRequestInit<unknown>) {
    const event = new DataRespondableEvent("request", { data: request })

    this.dispatchEvent(event)

    await event.extension

    if (event.response != null)
      return await event.response

    throw new RpcInvalidRequestError()
  }

  async #onResponse(response: RpcResponseInit<unknown>) {
    const event = new DataExtendableEvent("response", { data: response })

    this.dispatchEvent(event)

    await event.extension
  }

  #encryptOrThrow(data: unknown): string {
    const json = SafeJson.stringify(data)

    const nonce = crypto.getRandomValues(new Uint8Array(12))

    const decrypted = new Plaintext(new Unknown(new TextEncoder().encode(json)))
    const encrypted = decrypted.encryptOrThrow(this.#cipher, nonce)

    const wrapper = new EnvelopeTypeZero(encrypted)
    const written = Writable.writeToBytesOrThrow(wrapper)

    const message = written.toBase64({ alphabet: "base64", omitPadding: false })

    return message
  }

  async subscribe() {
    if (this.closed.aborted)
      return
    if (this.#id != null)
      return
    this.#id = await this.client.subscribe(this.topic)
  }

  async unsubscribe() {
    if (this.closed.aborted)
      return
    if (this.#id == null)
      return
    await this.client.unsubscribe(this.#id, this.topic)
  }

  async fetch() {
    for await (const data of this.client.fetch(this.topic))
      await this.#onIrnMessage(data.message)
    return
  }

  async publish(init: RpcRequestPreinit<unknown>) {
    const request = SafeRpc.prepare(init)

    const { topic } = this
    const message = this.#encryptOrThrow(request)
    const { prompt, tag, ttl } = ENGINE_RPC_OPTS[init.method].req

    const { id } = request
    const end = Date.now() + (ttl * 1000)

    const receipt = { id, end }
    const payload = { topic, message, prompt, tag, ttl }

    await this.client.publish(payload)

    return receipt
  }

  async request<T>(init: RpcRequestPreinit<unknown>, signal = new AbortController().signal): Promise<RpcResponse<T>> {
    const request = SafeRpc.prepare(init)

    const { topic } = this
    const message = this.#encryptOrThrow(request)
    const { prompt, tag, ttl } = ENGINE_RPC_OPTS[init.method].req

    const { id } = request
    const end = Date.now() + (ttl * 1000)

    const receipt = { id, end }
    const payload = { topic, message, prompt, tag, ttl }

    const promise = this.wait<T>(receipt, signal)

    await this.client.publish(payload)

    return await promise
  }

  async wait<T>(receipt: RpcReceipt, signal = new AbortController().signal): Promise<RpcResponse<T>> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const { resolve, reject, promise } = Promise.withResolvers<RpcResponse<T>>()

    this.addEventListener("response", (event: DataExtendableEvent<RpcResponseInit<unknown>>) => {
      const init = event.data as RpcResponseInit<T>

      if (init.id !== receipt.id)
        return

      resolve(RpcResponse.from<T>(init))
    }, { signal: cleaner.signal })

    const timeout = AbortSignal.timeout(receipt.end - Date.now())

    const subsignal = AbortSignal.any([signal, timeout, this.closed])
    subsignal.addEventListener("abort", reject, { signal: cleaner.signal })

    return await promise
  }

  async close(reason?: string) {
    if (this.closed.aborted)
      return
    await this.unsubscribe()

    this.#aborter.abort()

    const subevent = new CloseEvent("close", { reason })

    this.dispatchEvent(subevent)
  }

}