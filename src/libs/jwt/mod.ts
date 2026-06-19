// deno-lint-ignore-file no-namespace

import { ed25519 } from "@/libs/ed25519/mod.ts";
import { SafeJSON } from "@/libs/json/mod.ts";
import { base58 } from "@hazae41/base58";
import { Cursor } from "@hazae41/cursor";

export namespace Jwt {

  export async function sign(jwk: Uint8Array<ArrayBuffer>, aud: string): Promise<string> {
    const alg = "EdDSA"
    const typ = "JWT"

    const header = { alg, typ }

    const prefix = new Uint8Array([0xed, 0x01])

    const keyref = await ed25519.importKey(jwk)
    const pubref = await ed25519.publishKey(keyref)
    const pubraw = new Uint8Array(await crypto.subtle.exportKey("raw", pubref))

    const $did = new Cursor(new Uint8Array(prefix.length + pubraw.length))
    $did.write(prefix)
    $did.write(pubraw)

    const iss = `did:key:z${base58.encode($did.bytes)}`
    const sub = crypto.getRandomValues(new Uint8Array(32)).toHex()
    const iat = Math.floor(Date.now() / 1000)
    const ttl = 24 * 60 * 60 // one day in seconds
    const exp = iat + ttl

    const payload = { iss, sub, aud, iat, exp }

    const header64 = new TextEncoder().encode(SafeJSON.stringify(header)).toBase64({ alphabet: "base64url", omitPadding: true })
    const payload64 = new TextEncoder().encode(SafeJSON.stringify(payload)).toBase64({ alphabet: "base64url", omitPadding: true })

    const presigned = new TextEncoder().encode(`${header64}.${payload64}`)
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", keyref, presigned))

    const signature64 = signature.toBase64({ alphabet: "base64url", omitPadding: true })

    return `${header64}.${payload64}.${signature64}`
  }

}