import { base58 } from "@/libs/base58/mod.ts";
import { Bytes } from "@/libs/bytes/mod.ts";
import { Ed25519 } from "@/libs/ed25519/mod.ts";
import { SafeJson } from "@/libs/json/mod.ts";

export namespace Jwt {

  export async function signOrThrow(jwk: Uint8Array<ArrayBuffer>, aud: string): Promise<string> {
    const alg = "EdDSA"
    const typ = "JWT"

    const header = { alg, typ }

    const prefix = new Uint8Array([0xed, 0x01])

    const sigref = await Ed25519.importKey(jwk)
    const pubref = await Ed25519.publishKey(sigref)

    const pubraw = new Uint8Array(await crypto.subtle.exportKey("raw", pubref))

    const iss = `did:key:z${base58.encode(Bytes.concat(prefix, pubraw))}`
    const sub = crypto.getRandomValues(new Uint8Array(32)).toHex()
    const iat = Math.floor(Date.now() / 1000)
    const ttl = 24 * 60 * 60 // one day in seconds
    const exp = iat + ttl

    const payload = { iss, sub, aud, iat, exp }

    const header64 = new TextEncoder().encode(SafeJson.stringify(header)).toBase64({ alphabet: "base64url", omitPadding: true })
    const payload64 = new TextEncoder().encode(SafeJson.stringify(payload)).toBase64({ alphabet: "base64url", omitPadding: true })

    const presigned = new TextEncoder().encode(`${header64}.${payload64}`)
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", sigref, presigned))

    const signature64 = signature.toBase64({ alphabet: "base64url", omitPadding: true })

    return `${header64}.${payload64}.${signature64}`
  }

}