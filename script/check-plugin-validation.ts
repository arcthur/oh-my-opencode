import { join } from "node:path"
import { validatePlugins } from "../src/cli/plugin-validate"

type ValidationCase = {
  name: string
  options: {
    path: string
    strict?: boolean
  }
  expectedExitCode: number
}

const fixturesRoot = join(import.meta.dir, "..", "test", "fixtures", "claude-plugins")

const validationCases: ValidationCase[] = [
  {
    name: "valid fixture should pass",
    options: {
      path: join(fixturesRoot, "valid-plugin"),
    },
    expectedExitCode: 0,
  },
  {
    name: "invalid fixture should fail",
    options: {
      path: join(fixturesRoot, "invalid-plugin-no-manifest"),
    },
    expectedExitCode: 1,
  },
  {
    name: "warning fixture should fail in strict mode",
    options: {
      path: join(fixturesRoot, "warn-plugin"),
      strict: true,
    },
    expectedExitCode: 1,
  },
]

async function runValidationCase(testCase: ValidationCase): Promise<void> {
  const originalLog = console.log
  console.log = () => {}

  try {
    const actualExitCode = await validatePlugins({
      ...testCase.options,
      json: true,
    })

    if (actualExitCode !== testCase.expectedExitCode) {
      throw new Error(
        `Case \"${testCase.name}\" failed: expected exit code ${testCase.expectedExitCode}, got ${actualExitCode}`
      )
    }
  } finally {
    console.log = originalLog
  }
}

async function main(): Promise<void> {
  for (const testCase of validationCases) {
    await runValidationCase(testCase)
  }

  console.log("Plugin validation gate passed")
}

await main()
