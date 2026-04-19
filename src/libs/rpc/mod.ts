import { SafeJson } from "@/libs/json/mod.ts";
import { RpcParamfulRequestPreinit, RpcRequest, RpcRequestPreinit, RpcResponse } from "@hazae41/jsonrpc";

export namespace SafeRpc {

  export function prepare<T>(init: RpcRequestPreinit<T>): RpcRequest<T> {
    const { method, params } = init as RpcParamfulRequestPreinit<T>

    const id = Date.now() + Math.floor(Math.random() * 1000)

    return new RpcRequest(id, method, params)
  }

  export async function requestOrThrow<T>(socket: WebSocket, init: RpcRequestPreinit<unknown>, signal = new AbortController().signal) {
    using stack = new DisposableStack()

    const cleaner = new AbortController()
    stack.defer(() => cleaner.abort())

    const { reject, resolve, promise } = Promise.withResolvers<RpcResponse<T>>()

    const request = SafeRpc.prepare(init)

    socket.addEventListener("message", async (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string")
        return

      const json = SafeJson.parse(event.data)
      const response = RpcResponse.from<T>(json)

      if (response.id !== request.id)
        return

      resolve(response)
    }, { signal: cleaner.signal })

    socket.addEventListener("error", (cause: unknown) => {
      reject(new Error("Errored", { cause }))
    }, { signal: cleaner.signal })

    socket.addEventListener("close", (cause: unknown) => {
      reject(new Error("Closed", { cause }))
    }, { signal: cleaner.signal })

    signal.addEventListener("abort", () => {
      reject(new Error("Aborted", { cause: signal.reason }))
    }, { signal: cleaner.signal })

    socket.send(SafeJson.stringify(request))

    return await promise
  }

}