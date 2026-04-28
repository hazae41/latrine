import { RpcError } from "@hazae41/jsonrpc";

export class WcUserRejectedRequestError extends RpcError {
  readonly #class = WcUserRejectedRequestError
  readonly name = this.#class.name

  constructor() {
    super(4001, "User rejected the request")
  }

}

export class WcUserRejectedError extends RpcError {
  readonly #class = WcUserRejectedError
  readonly name = this.#class.name

  constructor() {
    super(5000, "User rejected the session")
  }

}

export class WcUserRejectedChainsError extends RpcError {
  readonly #class = WcUserRejectedChainsError
  readonly name = this.#class.name

  constructor() {
    super(5001, "User rejected some chains")
  }

}

export class WcUserRejectedMethodsError extends RpcError {
  readonly #class = WcUserRejectedMethodsError
  readonly name = this.#class.name

  constructor() {
    super(5002, "User rejected some methods")
  }

}

export class WcUserRejectedEventsError extends RpcError {
  readonly #class = WcUserRejectedEventsError
  readonly name = this.#class.name

  constructor() {
    super(5003, "User rejected some events")
  }

}

export class WcUnsupportedChainsError extends RpcError {
  readonly #class = WcUnsupportedChainsError
  readonly name = this.#class.name

  constructor() {
    super(5100, "Unsupported chains")
  }

}

export class WcUnsupportedMethodsError extends RpcError {
  readonly #class = WcUnsupportedMethodsError
  readonly name = this.#class.name

  constructor() {
    super(5101, "Unsupported methods")
  }

}

export class WcUnsupportedEventsError extends RpcError {
  readonly #class = WcUnsupportedEventsError
  readonly name = this.#class.name

  constructor() {
    super(5102, "Unsupported events")
  }

}

export class WcUnsupportedAccountsError extends RpcError {
  readonly #class = WcUnsupportedAccountsError
  readonly name = this.#class.name

  constructor() {
    super(5103, "Unsupported accounts")
  }

}

export class WcUnsupportedNamespaceKeyError extends RpcError {
  readonly #class = WcUnsupportedNamespaceKeyError
  readonly name = this.#class.name

  constructor() {
    super(5104, "Unsupported namespace key")
  }

}

export class WcUserDisconnectedError extends RpcError {
  readonly #class = WcUserDisconnectedError
  readonly name = this.#class.name

  constructor() {
    super(6000, "User disconnected")
  }

}