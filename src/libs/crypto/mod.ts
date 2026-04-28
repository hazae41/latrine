import { Unknown, Writable } from "@hazae41/binary";
import { chaCha20Poly1305 } from "@hazae41/chacha20poly1305";
import { Cursor } from "@hazae41/cursor";

export class Plaintext<T extends Writable> {

  constructor(
    readonly fragment: T
  ) { }

  encryptOrThrow(key: chaCha20Poly1305.Abstract.ChaCha20Poly1305Cipher, iv: Uint8Array<ArrayBuffer>): Ciphertext {
    const { Memory } = chaCha20Poly1305.get().getOrThrow()

    using plain = Memory.fromOrThrow(Writable.writeToBytesOrThrow(this.fragment))

    using nonce = Memory.fromOrThrow(iv)

    using cipher = key.encryptOrThrow(plain, nonce)

    return new Ciphertext(iv, cipher.bytes.slice())
  }

}

export class Ciphertext {

  constructor(
    readonly iv: Uint8Array<ArrayBuffer>,
    readonly inner: Uint8Array<ArrayBuffer>,
  ) { }

  decryptOrThrow(key: chaCha20Poly1305.Abstract.ChaCha20Poly1305Cipher): Plaintext<Unknown> {
    const { Memory } = chaCha20Poly1305.get().getOrThrow()

    using inner = Memory.fromOrThrow(this.inner)

    using iv = Memory.fromOrThrow(this.iv)

    using plain = key.decryptOrThrow(inner, iv)

    return new Plaintext(new Unknown(plain.bytes.slice()))
  }

  sizeOrThrow() {
    return this.iv.length + this.inner.length
  }

  writeOrThrow(cursor: Cursor) {
    cursor.writeOrThrow(this.iv)
    cursor.writeOrThrow(this.inner)
  }

  static readOrThrow(cursor: Cursor) {
    const iv = new Uint8Array(cursor.readOrThrow(12))
    const inner = new Uint8Array(cursor.readOrThrow(cursor.remaining))

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

  export function readOrThrow(cursor: Cursor): Envelope<Unknown> {
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

  static readOrThrow(cursor: Cursor): EnvelopeTypeZero<Unknown> {
    const type = cursor.readUint8OrThrow()

    if (type !== EnvelopeTypeZero.type)
      throw new Error(`Invalid type-0 type ${type}`)

    const bytes = new Uint8Array(cursor.readOrThrow(cursor.remaining))

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

  sizeOrThrow() {
    return 1 + this.sender.length + this.fragment.sizeOrThrow()
  }

  writeOrThrow(cursor: Cursor) {
    cursor.writeUint8OrThrow(this.type)
    cursor.writeOrThrow(this.sender)
    this.fragment.writeOrThrow(cursor)
  }

  static readOrThrow(cursor: Cursor): EnvelopeTypeOne<Unknown> {
    const type = cursor.readUint8OrThrow()

    if (type !== EnvelopeTypeOne.type)
      throw new Error(`Invalid type ${type}`)

    const sender = new Uint8Array(cursor.readOrThrow(32))
    const bytes = new Uint8Array(cursor.readOrThrow(cursor.remaining))

    const fragment = new Unknown(bytes)

    return new EnvelopeTypeOne(sender, fragment)
  }

}