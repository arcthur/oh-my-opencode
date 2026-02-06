export interface HookServiceResolver {
  resolve<T>(token: string): Promise<T>
  has(token: string): boolean
}

export type HookServiceProvider<T = unknown> = (
  resolver: HookServiceResolver
) => T | Promise<T>

export class HookServiceContainer implements HookServiceResolver {
  private readonly providers = new Map<string, HookServiceProvider>()
  private readonly values = new Map<string, unknown>()
  private readonly pending = new Map<string, Promise<unknown>>()

  registerValue<T>(token: string, value: T): void {
    this.values.set(token, value)
    this.pending.delete(token)
  }

  registerProvider<T>(token: string, provider: HookServiceProvider<T>): void {
    this.providers.set(token, provider as HookServiceProvider)
  }

  has(token: string): boolean {
    return this.values.has(token) || this.providers.has(token)
  }

  async resolve<T>(token: string): Promise<T> {
    return this.resolveInternal<T>(token, [])
  }

  private async resolveInternal<T>(token: string, stack: string[]): Promise<T> {
    if (this.values.has(token)) {
      return this.values.get(token) as T
    }

    if (stack.includes(token)) {
      const cyclePath = [...stack, token].join(" -> ")
      throw new Error(`Cyclic service dependency detected: ${cyclePath}`)
    }

    if (this.pending.has(token)) {
      return this.pending.get(token) as Promise<T>
    }

    const provider = this.providers.get(token)
    if (!provider) {
      throw new Error(`Unknown service token: ${token}`)
    }

    const nextStack = [...stack, token]

    const scopedResolver: HookServiceResolver = {
      resolve: <U>(depToken: string) => this.resolveInternal<U>(depToken, nextStack),
      has: (depToken: string) => this.has(depToken),
    }

    const pending = Promise.resolve(provider(scopedResolver))
      .then((value) => {
        this.values.set(token, value)
        this.pending.delete(token)
        return value
      })
      .catch((error) => {
        this.pending.delete(token)
        throw error
      })

    this.pending.set(token, pending)
    return pending as Promise<T>
  }
}
