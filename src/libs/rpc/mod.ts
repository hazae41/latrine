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

    const responded = Promise.withResolvers<RpcResponse<T>>()
    stack.defer(() => responded.reject())
    responded.promise.catch(() => { })

    const request = SafeRpc.prepare(init)

    socket.addEventListener("message", async (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string")
        return

      const json = SafeJson.parse(event.data)
      const response = RpcResponse.from<T>(json)

      if (response.id !== request.id)
        return

      responded.resolve(response)
    }, { signal: cleaner.signal })

    socket.addEventListener("error", responded.reject, { signal: cleaner.signal })
    socket.addEventListener("close", responded.reject, { signal: cleaner.signal })
    signal.addEventListener("abort", responded.reject, { signal: cleaner.signal })

    socket.send(SafeJson.stringify(request))

    return await responded.promise
  }

}