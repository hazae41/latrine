export namespace Ed25519 {

  export async function importKey(sigraw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const asn = new Uint8Array([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32])

    const sigasn = new Uint8Array(asn.length + sigraw.length)
    sigasn.set(asn, 0)
    sigasn.set(sigraw, asn.length)

    return await crypto.subtle.importKey("pkcs8", sigasn, { name: "Ed25519" }, true, ["sign"])
  }

  export async function publishKey(sigref: CryptoKey) {
    const sigjwk = await crypto.subtle.exportKey("jwk", sigref)

    delete sigjwk.d
    delete sigjwk.key_ops

    return await crypto.subtle.importKey("jwk", sigjwk, { name: "Ed25519" }, true, ["verify"])
  }

}