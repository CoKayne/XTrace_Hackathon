# Cross-Framework Review

These files are reviewer and integration artifacts for the 20 research packs.
They are not runtime Framework Cards and must not be loaded as investment
factors.

## Files

- `cross-framework-conflict-matrix.json`: actual cross-lens tensions and the
  required disagreement-preserving resolution policy.
- `source-attribution-map.json`: corpus counts, attribution composition, rights
  blockers, and pack-level source coverage.
- `fidelity-utility-review.md`: promotion gates separating faithful
  distillation from validated decision usefulness.
- `licensed-source-gap-register.json`: machine-readable lawful-source
  acquisition backlog, the current completion interpretation, and the effect
  of reviewed user-provided excerpts.
- `licensed-source-gap-register.md`: human-readable missing-book priority list
  and safe source-handling procedure.

## Runtime rule

No row in these files is a score, voting weight, tie-breaker, or permission to
publish a Card. All 199 Cards remain `draft / unpublished`, and every Card has
formal decision weight `0`.

The 80–85% practical-v1 estimate in the source-gap register refers only to
advisory research-content readiness. It is not a runtime score, predictive
accuracy claim, publication status, or validated decision-factor ratio.

The main system should:

1. run applicable Cards independently;
2. retain each lens's evidence, judgment, counterevidence, and unknowns;
3. expose conflicts rather than average them;
4. run calculations in deterministic services;
5. apply the fund's versioned Decision Policy only after lens execution.
