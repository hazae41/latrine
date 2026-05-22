import { base16 } from "@/libs/base16/mod.ts";

export namespace base58 {

  export const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

  export function encode(data: Uint8Array): string {
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

  export function decode(data: string): Uint8Array {
    let zeros = 0

    while (zeros < data.length && data[zeros] === "1")
      zeros++

    if (zeros === data.length)
      return new Uint8Array(zeros)

    let result = BigInt(0)

    for (let i = zeros; i < data.length; i++)
      result = (result * 58n) + BigInt(alphabet.indexOf(data[i]))

    return base16.decode("00".repeat(zeros) + result.toString(16))
  }

}