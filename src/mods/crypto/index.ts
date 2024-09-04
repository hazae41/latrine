import { Base64 } from "@hazae41/base64";
import { Opaque, Readable, Writable } from "@hazae41/binary";
import { Bytes, Uint8Array } from "@hazae41/bytes";
import { ChaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { Future } from "@hazae41/future";
import { RpcError, RpcId, RpcInvalidRequestError, RpcRequestInit, RpcRequestPreinit, RpcResponse, RpcResponseInit } from "@hazae41/jsonrpc";
import { Some } from "@hazae41/option";
import { CloseEvents, ErrorEvents, SuperEventTarget } from "@hazae41/plume";
import { Err, Ok } from "@hazae41/result";
import { Ciphertext, Envelope, EnvelopeTypeZero, Plaintext } from "libs/crypto/index.js";
import { SafeJson } from "libs/json/index.js";
import { SafeRpc } from "libs/rpc/index.js";
import { IrnClientLike, IrnSubscriptionPayload } from "mods/irn/index.js";

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

export interface CryptoClientParams {
  readonly shouldCloseOnDispose?: boolean
}

export class CryptoClient {

  readonly events = new SuperEventTarget<CloseEvents & ErrorEvents & {
    request: (request: RpcRequestPreinit<unknown>) => unknown
    response: (response: RpcResponseInit<unknown>) => void
  }>()

  #stack = new DisposableStack()
  #acks = new Set<number>()

  private constructor(
    readonly irn: IrnClientLike,
    readonly topic: string,
    readonly key: Uint8Array<32>,
    readonly cipher: ChaCha20Poly1305.Cipher,
    readonly timeout: number,
    readonly params: CryptoClientParams
  ) {
    this.#stack.defer(irn.events.on("close", this.#onIrnClose.bind(this), { passive: true }))
    this.#stack.defer(irn.events.on("error", this.#onIrnError.bind(this), { passive: true }))
    this.#stack.defer(irn.events.on("request", this.#onIrnRequest.bind(this), { passive: true }))
  }

  static createOrThrow(irn: IrnClientLike, topic: string, key: Uint8Array<32>, timeout: number, params: CryptoClientParams = {}): CryptoClient {
    const cipher = ChaCha20Poly1305.get().getOrThrow().Cipher.importOrThrow(key)
    const client = new CryptoClient(irn, topic, key, cipher, timeout, params)

    return client
  }

  [Symbol.dispose]() {
    const { shouldCloseOnDispose = true } = this.params

    if (shouldCloseOnDispose)
      return void this.closeOrThrow().catch(console.error)

    this.#stack.dispose()
  }

  async #onIrnClose(reason?: unknown) {
    this.#stack.dispose()
    this.events.emit("close", [reason]).catch(console.error)
  }

  async #onIrnError(reason?: unknown) {
    this.#stack.dispose()
    this.events.emit("error", [reason]).catch(console.error)
  }

  async #onIrnRequest(request: RpcRequestPreinit<unknown>) {
    if (request.method === "irn_subscription")
      return await this.#onIrnSubscription(request)
    return
  }

  async #onIrnSubscription(request: RpcRequestPreinit<unknown>) {
    const { data } = (request as RpcRequestPreinit<IrnSubscriptionPayload>).params

    if (data.topic !== this.topic)
      return

    return new Some(await this.#onMessage(data.message))
  }

  async #onMessage(message: string): Promise<true> {
    using slice = Base64.get().getOrThrow().decodePaddedOrThrow(message)

    const envelope = Readable.readFromBytesOrThrow(Envelope, slice.bytes)
    const cipher = envelope.fragment.readIntoOrThrow(Ciphertext)
    const plain = cipher.decryptOrThrow(this.cipher)
    const plaintext = Bytes.toUtf8(plain.fragment.bytes)

    const data = SafeJson.parse(plaintext) as RpcRequestInit<unknown> | RpcResponseInit<unknown>

    if ("method" in data)
      this.#onRequest(data).catch(console.error)
    else
      this.#onResponse(data).catch(console.error)

    return true
  }

  async #onRequest(request: RpcRequestInit<unknown>): Promise<void> {
    if (typeof request.id !== "number")
      return

    if (this.#acks.has(request.id))
      return
    this.#acks.add(request.id)

    const result = await this.#routeAndWrap(request)
    const response = RpcResponse.rewrap(request.id, result)

    const { topic } = this
    const { prompt, tag, ttl } = ENGINE_RPC_OPTS[request.method].res

    const message = this.#encryptOrThrow(response)

    const payload = { topic, message, prompt, tag, ttl }
    const signal = AbortSignal.timeout(this.timeout)

    await this.irn.publishOrThrow(payload, signal)
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

  async #onResponse(response: RpcResponseInit<unknown>) {
    const returned = await this.events.emit("response", response)

    if (returned.isSome())
      return

    console.warn(`Unhandled response`, response)
  }

  #encryptOrThrow(data: unknown): string {
    const plaintext = SafeJson.stringify(data)
    const plain = new Plaintext(new Opaque(Bytes.fromUtf8(plaintext)))
    const iv = Bytes.random(12) // TODO maybe use a counter
    const cipher = plain.encryptOrThrow(this.cipher, iv)
    const envelope = new EnvelopeTypeZero(cipher)
    const bytes = Writable.writeToBytesOrThrow(envelope)
    const message = Base64.get().getOrThrow().encodePaddedOrThrow(bytes)

    return message
  }

  async requestOrThrow<T>(init: RpcRequestPreinit<unknown>): Promise<RpcReceiptAndPromise<T>> {
    const request = SafeRpc.prepare(init)

    const { topic } = this
    const message = this.#encryptOrThrow(request)
    const { prompt, tag, ttl } = ENGINE_RPC_OPTS[init.method].req

    const { id } = request
    const end = Date.now() + (ttl * 1000)

    const receipt = { id, end }
    const promise = this.waitOrThrow<T>(receipt)

    const payload = { topic, message, prompt, tag, ttl }
    const signal = AbortSignal.timeout(this.timeout)

    await this.irn.publishOrThrow(payload, signal)

    return { receipt, promise }
  }

  async waitOrThrow<T>(receipt: RpcReceipt): Promise<RpcResponse<T>> {
    using stack = new DisposableStack()

    const future = new Future<RpcResponse<T>>()
    const signal = AbortSignal.timeout(receipt.end - Date.now())

    const onResponse = (init: RpcResponseInit<any>) => {
      if (init.id !== receipt.id)
        return

      const response = RpcResponse.from<T>(init)

      future.resolve(response)

      return new Some(undefined)
    }

    stack.defer(this.events.on("response", onResponse, { passive: true }))

    const onAbort = () => future.reject(new Error("Aborted", { cause: signal.reason }))

    signal.addEventListener("abort", onAbort, { passive: true })
    stack.defer(() => signal.removeEventListener("abort", onAbort))

    return await future.promise
  }

  async closeOrThrow(reason?: unknown) {
    await this.irn.closeOrThrow(reason)
  }

}