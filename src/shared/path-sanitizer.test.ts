import { describe, test, expect } from "bun:test"
import { sanitizePathSegment } from "./path-sanitizer"

describe("sanitizePathSegment", () => {
  // #region basic sanitization
  test("passes through valid simple names", () => {
    expect(sanitizePathSegment("auth-system")).toBe("auth-system")
    expect(sanitizePathSegment("dark_mode")).toBe("dark_mode")
    expect(sanitizePathSegment("feature123")).toBe("feature123")
  })

  test("trims whitespace", () => {
    expect(sanitizePathSegment("  auth-system  ")).toBe("auth-system")
    expect(sanitizePathSegment("\tfeature\n")).toBe("feature")
  })

  test("returns undefined for empty input", () => {
    expect(sanitizePathSegment("")).toBeUndefined()
    expect(sanitizePathSegment("   ")).toBeUndefined()
    // @ts-expect-error - testing null input
    expect(sanitizePathSegment(null)).toBeUndefined()
    // @ts-expect-error - testing undefined input
    expect(sanitizePathSegment(undefined)).toBeUndefined()
  })
  // #endregion

  // #region path traversal prevention
  test("rejects path traversal attempts", () => {
    expect(sanitizePathSegment("../etc/passwd")).toBeUndefined()
    expect(sanitizePathSegment("..\\windows\\system32")).toBeUndefined()
    expect(sanitizePathSegment("foo/../bar")).toBeUndefined()
    expect(sanitizePathSegment("foo/..")).toBeUndefined()
  })

  test("extracts basename from paths", () => {
    expect(sanitizePathSegment("foo/bar/baz")).toBe("baz")
    expect(sanitizePathSegment("/absolute/path/name")).toBe("name")
    expect(sanitizePathSegment("relative/path/file.txt")).toBe("file.txt")
  })
  // #endregion

  // #region unsafe character handling
  test("replaces unsafe characters", () => {
    expect(sanitizePathSegment("file<>name")).toBe("file-name")
    expect(sanitizePathSegment("test:name")).toBe("test-name")
    expect(sanitizePathSegment('file"name')).toBe("file-name")
    expect(sanitizePathSegment("file|name")).toBe("file-name")
    expect(sanitizePathSegment("file?name")).toBe("file-name")
    expect(sanitizePathSegment("file*name")).toBe("file-name")
  })

  test("collapses multiple replacement characters", () => {
    expect(sanitizePathSegment("file<>:<>name")).toBe("file-name")
    expect(sanitizePathSegment("a---b")).toBe("a-b")
  })

  test("removes leading/trailing dots and dashes", () => {
    expect(sanitizePathSegment(".hidden")).toBe("hidden")
    expect(sanitizePathSegment("-prefixed")).toBe("prefixed")
    expect(sanitizePathSegment("suffixed.")).toBe("suffixed")
    expect(sanitizePathSegment("suffixed-")).toBe("suffixed")
    expect(sanitizePathSegment("...dots...")).toBe("dots")
  })
  // #endregion

  // #region consecutive dots
  test("replaces consecutive dots", () => {
    expect(sanitizePathSegment("file..name")).toBe("file-name")
    expect(sanitizePathSegment("file...name")).toBe("file-name")
  })
  // #endregion

  // #region length limits
  test("truncates to maxLength", () => {
    const longName = "a".repeat(150)
    const result = sanitizePathSegment(longName)
    expect(result?.length).toBeLessThanOrEqual(100)
  })

  test("respects custom maxLength", () => {
    const longName = "a".repeat(50)
    const result = sanitizePathSegment(longName, { maxLength: 20 })
    expect(result?.length).toBeLessThanOrEqual(20)
  })
  // #endregion

  // #region custom replacement
  test("uses custom replacement character", () => {
    const result = sanitizePathSegment("file<>name", { replacement: "_" })
    expect(result).toBe("file_name")
  })
  // #endregion

  // #region dots option
  test("can disallow dots entirely", () => {
    const result = sanitizePathSegment("file.ext", { allowDots: false })
    expect(result).toBe("file-ext")
  })
  // #endregion

  // #region edge cases
  test("handles names that become empty after sanitization", () => {
    expect(sanitizePathSegment("...")).toBeUndefined()
    expect(sanitizePathSegment("---")).toBeUndefined()
    expect(sanitizePathSegment("<>")).toBeUndefined()
  })
  // #endregion
})
