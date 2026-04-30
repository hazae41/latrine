export * from "./channel/mod.ts";
export * from "./errors/mod.ts";
export * from "./pairing/mod.ts";
export * from "./session/mod.ts";


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

}