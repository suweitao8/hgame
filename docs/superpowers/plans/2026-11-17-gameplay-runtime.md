# Gameplay runtime implementation plan

The user requested direct engine capability improvements, with no tests or verification in this iteration. That instruction overrides the normal testing, review and verification gates. Implement inline on main and preserve unrelated changes.

## Design

Add renderer-neutral, opt-in gameplay modules rather than game-specific combat rules. Reuse hierarchical gameplay tags and the existing Component/fixedUpdate scheduler. Definitions are ordinary objects/JSON; callbacks belong to the game. No timers, DOM, physics backend changes, editors or dependencies.

## Deliverables

- Attribute sets: named base values, dynamic bounds, flat/percentage/multiplicative modifiers, effective-value changes and atomic resource spending.
- Status effects: instant changes, timed/permanent modifiers, tags, stack/refresh/replace/independent policies, periodic changes, removal and save snapshots.
- Abilities: resource costs, cooldowns, rechargeable charges, tag gates, casting, channeling, cancellation, input buffering and cooldown snapshots.
- A composed actor and GameplayComponent with a single fixedUpdate entry and owned-resource disposal.
- Public exports, packager discovery, API capability map, declarations and usage guide.

## Execution

1. Implement the runtime modules and entity integration.
2. Add public entry points and declarative usage examples.
3. Generate declaration/API artifacts (generation only; no check mode).
4. Commit and push this feature stage without running tests, browsers, benchmarks or verification commands.

The implementation choices above are the agent's choices under the user's instruction to proceed directly. They are not a claim that the resulting engine has been verified or objectively scores 10/10.
