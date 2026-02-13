export interface ExpiringRequestStoreOptions<T> {
  ttlMs: number
  maxEntries: number
  onExpired?: (key: string, value: T) => void
  onRejected?: (key: string, value: T) => void
}

interface StoredEntry<T> {
  value: T
  expiresAt: number
}

export class ExpiringRequestStore<T> {
  private readonly entries = new Map<string, StoredEntry<T>>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly onExpired?: (key: string, value: T) => void
  private readonly onRejected?: (key: string, value: T) => void

  constructor(options: ExpiringRequestStoreOptions<T>) {
    this.ttlMs = options.ttlMs
    this.maxEntries = options.maxEntries
    this.onExpired = options.onExpired
    this.onRejected = options.onRejected
  }

  set(key: string, value: T): boolean {
    this.sweep()
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.onRejected?.(key, value)
      return false
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
    return true
  }

  get(key: string): T | null {
    const entry = this.entries.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      this.onExpired?.(key, entry.value)
      return null
    }
    return entry.value
  }

  delete(key: string): boolean {
    return this.entries.delete(key)
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  values(): T[] {
    this.sweep()
    return Array.from(this.entries.values()).map((entry) => entry.value)
  }

  size(): number {
    this.sweep()
    return this.entries.size
  }

  sweep(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key)
        this.onExpired?.(key, entry.value)
        removed++
      }
    }
    return removed
  }
}
