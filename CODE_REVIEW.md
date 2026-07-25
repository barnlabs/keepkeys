# KeepKeys code review

Every GitHub-bound change receives an independent, read-only review of the exact
diff after implementation tests pass. A local Codex review and GitHub Codex
review are complementary; neither replaces CI, threat modeling, or maintainer
judgment.

## Reviewer contract

The reviewer must not author the change being judged. Review the base/head diff,
the applicable `AGENTS.md`, changed tests, generated packages, threat model,
public install/update pins, and CI evidence.

Prioritize:

1. plaintext disclosure or unintended retrieval paths;
2. authorization timing and approval-content defects;
3. command construction, executable substitution, inherited-environment, and
   output-exfiltration regressions;
4. native-vault lifecycle, replacement rollback, deletion, and fail-closed
   behavior;
5. host-contract, package, version, source-fingerprint, and immutable-pin drift;
6. missing positive, negative, regression, or cleanup proof.

Do not spend review attention on style unless it hides one of those failures.

## Verdicts

- **PASS:** every required artifact exists; checks and public CI are green; no
  unresolved P0/P1 finding; claims match proof; remaining risk is explicit.
- **REWORK:** a repairable requirement or regression is missing. Return each
  finding with severity, confidence, file/component, preconditions, impact,
  evidence, reproduction or reasoning, smallest fix, and required retest.
- **BLOCKED:** external authority or state prevents verification. Name only the
  exact missing action and preserve the evidence already gathered.

After **REWORK**, the original implementer repairs the focused findings and
reruns the relevant checks. The same reviewer reopens the new diff and returns a
fresh verdict. Default to two repair cycles; do not loop without a bounded new
hypothesis.

## GitHub Codex review

When Codex code review is enabled for the repository, request a review with
`@codex review` or use verified automatic reviews. Keep the root
`AGENTS.md` rules concise because Codex applies them directly. Treat GitHub
Codex comments as high-priority review input, not approvals or merge
authorization. Address or explicitly disposition each serious finding, rerun
the affected tests, and obtain a final independent PASS.
