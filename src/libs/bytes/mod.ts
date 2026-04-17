import { ByteLengthed, Lengthed } from "@/libs/lengthed/mod.ts";

export type Uint8Array<T extends ArrayBufferLike = ArrayBufferLike, N extends number = number> =
  & globalThis.Uint8Array<T>
  & Lengthed<N>
  & ByteLengthed<N>

declare global {

  export interface Uint8ArrayConstructor {

    new <N extends number = number>(
      length: N,
    ): Uint8Array<ArrayBuffer, N>

    new <N extends number = number>(
      bytes: Uint8Array<ArrayBufferLike, N>,
    ): Uint8Array<ArrayBuffer, N>

  }

}

export namespace Bytes {

  export function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
    const result = new Uint8Array(a.length + b.length)

    result.set(a, 0);
    result.set(b, a.length)

    return result
  }
}