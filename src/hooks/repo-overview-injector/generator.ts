import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, basename } from "node:path"
import type { RepoOverview } from "./types"
import { log } from "../../shared/logger"

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  ".cache",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".pytest_cache",
  "venv",
  ".venv",
  "vendor",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
])

const CORE_FILE_PATTERNS = [
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^\.env\.example$/,
  /^README\.md$/i,
  /^Makefile$/,
  /^Dockerfile$/,
  /^docker-compose\.ya?ml$/,
  /^\.gitignore$/,
  /^requirements\.txt$/,
  /^pyproject\.toml$/,
  /^Cargo\.toml$/,
  /^go\.mod$/,
  /^pom\.xml$/,
  /^build\.gradle$/,
  /^Gemfile$/,
]

const ENTRY_POINT_PATTERNS = [
  /^(src\/)?index\.(ts|js|tsx|jsx)$/,
  /^(src\/)?main\.(ts|js|tsx|jsx|py|go|rs)$/,
  /^(src\/)?app\.(ts|js|tsx|jsx|py)$/,
  /^(src\/)?server\.(ts|js)$/,
  /^(lib\/)?index\.(ts|js)$/,
]

interface PackageJson {
  name?: string
  description?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function generateRepoOverview(projectDir: string, maxDepth: number = 50): RepoOverview {
  const name = basename(projectDir)
  const overview: RepoOverview = {
    name,
    techStack: [],
    commands: {},
    coreFiles: [],
    structure: "",
    frameworks: [],
  }

  try {
    // Parse package.json if exists
    const pkgPath = join(projectDir, "package.json")
    if (existsSync(pkgPath)) {
      const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"))
      if (pkg.name) overview.name = pkg.name
      if (pkg.description) overview.description = pkg.description

      // Extract commands
      if (pkg.scripts) {
        overview.commands = {
          build: pkg.scripts.build,
          dev: pkg.scripts.dev || pkg.scripts.start,
          test: pkg.scripts.test,
          lint: pkg.scripts.lint,
          start: pkg.scripts.start,
        }
      }

      // Detect tech stack and frameworks
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      detectTechStack(allDeps, overview)
    }

    // Detect package manager
    overview.packageManager = detectPackageManager(projectDir)

    // Detect additional tech from files
    detectTechFromFiles(projectDir, overview)

    // Find core files
    overview.coreFiles = findCoreFiles(projectDir)

    // Generate directory tree
    overview.structure = generateDirectoryTree(projectDir, maxDepth)

  } catch (error) {
    log("[repo-overview] error generating overview", { error: String(error) })
  }

  return overview
}

function detectTechStack(deps: Record<string, string>, overview: RepoOverview): void {
  const techMap: Record<string, { tech: string; framework?: string }> = {
    typescript: { tech: "TypeScript" },
    react: { tech: "React", framework: "React" },
    "react-dom": { tech: "React", framework: "React" },
    next: { tech: "Next.js", framework: "Next.js" },
    vue: { tech: "Vue.js", framework: "Vue.js" },
    nuxt: { tech: "Nuxt", framework: "Nuxt" },
    svelte: { tech: "Svelte", framework: "Svelte" },
    angular: { tech: "Angular", framework: "Angular" },
    express: { tech: "Express.js", framework: "Express" },
    fastify: { tech: "Fastify", framework: "Fastify" },
    nestjs: { tech: "NestJS", framework: "NestJS" },
    "@nestjs/core": { tech: "NestJS", framework: "NestJS" },
    hono: { tech: "Hono", framework: "Hono" },
    prisma: { tech: "Prisma" },
    "@prisma/client": { tech: "Prisma" },
    drizzle: { tech: "Drizzle ORM" },
    "drizzle-orm": { tech: "Drizzle ORM" },
    mongoose: { tech: "MongoDB/Mongoose" },
    jest: { tech: "Jest" },
    vitest: { tech: "Vitest" },
    mocha: { tech: "Mocha" },
    playwright: { tech: "Playwright" },
    cypress: { tech: "Cypress" },
    tailwindcss: { tech: "Tailwind CSS" },
    zod: { tech: "Zod" },
    trpc: { tech: "tRPC" },
    "@trpc/server": { tech: "tRPC" },
    graphql: { tech: "GraphQL" },
    "@apollo/server": { tech: "Apollo GraphQL" },
  }

  const addedTech = new Set<string>()
  const addedFrameworks = new Set<string>()

  for (const dep of Object.keys(deps)) {
    const match = techMap[dep]
    if (match) {
      if (!addedTech.has(match.tech)) {
        overview.techStack.push(match.tech)
        addedTech.add(match.tech)
      }
      if (match.framework && !addedFrameworks.has(match.framework)) {
        overview.frameworks.push(match.framework)
        addedFrameworks.add(match.framework)
      }
    }
  }

  // Detect test framework
  if (deps.jest) overview.testFramework = "Jest"
  else if (deps.vitest) overview.testFramework = "Vitest"
  else if (deps.mocha) overview.testFramework = "Mocha"
  else if (deps.playwright || deps["@playwright/test"]) overview.testFramework = "Playwright"
  else if (deps.cypress) overview.testFramework = "Cypress"
}

function detectPackageManager(projectDir: string): string | undefined {
  if (existsSync(join(projectDir, "bun.lockb"))) return "bun"
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(projectDir, "yarn.lock"))) return "yarn"
  if (existsSync(join(projectDir, "package-lock.json"))) return "npm"
  return undefined
}

