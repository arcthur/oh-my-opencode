import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs"
import { z } from "zod"
import {
  getTeamDir,
  getInboxPath,
  getProjectRoot,
  ensureDir,
  readJsonSafe,
  ORCHESTRATOR_PROJECT_ROOT_ENV,
  writeJsonAtomic,
} from "./storage"

const TEST_DIR = join(import.meta.dirname, ".test-storage")

describe("Storage Utilities", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("getProjectRoot", () => {
    it("uses cwd when ORCHESTRATOR_PROJECT_ROOT is not set", () => {
      // #given
      const originalEnv = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
      delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]

      try {
        // #when
        const result = getProjectRoot()

        // #then
        expect(result).toBe(process.cwd())
      } finally {
        if (originalEnv !== undefined) {
          process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = originalEnv
        } else {
          delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
        }
      }
    })

    it("uses ORCHESTRATOR_PROJECT_ROOT when set", () => {
      // #given
      const originalEnv = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
      process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = TEST_DIR

      try {
        // #when
        const result = getProjectRoot()

        // #then
        expect(result).toBe(TEST_DIR)
      } finally {
        if (originalEnv !== undefined) {
          process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = originalEnv
        } else {
          delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
        }
      }
    })
  })

  describe("getTeamDir", () => {
    // given team name and default config
    // when getting team directory
    // then it should return .orchestrator/teams/{teamName}
    it("returns orchestrator team path", () => {
      const config = { orchestrator: { swarm: { storage_path: ".orchestrator/teams" } } }
      const result = getTeamDir("my-team", config as any)
      expect(result).toContain(".orchestrator/teams/my-team")
    })
  })

  describe("getInboxPath", () => {
    // given team and agent names
    // when getting inbox path
    // then it should return path to inbox JSON file
    it("returns path to inbox JSON", () => {
      const config = { orchestrator: { swarm: { storage_path: ".orchestrator/teams" } } }
      const result = getInboxPath("my-team", "agent-001", config as any)
      expect(result).toContain("my-team/inboxes/agent-001.json")
    })
  })

  describe("ensureDir", () => {
    // given a non-existent directory path
    // when calling ensureDir
    // then it should create the directory
    it("creates directory if not exists", () => {
      const dirPath = join(TEST_DIR, "new-dir", "nested")
      ensureDir(dirPath)
      expect(existsSync(dirPath)).toBe(true)
    })

    // given an existing directory
    // when calling ensureDir
    // then it should not throw
    it("does not throw for existing directory", () => {
      const dirPath = join(TEST_DIR, "existing")
      mkdirSync(dirPath, { recursive: true })
      expect(() => ensureDir(dirPath)).not.toThrow()
    })
  })

  describe("readJsonSafe", () => {
    // given a valid JSON file matching schema
    // when reading with readJsonSafe
    // then it should return parsed object
    it("reads and parses valid JSON", () => {
      const testSchema = z.object({ name: z.string(), value: z.number() })
      const filePath = join(TEST_DIR, "test.json")
      writeFileSync(filePath, JSON.stringify({ name: "test", value: 42 }))

      const result = readJsonSafe(filePath, testSchema)
      expect(result).toEqual({ name: "test", value: 42 })
    })

    // given a non-existent file
    // when reading with readJsonSafe
    // then it should return null
    it("returns null for non-existent file", () => {
      const testSchema = z.object({ name: z.string() })
      const result = readJsonSafe(join(TEST_DIR, "missing.json"), testSchema)
      expect(result).toBeNull()
    })

    // given invalid JSON content
    // when reading with readJsonSafe
    // then it should return null
    it("returns null for invalid JSON", () => {
      const testSchema = z.object({ name: z.string() })
      const filePath = join(TEST_DIR, "invalid.json")
      writeFileSync(filePath, "not valid json")

      const result = readJsonSafe(filePath, testSchema)
      expect(result).toBeNull()
    })

    // given JSON that doesn't match schema
    // when reading with readJsonSafe
    // then it should return null
    it("returns null for schema mismatch", () => {
      const testSchema = z.object({ name: z.string(), required: z.number() })
      const filePath = join(TEST_DIR, "mismatch.json")
      writeFileSync(filePath, JSON.stringify({ name: "test" }))

      const result = readJsonSafe(filePath, testSchema)
      expect(result).toBeNull()
    })
  })

  describe("writeJsonAtomic", () => {
    // given data to write
    // when calling writeJsonAtomic
    // then it should write to file atomically
    it("writes JSON atomically", () => {
      const filePath = join(TEST_DIR, "atomic.json")
      const data = { key: "value", number: 123 }

      writeJsonAtomic(filePath, data)

      const content = readFileSync(filePath, "utf-8")
      expect(JSON.parse(content)).toEqual(data)
    })

    // given a deeply nested path
    // when calling writeJsonAtomic
    // then it should create parent directories
    it("creates parent directories", () => {
      const filePath = join(TEST_DIR, "deep", "nested", "file.json")
      writeJsonAtomic(filePath, { test: true })

      expect(existsSync(filePath)).toBe(true)
    })
  })
})
