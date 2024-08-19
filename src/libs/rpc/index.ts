import { Future } from "@hazae41/future";
import { RpcRequest, RpcRequestPreinit, RpcResponse } from "@hazae41/jsonrpc";
import { SafeJson } from "libs/json/index.js";

export namespace SafeRpc {

  export function prepare<T>(init: RpcRequestPreinit<T>): RpcRequest<T> {
    const { method, params } = init

    const id = Date.now() + Math.floor(Math.random() * 1000)

    return new RpcRequest(id, method, params)
  }

  export async function requestOrThrow<T>(socket: WebSocket, init: RpcRequestPreinit<unknown>, signal = new AbortController().signal) {
    using stack = new DisposableStack()

    const future = new Future<RpcResponse<T>>()

    const request = SafeRpc.prepare(init)

    const onMessage = async (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string")
        return

      const json = SafeJson.parse(event.data)
      const response = RpcResponse.from<T>(json)

      if (response.id !== request.id)
        return

      future.resolve(response)
    }

    socket.addEventListener("message", onMessage, { passive: true })
    stack.defer(() => socket.removeEventListener("message", onMessage))

    const onError = (cause: unknown) => future.reject(new Error("Errored", { cause }))
    const onClose = (cause: unknown) => future.reject(new Error("Closed", { cause }))

    socket.addEventListener("close", onClose, { passive: true })
    stack.defer(() => socket.removeEventListener("close", onClose))

    socket.addEventListener("error", onError, { passive: true })
    stack.defer(() => socket.removeEventListener("error", onError))

    const onAbort = () => future.reject(new Error("Aborted", { cause: signal.reason }))

    signal.addEventListener("abort", onAbort, { passive: true })
    stack.defer(() => signal.removeEventListener("abort", onAbort))

    socket.send(SafeJson.stringify(request))

    return await future.promise
  }

}