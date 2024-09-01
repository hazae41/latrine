import { Opaque, Writable } from "@hazae41/binary";
import { Uint8Array } from "@hazae41/bytes";
import { ChaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { Cursor } from "@hazae41/cursor";

export class Plaintext<T extends Writable> {

  constructor(
    readonly fragment: T
  ) { }

  encryptOrThrow(key: ChaCha20Poly1305.Cipher, iv: Uint8Array<12>): Ciphertext {
    const plain = Writable.writeToBytesOrThrow(this.fragment)
    using cipher = key.encryptOrThrow(plain, iv)

    return new Ciphertext(iv, cipher.bytes.slice())
  }

}

export class Ciphertext {

  constructor(
    readonly iv: Uint8Array<12>,
    readonly inner: Uint8Array,
  ) { }

  decryptOrThrow(key: ChaCha20Poly1305.Cipher): Plaintext<Opaque> {
    using plain = key.decryptOrThrow(this.inner, this.iv)

    return new Plaintext(new Opaque(plain.bytes.slice()))
  }

  sizeOrThrow() {
    return this.iv.length + this.inner.length
  }

  writeOrThrow(cursor: Cursor) {
    cursor.writeOrThrow(this.iv)
    cursor.writeOrThrow(this.inner)
  }

  static readOrThrow(cursor: Cursor) {
    const iv = cursor.readAndCopyOrThrow(12)
    const inner = cursor.readAndCopyOrThrow(cursor.remaining)

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

  export function readOrThrow(cursor: Cursor): Envelope<Opaque> {
    const type = cursor.getUint8OrThrow()

    if (type === 0)
      return EnvelopeTypeZero.readOrThrow(cursor)
    if (type === 1)
      return EnvelopeTypeOne.readOrThrow(cursor)

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

  sizeOrThrow() {
    return 1 + this.fragment.sizeOrThrow()
  }

  writeOrThrow(cursor: Cursor) {
    cursor.writeUint8OrThrow(this.type)
    this.fragment.writeOrThrow(cursor)
  }

  static readOrThrow(cursor: Cursor): EnvelopeTypeZero<Opaque> {
    const type = cursor.readUint8OrThrow()

    if (type !== EnvelopeTypeZero.type)
      throw new Error(`Invalid type-0 type ${type}`)

    const bytes = cursor.readAndCopyOrThrow(cursor.remaining)
    const fragment = new Opaque(bytes)

    return new EnvelopeTypeZero(fragment)
  }

}

export class EnvelopeTypeOne<T extends Writable> {
  readonly #class = EnvelopeTypeOne

  static readonly type = 1 as const
  readonly type = this.#class.type

  constructor(
    readonly sender: Uint8Array<32>,
    readonly fragment: T
  ) { }

  sizeOrThrow() {
    return 1 + this.sender.length + this.fragment.sizeOrThrow()
  }

  writeOrThrow(cursor: Cursor) {
    cursor.writeUint8OrThrow(this.type)
    cursor.writeOrThrow(this.sender)
    this.fragment.writeOrThrow(cursor)
  }

  static readOrThrow(cursor: Cursor): EnvelopeTypeOne<Opaque> {
    const type = cursor.readUint8OrThrow()

    if (type !== EnvelopeTypeOne.type)
      throw new Error(`Invalid type ${type}`)

    const sender = cursor.readAndCopyOrThrow(32)
    const bytes = cursor.readAndCopyOrThrow(cursor.remaining)
    const fragment = new Opaque(bytes)

    return new EnvelopeTypeOne(sender, fragment)
  }

}