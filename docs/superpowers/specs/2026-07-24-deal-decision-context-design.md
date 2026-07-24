# Deal Decision Context Completion Design

**Date:** 2026-07-24
**Scope:** Complete synthetic VC decision context for all 19 fixed-corpus Deals.

## Objective

Every Deal in the fixed MVP corpus must expose deterministic, explicitly synthetic
VC decision context. The context helps demonstrate XTrace memory, historical Deal
search, opportunity matching, and report generation without presenting invented
investment decisions as source-document facts.

The existing four fixtures remain intact except for the addition of a general
`decisionReason` field. The remaining fifteen Deals receive complete,
company-specific fixtures.

## Provenance Boundary

All decision context is synthetic Hackathon demo content and must retain:

- `provenance: "demo_fixture"`
- `label: "Synthetic VC decision record created for the hackathon demo"`

Pitch Deck evidence remains separate with `provenance: "source_document"`.
Decision context may refer to a company category or proposition supported by the
corresponding Pitch Deck evidence, but it must not invent customers, revenue,
funding, regulatory approvals, operating metrics, or external events.

## Data Contract

`DemoFixture` gains one required field:

```ts
decisionReason: string;
```

Every fixture must contain:

- `status`
- `decisionReason`
- `concerns`
- `revisitConditions`
- `meetingSummary`
- deterministic `occurredAt`
- permanent synthetic provenance and label

The shared `DealInteractionSchema` also gains `decisionReason`, so the field
survives validation, persistence, XTrace ingestion, recall, matching, and report
generation.

## Status Distribution

The existing statuses remain unchanged:

| Company | Status |
|---|---|
| 7bridges | passed |
| A-Champs | watchlist |
| Ada Health | evaluating |
| Acin | invested |

The fifteen added fixtures use the following deterministic distribution:

| Company | Status |
|---|---|
| 100Plus | evaluating |
| 1906 | passed |
| Ably | evaluating |
| Acquco | passed |
| InterTwin.ai | watchlist |
| UniKudo | screening |
| Mirror | watchlist |
| CouPro | evaluating |
| IndieShow | watchlist |
| HuMetric | evaluating |
| Alpha Builders | screening |
| INNFormNest | passed |
| SilverMemory | watchlist |
| Kanesh | evaluating |
| Fellowtrip | passed |

These statuses are synthetic workflow states, not assertions about any real
investor's relationship with the companies.

## Content Rules

Each `decisionReason` explains why the synthetic team chose its current status.
Each `concerns` entry records a Partner-level diligence question. Each
`revisitConditions` entry states a concrete evidence threshold for reopening or
advancing the review. Each `meetingSummary` briefly records the previous internal
discussion.

Content must:

- be specific to the source-supported company proposition;
- avoid unsupported claims and invented metrics;
- use concise internal-investment language;
- remain stable across application runs;
- distinguish internal judgment from external evidence.

## Presentation

Deal views expose all four context components:

- `passed`: label the rationale as **Pass reason**;
- `invested`: label it as **Investment rationale**;
- all other statuses: label it as **Decision reason**;
- always show **Partner concern**, **Revisit condition**, and
  **Previous meeting summary**.

The existing synthetic fixture label remains visible near the context.

## Data Flow

The new field and completed fixtures flow through:

1. fixed corpus fixture lookup;
2. Deal API and demo view model;
3. Deals UI;
4. Chat and Search context;
5. matching context and Claude reasoning input;
6. XTrace ingestion and recalled memory;
7. opportunity report previous-context rendering.

No runtime model call generates or rewrites the fixture content.

## Error Handling

- Corpus validation fails if any of the 19 Deals lacks a fixture.
- Fixture validation fails if `decisionReason` or any other required context is
  empty.
- Import continues to require source-document evidence for every fixture.
- Missing context must never silently fall back to generic generated text.

## Verification

Tests must establish:

- exactly 19 fixtures exist;
- fixture Deal IDs are unique and cover all 19 manifest Deals;
- every fixture has a non-empty `decisionReason`, concern, revisit condition,
  and meeting summary;
- every fixture retains the permanent synthetic provenance label;
- every fixture maps to page-backed Pitch Deck evidence;
- Deal API, search, chat, matching context, and XTrace serialization include
  `decisionReason`;
- the Deals UI renders the four context components and the status-sensitive
  rationale label.

## Out of Scope

The mixed market-source strategy is a separate subsystem. It will use official
APIs/RSS automatically, conditional metadata-only adapters where permitted,
permission-gated VC sources, and no direct crawling for explicitly prohibited
sources. It is not implemented as part of this fixture-completion change.
