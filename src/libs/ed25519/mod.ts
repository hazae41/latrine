// deno-lint-ignore-file no-namespace

import { Cursor } from "@hazae41/cursor";

export namespace ed25519 {

  export async function importKey(keyraw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const asn = new Uint8Array([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32])

    const $keyasn = new Cursor(new Uint8Array(asn.length + keyraw.length))
    $keyasn.write(asn)
    $keyasn.write(keyraw)

    return await crypto.subtle.importKey("pkcs8", $keyasn.bytes, "Ed25519", true, ["sign"])
  }

  export async function publishKey(keyref: CryptoKey) {
    const keyjwk = await crypto.subtle.exportKey("jwk", keyref)

    delete keyjwk.d
    delete keyjwk.key_ops

    return await crypto.subtle.importKey("jwk", keyjwk, "Ed25519", true, ["verify"])
  }

}