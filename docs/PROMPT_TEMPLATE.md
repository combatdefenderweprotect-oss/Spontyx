# Spontix Prompt Template

A reusable instruction set for working on Spontix tasks. Reference this file at the top of every task instead of repeating the rules.

---

## 1. Context Usage Rule

- Do NOT load the full `CLAUDE.md` into context.
- Use `CLAUDE.md` ONLY as a navigation index.
- Load ONLY the docs relevant to the current task's domain.
- Do NOT mix unrelated domains.
- Prefer reading the smallest section that answers the question.

---

## 2. Domain Quick Map

| Domain | Doc |
|---|---|
| League logic / creation | [docs/LEAGUE_CREATION_FLOW.md](LEAGUE_CREATION_FLOW.md) |
| League scoring | [docs/LEAGUE_SCORING_V2.md](LEAGUE_SCORING_V2.md) |
| Arena | [docs/ARENA_SESSION_SYSTEM.md](ARENA_SESSION_SYSTEM.md) |
| Battle Royale | [docs/BR_SESSION_SYSTEM.md](BR_SESSION_SYSTEM.md) |
| Question system (lanes) | [docs/QUESTION_SYSTEM.md](QUESTION_SYSTEM.md) |
| Live questions | [docs/LIVE_QUESTION_SYSTEM.md](LIVE_QUESTION_SYSTEM.md) |
| Real-world questions | [docs/REAL_WORLD_QUESTION_SYSTEM.md](REAL_WORLD_QUESTION_SYSTEM.md) |
| Leaderboards | [docs/LEADERBOARD_ARCHITECTURE.md](LEADERBOARD_ARCHITECTURE.md) |
| Tiers / monetization | [docs/TIER_ARCHITECTURE.md](TIER_ARCHITECTURE.md) |
| Cross-cutting gameplay | [docs/GAMEPLAY_ARCHITECTURE.md](GAMEPLAY_ARCHITECTURE.md) |
| Game architecture map | [docs/GAME_ARCHITECTURE_MAP.md](GAME_ARCHITECTURE_MAP.md) |
| Recent changes | [docs/CHANGELOG_RECENT.md](CHANGELOG_RECENT.md) |
| Older history | [docs/CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md) |

---

## 3. Working Principles

- Do NOT break existing systems.
- Documentation is the source of truth — do not invent logic.
- Keep solutions simple — no premature abstraction.
- Avoid mixing systems (don't pull BR docs into a league task).
- Respect protected systems listed in `CLAUDE.md`.
- Never silently change product behaviour.

---

## 4. Task Structure

For every task, follow this flow:

1. **Identify the domain** — pick the single primary system involved.
2. **List relevant docs** — usually 1, rarely more than 2.
3. **Confirm understanding** — restate the goal in one sentence.
4. **Propose a plan** — short, ordered steps.
5. **Wait for approval if non-trivial** — for larger or risky changes.
6. **Implement** — keep edits scoped, follow doc conventions.
7. **Report results** — what changed, where, and any follow-ups.

---

## 5. Response Style

- Be structured (headings, lists, tables when useful).
- Be concise — no filler, no recap of full docs.
- Stay within the relevant domain.
- Quote only the specific rule or section you're applying.
- End with a one-line summary of the change.

---

## Example Usage

```
Refer to docs/PROMPT_TEMPLATE.md

TASK:
[write task here]
```

Or with explicit doc hints:

```
Refer to docs/PROMPT_TEMPLATE.md

Relevant docs:
- docs/LEAGUE_SCORING_V2.md

TASK:
Add a fourth confidence tier to League scoring V2.

Constraints:
- Do not touch Arena or BR scoring.
- Migration must be additive.
```

---

## Task Type (optional)

You can specify task type to improve response quality:

- **backend** → focus on logic, DB, edge functions
- **UI** → focus on layout, UX, components
- **scoring** → focus on game mechanics, balance, formulas
- **debugging** → focus on finding and fixing issues
- **architecture** → focus on system design

When task type is provided:
- adjust depth and reasoning accordingly
- avoid unnecessary explanations outside that domain

---

## Execution Mode (optional)

You can specify execution mode:

- **plan** → only analyze and propose solution, do NOT implement
- **implement** → proceed with implementation immediately
- **review** → analyze existing code and identify issues
- **refactor** → improve structure without changing behaviour

Rules:

- If mode is "plan":
  - do NOT write code
  - focus on reasoning and structure

- If mode is "implement":
  - follow Task Structure strictly
  - keep changes minimal and safe

- If mode is "review":
  - identify bugs, risks, inconsistencies
  - do NOT modify code

- If mode is "refactor":
  - improve clarity and structure
  - do NOT change logic or behaviour
