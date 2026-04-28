import { RpcError } from "@hazae41/jsonrpc";

export class WcInvalidMethodError extends RpcError {
  readonly #class = WcInvalidMethodError
  readonly name = this.#class.name

  constructor() {
    super(1001, "Invalid method")
  }

}

export class WcInvalidEventError extends RpcError {
  readonly #class = WcInvalidEventError
  readonly name = this.#class.name

  constructor() {
    super(1002, "Invalid event")
  }

}

export class WcInvalidUpdateRequestError extends RpcError {
  readonly #class = WcInvalidUpdateRequestError
  readonly name = this.#class.name

  constructor() {
    super(1003, "Invalid update request")
  }

}

export class WcInvalidExtendRequestError extends RpcError {
  readonly #class = WcInvalidExtendRequestError
  readonly name = this.#class.name

  constructor() {
    super(1004, "Invalid extend request")
  }

}

export class WcInvalidSessionSettleRequestError extends RpcError {
  readonly #class = WcInvalidSessionSettleRequestError
  readonly name = this.#class.name

  constructor() {
    super(1005, "Invalid session settle request")
  }

}

export class WcUnauthorizedMethodError extends RpcError {
  readonly #class = WcUnauthorizedMethodError
  readonly name = this.#class.name

  constructor() {
    super(3001, "Unauthorized method")
  }

}

export class WcUnauthorizedEventError extends RpcError {
  readonly #class = WcUnauthorizedEventError
  readonly name = this.#class.name

  constructor() {
    super(3002, "Unauthorized event")
  }

}

export class WcUnauthorizedUpdateRequestError extends RpcError {
  readonly #class = WcUnauthorizedUpdateRequestError
  readonly name = this.#class.name

  constructor() {
    super(3003, "Unauthorized update request")
  }

}

export class WcUnauthorizedExtendRequestError extends RpcError {
  readonly #class = WcUnauthorizedExtendRequestError
  readonly name = this.#class.name

  constructor() {
    super(3004, "Unauthorized extend request")
  }

}

export class WcUnauthorizedChainError extends RpcError {
  readonly #class = WcUnauthorizedChainError
  readonly name = this.#class.name

  constructor() {
    super(3005, "Unauthorized chain")
  }

}

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

export class WcSessionSettlementFailedError extends RpcError {
  readonly #class = WcSessionSettlementFailedError
  readonly name = this.#class.name

  constructor() {
    super(7000, "Session settlement failed")
  }

}

export class WcNoSessionForTopicError extends RpcError {
  readonly #class = WcNoSessionForTopicError
  readonly name = this.#class.name

  constructor() {
    super(7001, "No session for topic")
  }

}

export class WcSessionRequestExpiredError extends RpcError {
  readonly #class = WcSessionRequestExpiredError
  readonly name = this.#class.name

  constructor() {
    super(8000, "Session request expired")
  }

}