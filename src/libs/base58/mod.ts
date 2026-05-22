import { base16 } from "@/libs/base16/mod.ts";

export namespace base58 {

  export const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

  export function encode(data: Uint8Array): string {
    if (data.length === 0)
      return ""

    let zeros = 0

    while (zeros < data.length && data[zeros] === 0)
      zeros++

    if (zeros === data.length)
      return "1".repeat(zeros)

    let result = ""

    for (let value = BigInt(`0x${base16.encode(data)}`); value > 0n; value = value / 58n)
      result = alphabet[Number(value % 58n)] + result

    return "1".repeat(zeros) + result
  }

  export function decode(text: string): Uint8Array {
    if (text.length === 0)
      return new Uint8Array(0)

    let zeros = 0

    while (zeros < text.length && text[zeros] === "1")
      zeros++

    if (zeros === text.length)
      return new Uint8Array(zeros)

    let value = BigInt(0)

    for (let i = zeros; i < text.length; i++)
      value = (value * 58n) + BigInt(alphabet.indexOf(text[i]))

    return base16.decode("00".repeat(zeros) + value.toString(16))
  }

}