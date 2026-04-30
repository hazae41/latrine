export * from "./channel/mod.ts";
export * from "./errors/mod.ts";
export * from "./pairing/mod.ts";
export * from "./session/mod.ts";

import { Jwt } from "@/libs/jwt/mod.ts";
import { IrnClient } from "@/mods/irn/mod.ts";

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

  export async function open(relay: string, jwk: Uint8Array<ArrayBuffer>, projectId: string, signal = new AbortController().signal): Promise<IrnClient> {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const jwt = await Jwt.signOrThrow(jwk, relay)

    const socket = new WebSocket(`${relay}/?auth=${jwt}&projectId=${projectId}`)

    const { resolve, reject, promise } = Promise.withResolvers()
    stack.defer(() => reject())

    socket.addEventListener("open", resolve, { signal: cleaner.signal })
    socket.addEventListener("error", reject, { signal: cleaner.signal })
    signal.addEventListener("abort", reject, { signal: cleaner.signal })

    await promise

    return new IrnClient(socket)
  }

}