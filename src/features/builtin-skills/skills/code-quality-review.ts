import type { BuiltinSkill } from "../types"
import { codeQualityReviewTemplate } from "./code-quality-review.template"

export const codeQualityReviewSkill: BuiltinSkill = {
  name: "code-quality-review",
  description:
    "Post-implementation code quality review. Use after spec compliance passes to check type-safety, error handling, tests, maintainability, and risk. Produces prioritized findings with file:line evidence and a merge-readiness verdict. Triggers: code review, quality gate, refactor suggestions, harden, cleanup.",
  template: codeQualityReviewTemplate,
}
