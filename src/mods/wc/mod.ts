export * from "./channel/mod.ts";
export * from "./errors/mod.ts";
export * from "./pairing/mod.ts";
export * from "./session/mod.ts";

import { Jwt } from "@/libs/jwt/mod.ts";
import { Awaitable } from "@/libs/promises/mod.ts";
import { IrnClient } from "@/mods/irn/mod.ts";
import { WcPairing, WcProposeParams, WcRespondParams } from "@/mods/wc/pairing/mod.ts";
import { WcSession, WcSessionProposeParams } from "@/mods/wc/session/mod.ts";

export interface WcRelay {
  readonly protocol: string
  readonly data?: string
}

export interface WcMetadata {
  readonly name: string
  readonly description: string
  readonly url: string
  readonly icons: string[]
}

export interface WcIdentity {
  readonly publicKey: string
  readonly metadata: WcMetadata
}

export namespace WalletConnect {

  export const RELAY = "wss://relay.walletconnect.org"

  export async function open(jwk: Uint8Array<ArrayBuffer>, projectId: string, signal = new AbortController().signal): Promise<IrnClient> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const jwt = await Jwt.signOrThrow(jwk, RELAY)

    const socket = new WebSocket(`${RELAY}/?auth=${jwt}&projectId=${projectId}`)

    const { resolve, reject, promise } = Promise.withResolvers()

    socket.addEventListener("open", resolve, { signal: cleaner.signal })
    socket.addEventListener("error", reject, { signal: cleaner.signal })
    signal.addEventListener("abort", reject, { signal: cleaner.signal })

    await promise

    return new IrnClient(socket)
  }

  export async function propose(pairing: WcPairing, callback: (url: string) => Awaitable<void>, params: WcProposeParams, signal = new AbortController().signal): Promise<WcSession> {
    await using stack = new AsyncDisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    await callback(pairing.url)

    const upgraded = Promise.withResolvers<WcSession>()

    pairing.addEventListener("upgraded", event => upgraded.resolve(event.data), { signal: cleaner.signal })

    pairing.addEventListener("close", upgraded.reject, { signal: cleaner.signal })

    signal.addEventListener("abort", upgraded.reject, { signal: cleaner.signal })

    await pairing.subscribe()

    await pairing.fetch()

    await pairing.propose(params)

    return await upgraded.promise
  }

  export async function respond(pairing: WcPairing, callback: (proposal: WcSessionProposeParams) => Awaitable<boolean>, params: WcRespondParams, signal = new AbortController().signal): Promise<WcSession> {
    await using stack = new AsyncDisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const upgraded = Promise.withResolvers<WcSession>()

    pairing.addEventListener("proposal", (event) => event.respondWith(callback(event.data)), { signal: cleaner.signal })

    pairing.addEventListener("upgraded", event => upgraded.resolve(event.data), { signal: cleaner.signal })

    pairing.addEventListener("close", upgraded.reject, { signal: cleaner.signal })

    signal.addEventListener("abort", upgraded.reject, { signal: cleaner.signal })

    await pairing.subscribe()

    await pairing.fetch()

    pairing.respond(params)

    return await upgraded.promise
  }

}