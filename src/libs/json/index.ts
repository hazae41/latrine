export namespace BigJson {

  /**
   * Bigger than MAX_SAFE_INTEGER
   */
  const BIG_REGEX = /([\[:])?(\d{17,}|(?:[9](?:[1-9]07199254740991|0[1-9]7199254740991|00[8-9]199254740991|007[2-9]99254740991|007199[3-9]54740991|0071992[6-9]4740991|00719925[5-9]740991|007199254[8-9]40991|0071992547[5-9]0991|00719925474[1-9]991|00719925474099[2-9])))([,\}\]])/g;

  export function stringify(value: any) {
    function replacer(key: string, value: any) {
      if (typeof value !== "bigint")
        return value
      return `${value.toString()}n`
    }

    return JSON.stringify(value, replacer)
  }

  export function parse(text: string) {
    const replaced = text.replace(BIG_REGEX, `$1"$2n"$3`)

    function reviver(_key: string, value: any) {
      if (typeof value !== "string")
        return value
      if (!value.match(/^\d+n$/))
        return value
      return BigInt(value.slice(0, -1))
    }

    return JSON.parse(replaced, reviver)
  }

}

export namespace SafeJson {

  export function stringify(value: any) {
    if (typeof value === "string")
      return value
    return BigJson.stringify(value)
  }

  export function parse(text: string) {
    try {
      return BigJson.parse(text)
    } catch (e: unknown) {
      return text
    }
  }

}