import { describe, test, expect } from "bun:test"
import { createBuiltinSkills } from "./skills"

describe("createBuiltinSkills", () => {
	test("returns playwright skill by default", () => {
		// given - no options (default)

		// when
		const skills = createBuiltinSkills()

		// then
		const browserSkill = skills.find((s) => s.name === "playwright")
		expect(browserSkill).toBeDefined()
		expect(browserSkill!.description).toContain("browser")
		expect(browserSkill!.mcpConfig).toHaveProperty("playwright")
	})

	test("returns playwright skill when browserProvider is 'playwright'", () => {
		// given
		const options = { browserProvider: "playwright" as const }

		// when
		const skills = createBuiltinSkills(options)

		// then
		const playwrightSkill = skills.find((s) => s.name === "playwright")
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")
		expect(playwrightSkill).toBeDefined()
		expect(agentBrowserSkill).toBeUndefined()
	})

	test("returns agent-browser skill when browserProvider is 'agent-browser'", () => {
		// given
		const options = { browserProvider: "agent-browser" as const }

		// when
		const skills = createBuiltinSkills(options)

		// then
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")
		const playwrightSkill = skills.find((s) => s.name === "playwright")
		expect(agentBrowserSkill).toBeDefined()
		expect(agentBrowserSkill!.description).toContain("browser")
		expect(agentBrowserSkill!.allowedTools).toContain("Bash(agent-browser:*)")
		expect(agentBrowserSkill!.template).toContain("agent-browser")
		expect(playwrightSkill).toBeUndefined()
	})

	test("agent-browser skill template is inlined (not loaded from file)", () => {
		// given
		const options = { browserProvider: "agent-browser" as const }

		// when
		const skills = createBuiltinSkills(options)
		const agentBrowserSkill = skills.find((s) => s.name === "agent-browser")

		// then - template should contain substantial content (inlined, not fallback)
		expect(agentBrowserSkill!.template).toContain("## Quick start")
		expect(agentBrowserSkill!.template).toContain("## Commands")
		expect(agentBrowserSkill!.template).toContain("agent-browser open")
		expect(agentBrowserSkill!.template).toContain("agent-browser snapshot")
	})

	test("always includes frontend-ui-ux and git-master skills", () => {
		// given - both provider options

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })

		// then
		for (const skills of [defaultSkills, agentBrowserSkills]) {
			expect(skills.find((s) => s.name === "frontend-ui-ux")).toBeDefined()
			expect(skills.find((s) => s.name === "git-master")).toBeDefined()
		}
	})

	test("always includes parallel-agents skill", () => {
		// given

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })

		// then
		for (const skills of [defaultSkills, agentBrowserSkills]) {
			expect(skills.find((s) => s.name === "parallel-agents")).toBeDefined()
		}
	})

	test("always includes engineering discipline review skills", () => {
		// given

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })

		// then
		for (const skills of [defaultSkills, agentBrowserSkills]) {
			expect(skills.find((s) => s.name === "spec-compliance-review")).toBeDefined()
			expect(skills.find((s) => s.name === "code-quality-review")).toBeDefined()
			expect(skills.find((s) => s.name === "writing-plans")).toBeDefined()
			expect(skills.find((s) => s.name === "systematic-debugging")).toBeDefined()
			expect(skills.find((s) => s.name === "code-simplifier")).toBeDefined()
		}
	})

	test("always includes cartography skill", () => {
		// given

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })

		// then
		for (const skills of [defaultSkills, agentBrowserSkills]) {
			expect(skills.find((s) => s.name === "cartography")).toBeDefined()
		}
	})

	test("writing-plans template requires scenario mapping and negative verification", () => {
		// given
		const skills = createBuiltinSkills()
		const writingPlans = skills.find((s) => s.name === "writing-plans")

		// when / #then
		expect(writingPlans).toBeDefined()
		expect(writingPlans!.template).toContain("Scenario Ref")
		expect(writingPlans!.template).toContain("Negative verification")
	})

	test("code-quality-review template includes unambiguous review contract and preflight edge-cases", () => {
		// given
		const skills = createBuiltinSkills()
		const codeQualityReview = skills.find((s) => s.name === "code-quality-review")

		// when / #then
		expect(codeQualityReview).toBeDefined()
		expect(codeQualityReview!.template).toContain("Ambiguity Guardrails")
		expect(codeQualityReview!.template).toContain("No diff handling")
		expect(codeQualityReview!.template).toContain("Large diff handling (>500 LOC changed)")
		expect(codeQualityReview!.template).toContain("Mixed concerns handling")
	})

	test("code-quality-review template covers SOLID, security concurrency, and boundary checks", () => {
		// given
		const skills = createBuiltinSkills()
		const codeQualityReview = skills.find((s) => s.name === "code-quality-review")

		// when / #then
		expect(codeQualityReview).toBeDefined()
		expect(codeQualityReview!.template).toContain("Architecture & SOLID Review")
		expect(codeQualityReview!.template).toContain("Security / Safety / Reliability Review")
		expect(codeQualityReview!.template).toContain("Race conditions and TOCTOU")
		expect(codeQualityReview!.template).toContain("Boundary Conditions Review")
		expect(codeQualityReview!.template).toContain("Removal / Simplification Candidates (Optional)")
	})

	test("code-quality-review template defines strict severity and verdict mapping", () => {
		// given
		const skills = createBuiltinSkills()
		const codeQualityReview = skills.find((s) => s.name === "code-quality-review")

		// when / #then
		expect(codeQualityReview).toBeDefined()
		expect(codeQualityReview!.template).toContain("Severity and Blocking Rules")
		expect(codeQualityReview!.template).toContain("P0 (critical, always blocking)")
		expect(codeQualityReview!.template).toContain("Verdict: PASS | PASS_WITH_NITS | FAIL")
		expect(codeQualityReview!.template).toContain("Blocking issue count")
	})

	test("code-quality-review template includes security long-tail checklist coverage", () => {
		// given
		const skills = createBuiltinSkills()
		const codeQualityReview = skills.find((s) => s.name === "code-quality-review")

		// when / #then
		expect(codeQualityReview).toBeDefined()
		expect(codeQualityReview!.template).toContain("JWT & token hardening")
		expect(codeQualityReview!.template).toContain("CORS and security headers")
		expect(codeQualityReview!.template).toContain("Supply-chain and dependency risk")
		expect(codeQualityReview!.template).toContain("Cryptography safety")
		expect(codeQualityReview!.template).toContain("Data integrity and idempotency")
	})

	test("code-quality-review template resolves evidence uncertainty into blocking verdict semantics", () => {
		// given
		const skills = createBuiltinSkills()
		const codeQualityReview = skills.find((s) => s.name === "code-quality-review")

		// when / #then
		expect(codeQualityReview).toBeDefined()
		expect(codeQualityReview!.template).toContain("Missing verification evidence")
		expect(codeQualityReview!.template).toContain("Final verdict MUST be FAIL")
	})

	test("code-quality-review template constrains blocking field consistency and security review scope", () => {
		// given
		const skills = createBuiltinSkills()
		const codeQualityReview = skills.find((s) => s.name === "code-quality-review")

		// when / #then
		expect(codeQualityReview).toBeDefined()
		expect(codeQualityReview!.template).toContain("Blocking field consistency")
		expect(codeQualityReview!.template).toContain("P0 => Blocking must be yes")
		expect(codeQualityReview!.template).toContain("P2 => Blocking must be no")
		expect(codeQualityReview!.template).toContain("Security long-tail scope boundary")
		expect(codeQualityReview!.template).toContain("changed files and directly impacted execution paths")
	})

	test("returns exactly 11 skills regardless of provider", () => {
		// given

		// when
		const defaultSkills = createBuiltinSkills()
		const agentBrowserSkills = createBuiltinSkills({ browserProvider: "agent-browser" })

		// then
		expect(defaultSkills).toHaveLength(11)
		expect(agentBrowserSkills).toHaveLength(11)
	})
})
