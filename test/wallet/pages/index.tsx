import "@hazae41/symbol-dispose-polyfill"

import "@hazae41/disposable-stack-polyfill"

import { Base16 } from "@hazae41/base16"
import { Base58 } from "@hazae41/base58"
import { Base64 } from "@hazae41/base64"
import { Base64Url } from "@hazae41/base64url"
import { Bytes } from "@hazae41/bytes"
import { ChaCha20Poly1305 } from "@hazae41/chacha20poly1305"
import { Ed25519 } from "@hazae41/ed25519"
import { Future } from "@hazae41/future"
import { RpcRequestPreinit } from "@hazae41/jsonrpc"
import { CryptoClient, IrnClient, Jwt, RpcReceipt, Wc, WcMetadata, WcSession, WcSessionRequestParams } from "@hazae41/latrine"
import { None, Nullable, Some } from "@hazae41/option"
import { X25519 } from "@hazae41/x25519"
import { chacha20poly1305 } from "@noble/ciphers/chacha"
import { ed25519, x25519 } from "@noble/curves/ed25519"
import { base16, base58, base64, base64nopad, base64url, base64urlnopad } from "@scure/base"
import { ChangeEvent, useCallback, useEffect, useState } from "react"

export namespace Errors {

  export function toJSON(error: unknown): unknown {
    if (Array.isArray(error))
      return error.map(toJSON)
    if (error instanceof Error)
      return { name: error.name, message: error.message, cause: toJSON(error.cause) }
    return error
  }

  export function toString(error: unknown) {
    return JSON.stringify(toJSON(error))
  }

  export function alert(error: unknown) {
    globalThis.alert(toString(error))
  }

}

export namespace WebSockets {

  export async function openOrThrow(socket: WebSocket, signal = new AbortController().signal) {
    using stack = new DisposableStack()

    const future = new Future<void>()

    const onOpen = () => future.resolve()
    const onError = () => future.reject(new Error("Errored"))
    const onAbort = () => future.reject(new Error("Aborted"))

    socket.addEventListener("open", onOpen, { passive: true })
    stack.defer(() => socket.removeEventListener("open", onOpen))

    socket.addEventListener("error", onError, { passive: true })
    stack.defer(() => socket.removeEventListener("error", onError))

    signal.addEventListener("abort", onAbort, { passive: true })
    stack.defer(() => signal.removeEventListener("abort", onAbort))

    return await future.promise
  }

}

export namespace JsonLocalStorage {

  export function set<T>(key: string, value: Nullable<T>) {
    if (value != null)
      localStorage.setItem(key, JSON.stringify(value))
    else
      localStorage.removeItem(key)
  }

  export function get<T>(key: string): Nullable<T> {
    const value = localStorage.getItem(key)

    if (value == null)
      return value

    return JSON.parse(value) as T
  }

}

export namespace Blobs {

  export async function readAsDataUrlOrThrow(blob: Blob) {
    using stack = new DisposableStack()

    const future = new Future<string>()
    const reader = new FileReader()

    const onLoad = () => future.resolve(reader.result as string)

    reader.addEventListener("load", onLoad, { passive: true })
    stack.defer(() => reader.removeEventListener("load", onLoad))

    const onError = () => future.reject(reader.error)

    reader.addEventListener("error", onError, { passive: true })
    stack.defer(() => reader.removeEventListener("error", onError))

    reader.readAsDataURL(blob)

    return await future.promise
  }

}

export interface IrnClientAndAuthKey {
  readonly irn: IrnClient,
  readonly authKey: Ed25519.SigningKey
}

