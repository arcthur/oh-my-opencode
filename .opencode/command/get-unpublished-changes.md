---
description: Compare HEAD with the latest published npm version and list all unpublished changes
---

<command-instruction>
IMMEDIATELY output the analysis. NO questions. NO preamble.

## CRITICAL: DO NOT just copy commit messages!

For each commit, you MUST:
1. Read the actual diff to understand WHAT CHANGED
2. Describe the REAL change in plain language
3. Explain WHY it matters (if not obvious)

## Steps:
1. Run `git diff v{published-version}..HEAD` to see actual changes
2. Group by type (feat/fix/refactor/docs) with REAL descriptions
3. Note breaking changes if any
4. Recommend version bump (major/minor/patch)

## Output Format:
- feat: "Added X that does Y" (not just "add X feature")
- fix: "Fixed bug where X happened, now Y" (not just "fix X bug")
- refactor: "Changed X from A to B, now supports C" (not just "rename X")
</command-instruction>

<version-context>
<published-version>
!`npm view oh-my-opencode version 2>/dev/null || echo "not published"`
</published-version>
<local-version>
!`node -p "require('./package.json').version" 2>/dev/null || echo "unknown"`
</local-version>
<latest-tag>
!`git tag --sort=-v:refname | head -1 2>/dev/null || echo "no tags"`
</latest-tag>
</version-context>

<git-context>
<commits-since-release>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git log "v{}"..HEAD --oneline 2>/dev/null || echo "no commits since release"`
</commits-since-release>
<diff-stat>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git diff "v{}"..HEAD --stat 2>/dev/null || echo "no diff available"`
</diff-stat>
<files-changed-summary>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git diff "v{}"..HEAD --stat 2>/dev/null | tail -1 || echo ""`
</files-changed-summary>
</git-context>

<output-format>
## Unpublished Changes (v{published} → HEAD)

### feat
| Scope | What Changed |
|-------|--------------|
| X | 실제 변경 내용 설명 |

### fix
| Scope | What Changed |
|-------|--------------|
| X | 실제 변경 내용 설명 |

### refactor
| Scope | What Changed |
|-------|--------------|
| X | 실제 변경 내용 설명 |

### docs
| Scope | What Changed |
|-------|--------------|
| X | 실제 변경 내용 설명 |

### Breaking Changes
None 또는 목록

### Files Changed
{diff-stat}

### Suggested Version Bump
- **Recommendation**: patch|minor|major
- **Reason**: 이유
</output-format>

<advisor-safety-review>
## advisor 배포 안전성 검토 (사용자가 명시적으로 요청 시에만)

**트리거 키워드**: "배포 가능", "배포해도 될까", "안전한지", "리뷰", "검토", "advisor", "오라클"

사용자가 위 키워드 중 하나라도 포함하여 요청하면:

### 1. 사전 검증 실행
```bash
bun run typecheck
bun test
```
- 실패 시 → advisor 소환 없이 즉시 "❌ 배포 불가" 보고

### 2. advisor 소환 프롬프트

다음 정보를 수집하여 advisor에게 전달:

```
## 배포 안전성 검토 요청

### 변경사항 요약
{위에서 분석한 변경사항 테이블}

### 주요 diff (기능별로 정리)
{각 feat/fix/refactor의 핵심 코드 변경 - 전체 diff가 아닌 핵심만}

### 검증 결과
- Typecheck: ✅/❌
- Tests: {pass}/{total} (✅/❌)

### 검토 요청사항
1. **리그레션 위험**: 기존 기능에 영향을 줄 수 있는 변경이 있는가?
2. **사이드이펙트**: 예상치 못한 부작용이 발생할 수 있는 부분은?
3. **Breaking Changes**: 외부 사용자에게 영향을 주는 변경이 있는가?
4. **Edge Cases**: 놓친 엣지 케이스가 있는가?
5. **배포 권장 여부**: SAFE / CAUTION / UNSAFE

### 요청
위 변경사항을 깊이 분석하고, 배포 안전성에 대해 판단해주세요.
리스크가 있다면 구체적인 시나리오와 함께 설명해주세요.
배포 후 모니터링해야 할 키워드가 있다면 제안해주세요.
```

### 3. advisor 응답 후 출력 포맷

## 🔍 advisor 배포 안전성 검토 결과

### 판정: ✅ SAFE / ⚠️ CAUTION / ❌ UNSAFE

### 리스크 분석
| 영역 | 리스크 레벨 | 설명 |
|------|-------------|------|
| ... | 🟢/🟡/🔴 | ... |

### 권장 사항
- ...

### 배포 후 모니터링 키워드
- ...

### 결론
{advisor의 최종 판단}
</advisor-safety-review>
