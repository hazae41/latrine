// deno-lint-ignore-file no-namespace

import { Unknown, Writable } from "@hazae41/binary";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { Cursor } from "@hazae41/cursor";

export class Plaintext<T extends Writable> {

  constructor(
    readonly fragment: T
  ) { }

  encrypt(key: chaCha20Poly1305.Cipher, iv: Uint8Array<ArrayBuffer>): Ciphertext {
    return new Ciphertext(iv, key.encrypt(Writable.writeToBytes(this.fragment), iv))
  }

}

export class Ciphertext {

  constructor(
    readonly iv: Uint8Array<ArrayBuffer>,
    readonly inner: Uint8Array<ArrayBuffer>,
  ) { }

  decrypt(key: chaCha20Poly1305.Cipher): Plaintext<Unknown> {
    return new Plaintext(new Unknown(key.decrypt(this.inner, this.iv)))
  }

  size() {
    return this.iv.length + this.inner.length
  }

  write(cursor: Cursor) {
    cursor.write(this.iv)
    cursor.write(this.inner)
  }

  static read(cursor: Cursor) {
    const iv = new Uint8Array(cursor.read(12))
    const inner = new Uint8Array(cursor.read(cursor.remaining))

    return new Ciphertext(iv, inner)
  }

}

export type Envelope<T extends Writable> =
  | EnvelopeTypeZero<T>
  | EnvelopeTypeOne<T>

export namespace Envelope {

  export class UnknownTypeError extends Error {
    readonly #class = UnknownTypeError
    readonly name = this.#class.name

    constructor(
      readonly type: number
    ) {
      super(`Unknown type ${type}`)
    }

  }

  export function read(cursor: Cursor): Envelope<Unknown> {
    const type = cursor.getUint8()

    if (type === 0)
      return EnvelopeTypeZero.read(cursor)
    if (type === 1)
      return EnvelopeTypeOne.read(cursor)

    throw new UnknownTypeError(type)
  }

}

export class EnvelopeTypeZero<T extends Writable> {
  readonly #class = EnvelopeTypeZero

  static readonly type = 0 as const
  readonly type = this.#class.type

  constructor(
    readonly fragment: T
  ) { }

  size() {
    return 1 + this.fragment.size()
  }

  write(cursor: Cursor) {
    cursor.writeUint8(this.type)
    this.fragment.write(cursor)
  }

  static read(cursor: Cursor): EnvelopeTypeZero<Unknown> {
    const type = cursor.readUint8()

    if (type !== EnvelopeTypeZero.type)
      throw new Error(`Invalid type-0 type ${type}`)

    const bytes = new Uint8Array(cursor.read(cursor.remaining))

    const fragment = new Unknown(bytes)

    return new EnvelopeTypeZero(fragment)
  }

}

export class EnvelopeTypeOne<T extends Writable> {
  readonly #class = EnvelopeTypeOne

  static readonly type = 1 as const
  readonly type = this.#class.type

  constructor(
    readonly sender: Uint8Array<ArrayBuffer>,
    readonly fragment: T
  ) { }

  size() {
    return 1 + this.sender.length + this.fragment.size()
  }

  write(cursor: Cursor) {
    cursor.writeUint8(this.type)
    cursor.write(this.sender)
    this.fragment.write(cursor)
  }

  static read(cursor: Cursor): EnvelopeTypeOne<Unknown> {
    const type = cursor.readUint8()

    if (type !== EnvelopeTypeOne.type)
      throw new Error(`Invalid type ${type}`)

    const sender = new Uint8Array(cursor.read(32))
    const bytes = new Uint8Array(cursor.read(cursor.remaining))

    const fragment = new Unknown(bytes)

    return new EnvelopeTypeOne(sender, fragment)
  }

}