export default function Home() {
  const [rawWcUrl = "", setRawWcUrl] = useState<string>()

  const [icon, setIcon] = useState<Nullable<string>>()
  const [session, setSession] = useState<Nullable<WcSession>>()

  const onInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setRawWcUrl(e.currentTarget.value)
  }, [])

  const initOrThrow = useCallback(async () => {
    Base16.set(Base16.fromScure({ base16 }))
    Base64.set(Base64.fromScure({ base64, base64nopad }))
    Base64Url.set(Base64Url.fromScure({ base64url, base64urlnopad }))
    Base58.set(Base58.fromScure({ base58 }))

    Ed25519.set(await Ed25519.fromNativeOrNoble({ ed25519 }))
    X25519.set(await X25519.fromNativeOrNoble({ x25519 }))

    ChaCha20Poly1305.set(ChaCha20Poly1305.fromNoble({ chacha20poly1305 }))
  }, [])

  const [irnAndAuth, setIrnAndAuth] = useState<IrnClientAndAuthKey>()

  const openOrThrow = useCallback(async () => {
    const authJwk = JsonLocalStorage.get<Ed25519.SigningKeyJwk>("wc.jwk")

    if (authJwk != null) {
      const authKey = await Ed25519.get().getOrThrow().SigningKey.importJwkOrThrow(authJwk, true)
      const authJwt = await Jwt.signOrThrow(authKey, Wc.RELAY)

      const socket = new WebSocket(`${Wc.RELAY}/?auth=${authJwt}&projectId=b580c84c2c57b6e4f78ab117951de721`)
      await WebSockets.openOrThrow(socket)

      const irn = new IrnClient(socket)

      const pairTopic = JsonLocalStorage.get<string>("wc.tpc")!
      const pairKeyBase64 = JsonLocalStorage.get<string>("wc.key")!

      using pairKeyMem = Base64.get().getOrThrow().decodePaddedOrThrow(pairKeyBase64)
      const pairKey = Bytes.castOrThrow(pairKeyMem.bytes.slice(), 32)

      const client = CryptoClient.createOrThrow(irn, pairTopic, pairKey, 5000)
      const metadata = JsonLocalStorage.get<WcMetadata>("wc.mtd")!

      const session = new WcSession(client, metadata)

      await irn.subscribeOrThrow(pairTopic, AbortSignal.timeout(5000))

      setIcon(JsonLocalStorage.get<string>("wc.icn"))

      const settlement = JsonLocalStorage.get<RpcReceipt>("wc.stl")

      if (settlement != null) {
        const settled = await session.client.waitOrThrow<boolean>(settlement).then(r => r.getOrThrow())

        if (!settled) {
          JsonLocalStorage.set("wc.jwk", undefined)
          JsonLocalStorage.set("wc.tpc", undefined)
          JsonLocalStorage.set("wc.key", undefined)
          JsonLocalStorage.set("wc.mtd", undefined)
          JsonLocalStorage.set("wc.stl", undefined)
          JsonLocalStorage.set("wc.icn", undefined)

          throw new Error(`Could not connect to ${session.metadata.name}`)
        }

        JsonLocalStorage.set("wc.stl", undefined)
      }

      const eth_sendTransaction = async (chainId: number, request: RpcRequestPreinit<unknown>) => {
        const [{ from, to, gas, value, nonce, data, gasPrice, maxFeePerGas, maxPriorityFeePerGas }] = (request as RpcRequestPreinit<[{
          from: string,
          to: Nullable<string>,
          gas: Nullable<string>,
          value: Nullable<string>,
          nonce: Nullable<string>,
          data: Nullable<string>,
          gasPrice: Nullable<string>,
          maxFeePerGas: Nullable<string>,
          maxPriorityFeePerGas: Nullable<string>,
        }]>).params

        alert(JSON.stringify({ from, to, gas, value, nonce, data, gasPrice, maxFeePerGas, maxPriorityFeePerGas }))

        throw new Error(`Unimplemented`)
      }

      const personal_sign = async (chainId: number, request: RpcRequestPreinit<unknown>) => {
        const [message, address] = (request as RpcRequestPreinit<[string, string]>).params

        alert(JSON.stringify({ message, address }))

        throw new Error(`Unimplemented`)
      }

      const eth_signTypedData_v4 = async (chainId: number, request: RpcRequestPreinit<unknown>) => {
        const [address, data] = (request as RpcRequestPreinit<[string, string]>).params

        alert(JSON.stringify({ address, data }))

        throw new Error(`Unimplemented`)
      }

      const onRequest = async (suprequest: RpcRequestPreinit<unknown>) => {
        if (suprequest.method !== "wc_sessionRequest")
          return new None()

        const { chainId, request } = (suprequest as RpcRequestPreinit<WcSessionRequestParams>).params

        const eip155ChainId = Number(chainId.split(":")[1])

        if (request.method === "eth_sendTransaction")
          return new Some(await eth_sendTransaction(eip155ChainId, request))
        if (request.method === "personal_sign")
          return new Some(await personal_sign(eip155ChainId, request))
        if (request.method === "eth_signTypedData_v4")
          return new Some(await eth_signTypedData_v4(eip155ChainId, request))
        return new None()
      }

      const stack = new DisposableStack()

      const onCloseOrError = (reason?: unknown) => {
        stack.dispose()
        return new None()
      }

      stack.defer(session.client.events.on("request", onRequest, { passive: true }))
      stack.defer(session.client.events.on("close", onCloseOrError, { passive: true }))
      stack.defer(session.client.events.on("error", onCloseOrError, { passive: true }))

      console.log(`Connected to ${session.metadata.name}`)

      setSession(session)
      return
    }

    const authKey = await Ed25519.get().getOrThrow().SigningKey.randomOrThrow()
    const authJwt = await Jwt.signOrThrow(authKey, Wc.RELAY)

    const socket = new WebSocket(`${Wc.RELAY}/?auth=${authJwt}&projectId=b580c84c2c57b6e4f78ab117951de721`)
    await WebSockets.openOrThrow(socket)

    const irn = new IrnClient(socket)

    setIrnAndAuth({ irn, authKey })
  }, [])

  useEffect(() => {
    initOrThrow().then(openOrThrow).catch(Errors.alert)
  }, [])

  const connectOrThrow = useCallback(async () => {
    if (irnAndAuth == null)
      throw new Error(`Could not connect to relay`)
    if (!rawWcUrl)
      throw new Error(`Paste WalletConnect link`)

    const { irn, authKey } = irnAndAuth

    const params = Wc.parseOrThrow(rawWcUrl)

    const metadata = { name: "MyWallet", description: "My wallet", url: location.origin, icons: [] }
    const address = "0x26FFb21843A74a37659b7b5dC3E9cE4DA67e6eED"
    const chains = [1, 100, 137]

    const [session, settlement] = await Wc.pairOrThrow(irn, params, metadata, address, chains, 5000)

    const authJwk = await authKey.exportJwkOrThrow()

    const pairTopic = session.client.topic

    const pairKey = session.client.key
    const pairKeyBase64 = Base64.get().getOrThrow().encodePaddedOrThrow(pairKey)

    JsonLocalStorage.set("wc.jwk", authJwk)
    JsonLocalStorage.set("wc.tpc", pairTopic)
    JsonLocalStorage.set("wc.key", pairKeyBase64)
    JsonLocalStorage.set("wc.mtd", session.metadata)
    JsonLocalStorage.set("wc.stl", settlement.receipt)

    for (const iconUrl of session.metadata.icons) {
      try {
        const iconRes = await fetch(iconUrl)
        const iconBlob = await iconRes.blob()
        const iconData = await Blobs.readAsDataUrlOrThrow(iconBlob)

        JsonLocalStorage.set("wc.icn", iconData)

        setIcon(iconData)

        break
      } catch (e: unknown) {
        continue
      }
    }

    const settled = await settlement.promise.then(r => r.getOrThrow())

    if (!settled) {
      JsonLocalStorage.set("wc.jwk", undefined)
      JsonLocalStorage.set("wc.tpc", undefined)
      JsonLocalStorage.set("wc.key", undefined)
      JsonLocalStorage.set("wc.mtd", undefined)
      JsonLocalStorage.set("wc.stl", undefined)
      JsonLocalStorage.set("wc.icn", undefined)

      throw new Error(`Could not connect to ${session.metadata.name}`)
    }

    JsonLocalStorage.set("wc.stl", undefined)

    const eth_sendTransaction = async (chainId: number, request: RpcRequestPreinit<unknown>) => {
      const [{ from, to, gas, value, nonce, data, gasPrice, maxFeePerGas, maxPriorityFeePerGas }] = (request as RpcRequestPreinit<[{
        from: string,
        to: Nullable<string>,
        gas: Nullable<string>,
        value: Nullable<string>,
        nonce: Nullable<string>,
        data: Nullable<string>,
        gasPrice: Nullable<string>,
        maxFeePerGas: Nullable<string>,
        maxPriorityFeePerGas: Nullable<string>,
      }]>).params

      alert(JSON.stringify({ from, to, gas, value, nonce, data, gasPrice, maxFeePerGas, maxPriorityFeePerGas }))

      throw new Error(`Unimplemented`)
    }

    const personal_sign = async (chainId: number, request: RpcRequestPreinit<unknown>) => {
      const [message, address] = (request as RpcRequestPreinit<[string, string]>).params

      alert(JSON.stringify({ message, address }))

      throw new Error(`Unimplemented`)
    }

    const eth_signTypedData_v4 = async (chainId: number, request: RpcRequestPreinit<unknown>) => {
      const [address, data] = (request as RpcRequestPreinit<[string, string]>).params

      alert(JSON.stringify({ address, data }))

      throw new Error(`Unimplemented`)
    }

    const onRequest = async (suprequest: RpcRequestPreinit<unknown>) => {
      if (suprequest.method !== "wc_sessionRequest")
        return new None()

      const { chainId, request } = (suprequest as RpcRequestPreinit<WcSessionRequestParams>).params

      const eip155ChainId = Number(chainId.split(":")[1])

      if (request.method === "eth_sendTransaction")
        return new Some(await eth_sendTransaction(eip155ChainId, request))
      if (request.method === "personal_sign")
        return new Some(await personal_sign(eip155ChainId, request))
      if (request.method === "eth_signTypedData_v4")
        return new Some(await eth_signTypedData_v4(eip155ChainId, request))
      return new None()
    }

    const stack = new DisposableStack()

    const onCloseOrError = (reason?: unknown) => {
      stack.dispose()
      return new None()
    }

    stack.defer(session.client.events.on("request", onRequest, { passive: true }))
    stack.defer(session.client.events.on("close", onCloseOrError, { passive: true }))
    stack.defer(session.client.events.on("error", onCloseOrError, { passive: true }))

    console.log(`Connected to ${session.metadata.name}`)

    setSession(session)
  }, [irnAndAuth, rawWcUrl])

  const onConnectClick = useCallback(() => {
    connectOrThrow().catch(Errors.alert)
  }, [connectOrThrow])

  const disconnectOrThrow = useCallback(async () => {
    if (session == null)
      throw new Error(`Not connected`)

    await session.closeOrThrow("User disconnected.")

    JsonLocalStorage.set("wc.jwk", undefined)
    JsonLocalStorage.set("wc.tpc", undefined)
    JsonLocalStorage.set("wc.key", undefined)
    JsonLocalStorage.set("wc.mtd", undefined)
    JsonLocalStorage.set("wc.stl", undefined)
    JsonLocalStorage.set("wc.icn", undefined)

    location.reload()
  }, [session])

  const onDisconnectClick = useCallback(() => {
    disconnectOrThrow().catch(Errors.alert)
  }, [disconnectOrThrow])

  return <>
    {session == null && irnAndAuth == null && <>
      <div>Loading...</div>
    </>}
    {session == null && irnAndAuth != null && <>
      <input className=""
        placeholder="Paste WalletConnect link"
        onChange={onInputChange}
        value={rawWcUrl} />
      <button onClick={onConnectClick}>
        Connect
      </button>
    </>}
    {session != null && <>
      {icon != null &&
        <img className="size-12" src={icon} />}
      <div>
        {session.metadata.name}
      </div>
      <div>
        {session.metadata.description}
      </div>
      <div>
        {session.metadata.url}
      </div>
      <button onClick={onDisconnectClick}>
        Disconnect
      </button>
    </>}
  </>
}
