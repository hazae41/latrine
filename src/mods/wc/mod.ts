export * from "./channel/mod.ts";
export * from "./proposer/mod.ts";
export * from "./responder/mod.ts";
export * from "./session/mod.ts";

import { Jwt } from "@/libs/jwt/mod.ts";
import { Awaitable } from "@/libs/promises/mod.ts";
import { IrnClient } from "@/mods/irn/mod.ts";
import { WcProposer, WcProposerParams } from "@/mods/wc/proposer/mod.ts";
import { WcResponder, WcResponderParams } from "@/mods/wc/responder/mod.ts";
import { WcSession, WcSessionProposeParams } from "@/mods/wc/session/mod.ts";
import { Option } from "@hazae41/result-and-option";

export interface WcRelay {
  readonly protocol: string
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

export interface WcPairParams {
  readonly protocol: "wc:"
  readonly version: "2"
  readonly pairingTopic: string
  readonly relayProtocol: "irn"
  readonly symKey: Uint8Array<ArrayBuffer>
}

export namespace WcPairParams {

  export function stringify(params: WcPairParams): string {
    const { protocol, version, pairingTopic, relayProtocol, symKey } = params

    const url = new URL(`${protocol}${pairingTopic}@${version}`)

    url.searchParams.set("relay-protocol", relayProtocol)
    url.searchParams.set("symKey", symKey.toHex())

    return url.toString()
  }

  export function parse(rawUrl: string | URL): WcPairParams {
    const { protocol, pathname, searchParams } = new URL(rawUrl)

    if (protocol !== "wc:")
      throw new Error(`Unknown protocol`)

    const [pairingTopic, version] = pathname.split("@")

    if (version !== "2")
      throw new Error(`Unknown version`)

    const relayProtocol = Option.wrap(searchParams.get("relay-protocol")).getOrThrow()

    if (relayProtocol !== "irn")
      throw new Error(`Unknown relay protocol`)

    const symKeyHex = Option.wrap(searchParams.get("symKey")).getOrThrow()
    const symKeyRaw = Uint8Array.fromHex(symKeyHex)

    return { protocol, pairingTopic, version, relayProtocol, symKey: symKeyRaw }
  }

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

  export async function propose(client: IrnClient, callback: (url: string) => Awaitable<void>, params: WcProposerParams, signal = new AbortController().signal): Promise<WcSession> {
    await using stack = new AsyncDisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const pairing = await WcProposer.from(client, params)
    stack.defer(async () => pairing.delete())

    await callback(pairing.url)

    const upgraded = Promise.withResolvers<WcSession>()

    pairing.addEventListener("upgraded", event => upgraded.resolve(event.data), { signal: cleaner.signal })

    pairing.addEventListener("close", upgraded.reject, { signal: cleaner.signal })

    signal.addEventListener("abort", upgraded.reject, { signal: cleaner.signal })

    await pairing.subscribe()

    await pairing.fetch()

    await pairing.propose()

    return await upgraded.promise
  }

  export async function respond(client: IrnClient, callback: (proposal: WcSessionProposeParams) => Awaitable<boolean>, params: WcResponderParams, signal = new AbortController().signal): Promise<WcSession> {
    await using stack = new AsyncDisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const pairing = await WcResponder.from(client, params)
    stack.defer(async () => pairing.close())

    const upgraded = Promise.withResolvers<WcSession>()

    pairing.addEventListener("proposal", (event) => event.respondWith(callback(event.data)), { signal: cleaner.signal })

    pairing.addEventListener("upgraded", event => upgraded.resolve(event.data), { signal: cleaner.signal })

    pairing.addEventListener("close", upgraded.reject, { signal: cleaner.signal })

    signal.addEventListener("abort", upgraded.reject, { signal: cleaner.signal })

    await pairing.subscribe()

    await pairing.fetch()

    return await upgraded.promise
  }

}