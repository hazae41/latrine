// deno-lint-ignore-file no-namespace

export namespace Bytes {

  export function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
    const result = new Uint8Array(a.length + b.length)

    result.set(a, 0);
    result.set(b, a.length)

    return result
  }

}