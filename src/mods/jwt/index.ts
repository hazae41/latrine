import { Base16 } from "@hazae41/base16"
import { Base58 } from "@hazae41/base58"
import { Base64Url } from "@hazae41/base64url"
import { Bytes } from "@hazae41/bytes"
import { Ed25519 } from "@hazae41/ed25519"
import { SafeJson } from "libs/json/index.js"

export namespace Jwt {

  export async function signOrThrow(privateKey: Ed25519.PrivateKey, audience: string): Promise<string> {
    const alg = "EdDSA"
    const typ = "JWT"

    const preheader = { alg, typ }

    const prefix = new Uint8Array([0xed, 0x01])

    const publicKey = privateKey.getPublicKeyOrThrow()
    const publicKeyBytes = await publicKey.exportOrThrow().then(r => r.copyAndDispose())

    const iss = `did:key:z${Base58.get().tryEncode(Bytes.concat([prefix, publicKeyBytes])).unwrap()}`
    const sub = Base16.get().encodeOrThrow(Bytes.random(32))
    const aud = audience
    const iat = Math.floor(Date.now() / 1000)
    const ttl = 24 * 60 * 60 // one day in seconds
    const exp = iat + ttl

    const prepayload = { iss, sub, aud, iat, exp }

    const header = Base64Url.get().encodeUnpaddedOrThrow(Bytes.fromUtf8(SafeJson.stringify(preheader)))
    const payload = Base64Url.get().encodeUnpaddedOrThrow(Bytes.fromUtf8(SafeJson.stringify(prepayload)))

    const presignature = Bytes.fromUtf8(`${header}.${payload}`)

    const signatureRef = await privateKey.signOrThrow(presignature)
    using signatureMemory = signatureRef.exportOrThrow()

    const signature = Base64Url.get().encodeUnpaddedOrThrow(signatureMemory)

    return `${header}.${payload}.${signature}`
  }

}