import { base16 } from "@/libs/base16/mod.ts";

export namespace base58 {

  export const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

  export function encode(data: Uint8Array): string {
    let result = ""

    for (let value = BigInt(`0x${base16.encode(data)}`); value > 0n; value = value / 58n)
      result = alphabet[Number(value % 58n)] + result

    return result
  }

  export function decode(data: string): Uint8Array {
    let value = BigInt(0)

    for (const char of data)
      value = (value * 58n) + BigInt(alphabet.indexOf(char))

    return base16.decode(value.toString(16))
  }

}