function detectTechFromFiles(projectDir: string, overview: RepoOverview): void {
  const techDetectors: Array<{ file: string; tech: string; framework?: string }> = [
    { file: "tsconfig.json", tech: "TypeScript" },
    { file: "pyproject.toml", tech: "Python" },
    { file: "requirements.txt", tech: "Python" },
    { file: "Cargo.toml", tech: "Rust" },
    { file: "go.mod", tech: "Go" },
    { file: "pom.xml", tech: "Java/Maven" },
    { file: "build.gradle", tech: "Java/Gradle" },
    { file: "Gemfile", tech: "Ruby" },
    { file: "mix.exs", tech: "Elixir" },
    { file: "Dockerfile", tech: "Docker" },
    { file: "docker-compose.yml", tech: "Docker Compose" },
    { file: "docker-compose.yaml", tech: "Docker Compose" },
    { file: ".github/workflows", tech: "GitHub Actions" },
    { file: "vercel.json", tech: "Vercel" },
    { file: "netlify.toml", tech: "Netlify" },
  ]

  const addedTech = new Set(overview.techStack)

  for (const { file, tech } of techDetectors) {
    if (existsSync(join(projectDir, file)) && !addedTech.has(tech)) {
      overview.techStack.push(tech)
      addedTech.add(tech)
    }
  }
}

function findCoreFiles(projectDir: string): string[] {
  const coreFiles: string[] = []

  try {
    const files = readdirSync(projectDir)

    for (const file of files) {
      const fullPath = join(projectDir, file)
      const stat = statSync(fullPath)

      if (stat.isFile()) {
        // Check core file patterns
        for (const pattern of CORE_FILE_PATTERNS) {
          if (pattern.test(file)) {
            coreFiles.push(file)
            break
          }
        }
      }
    }

    // Check for entry points in src/
    const srcDir = join(projectDir, "src")
    if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
      const srcFiles = readdirSync(srcDir)
      for (const file of srcFiles) {
        for (const pattern of ENTRY_POINT_PATTERNS) {
          if (pattern.test(`src/${file}`)) {
            coreFiles.push(`src/${file}`)
            break
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return coreFiles
}

function generateDirectoryTree(projectDir: string, maxLines: number): string {
  const lines: string[] = []

  function traverse(dir: string, prefix: string, depth: number): void {
    if (lines.length >= maxLines) return
    if (depth > 4) return // Max depth of 4 levels

    try {
      const items = readdirSync(dir)
        .filter(item => !IGNORE_DIRS.has(item) && !item.startsWith("."))
        .sort((a, b) => {
          const aIsDir = statSync(join(dir, a)).isDirectory()
          const bIsDir = statSync(join(dir, b)).isDirectory()
          if (aIsDir && !bIsDir) return -1
          if (!aIsDir && bIsDir) return 1
          return a.localeCompare(b)
        })

      for (let i = 0; i < items.length && lines.length < maxLines; i++) {
        const item = items[i]
        const isLast = i === items.length - 1
        const fullPath = join(dir, item)
        const stat = statSync(fullPath)
        const connector = isLast ? "└── " : "├── "
        const newPrefix = prefix + (isLast ? "    " : "│   ")

        lines.push(`${prefix}${connector}${item}${stat.isDirectory() ? "/" : ""}`)

        if (stat.isDirectory()) {
          traverse(fullPath, newPrefix, depth + 1)
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  lines.push(basename(projectDir) + "/")
  traverse(projectDir, "", 0)

  if (lines.length >= maxLines) {
    lines.push("... (truncated)")
  }

  return lines.join("\n")
}

export function formatRepoOverview(overview: RepoOverview): string {
  const sections: string[] = []

  // Header
  sections.push(`# Repository Overview: ${overview.name}`)
  if (overview.description) {
    sections.push(`\n${overview.description}`)
  }

  // Tech Stack
  if (overview.techStack.length > 0) {
    sections.push(`\n## Tech Stack\n${overview.techStack.join(", ")}`)
  }

  // Frameworks
  if (overview.frameworks.length > 0) {
    sections.push(`\n## Frameworks\n${overview.frameworks.join(", ")}`)
  }

  // Package Manager & Test Framework
  const extras: string[] = []
  if (overview.packageManager) extras.push(`Package Manager: ${overview.packageManager}`)
  if (overview.testFramework) extras.push(`Test Framework: ${overview.testFramework}`)
  if (extras.length > 0) {
    sections.push(`\n## Environment\n${extras.join("\n")}`)
  }

  // Commands
  const commands = Object.entries(overview.commands)
    .filter(([, cmd]) => cmd)
    .map(([name, cmd]) => `- ${name}: \`${cmd}\``)
  if (commands.length > 0) {
    sections.push(`\n## Commands\n${commands.join("\n")}`)
  }

  // Core Files
  if (overview.coreFiles.length > 0) {
    sections.push(`\n## Core Files\n${overview.coreFiles.map(f => `- ${f}`).join("\n")}`)
  }

  // Directory Structure
  if (overview.structure) {
    sections.push(`\n## Structure\n\`\`\`\n${overview.structure}\n\`\`\``)
  }

  return sections.join("\n")
}
