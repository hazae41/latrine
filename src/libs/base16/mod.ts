export namespace base16 {

  export function encode(data: Uint8Array): string {
    return data.toHex()
  }

  export function decode(text: string): Uint8Array {
    return Uint8Array.fromHex(text.padStart(text.length + (text.length % 2), "0"))
  }

}