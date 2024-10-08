import { Base16 } from "@hazae41/base16"
import { Base58 } from "@hazae41/base58"
import { Base64Url } from "@hazae41/base64url"
import { Bytes } from "@hazae41/bytes"
import { Ed25519 } from "@hazae41/ed25519"
import { SafeJson } from "libs/json/index.js"

export namespace Jwt {

  export async function signOrThrow(privateKey: Ed25519.SigningKey, audience: string): Promise<string> {
    const alg = "EdDSA"
    const typ = "JWT"

    const preheader = { alg, typ }

    const prefix = new Uint8Array([0xed, 0x01])

    using publicKey = privateKey.getVerifyingKeyOrThrow()
    using publicKeyMemory = await publicKey.exportOrThrow()

    const iss = `did:key:z${Base58.get().getOrThrow().encodeOrThrow(Bytes.concat([prefix, publicKeyMemory.bytes]))}`
    const sub = Base16.get().getOrThrow().encodeOrThrow(Bytes.random(32))
    const aud = audience
    const iat = Math.floor(Date.now() / 1000)
    const ttl = 24 * 60 * 60 // one day in seconds
    const exp = iat + ttl

    const prepayload = { iss, sub, aud, iat, exp }

    const header = Base64Url.get().getOrThrow().encodeUnpaddedOrThrow(Bytes.fromUtf8(SafeJson.stringify(preheader)))
    const payload = Base64Url.get().getOrThrow().encodeUnpaddedOrThrow(Bytes.fromUtf8(SafeJson.stringify(prepayload)))

    const presignature = Bytes.fromUtf8(`${header}.${payload}`)

    const signatureRef = await privateKey.signOrThrow(presignature)
    using signatureMemory = signatureRef.exportOrThrow()

    const signature = Base64Url.get().getOrThrow().encodeUnpaddedOrThrow(signatureMemory)

    return `${header}.${payload}.${signature}`
  }

}