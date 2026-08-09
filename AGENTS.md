
## Technology Stack

TBD

## Project Structutre

TBD

## Build, Lint, Format, and Test Commands

TBD

## TypeScript/JavaScript

- Prefer Type over Interface for defining types, unless you need declaration merging or to describe an object with callable properties.
- Prefer arrow functions for all function definitions, except when defining methods on classes or objects.
- Avoid using any type; use unknown if you need to represent an unknown type and want to enforce type checking when using it.
- Avoid generic types or types that are too broad (e.g. Record<string, string>)
- Break down long types with smaller ones, like splitting profile props from user to have User and UserProfile.
- If a type already exists as a named, exported type, import and reuse it instead of re-deriving it with `Parameters<typeof fn>[0]['field']`, `ReturnType<typeof fn>`, or similar utility-type gymnastics against another function/component's signature. Prefer duplicating a small inline type over deriving from an unrelated function if no shared type exists yet — but exporting and importing the real type is the preferred fix.
- Avoid multiple if clauses and nested ternaries; prefer early returns and guard clauses for better readability.
- Function parameters cannot be more than 3, and if they are, consider refactoring to use an options object or breaking the function into smaller ones.

## Code Style

- Functions should be self-explanatory and not require many comments to being with. But when necessary, use JSDoc style comments for functions, especially if they are part of a public API or have complex logic.
- Avoid vague or redundant comments that only explain what the code is doing without providing additional context or reasoning. Instead, focus on explaining why certain decisions were made or any non-obvious behavior.

## Architecture

- Record designs made in ADR (Architecture Decision Records) to document the reasoning behind architectural decisions, trade-offs considered, and alternatives evaluated. The ADR file should contain a timestamp and a name and use the standard format.

## Component creation

- Extract complex conditional rendering into separate components, unless the conditions are very simple and unlikely to change.
- Avoid passing props through multiple components as much as possible and try to handle events earlier in your component tree. A component that tries to handle too many props might have too much responsibility in its own scope.
- Start small. By breaking down components in a modular way, we can effectively decouple their logic and isolate them from the rest of the user interface.
- In order to approach composability, we can take advantage of any of the patterns we’ve seen in this series: Compound components, Uncontrolled components, Render props, Slots or Dynamic components.
- Use custom hooks to encapsulate logic that is shared across multiple components. This promotes reusability and keeps components focused on their primary responsibilities. A custom hooks focus on exposing actions and state that are relevant to the hook use case. A custom hook should not be too generic as well.

## DON'Ts

- Don't skip tests
- Don't refactor code unrelated to your change
- Don't add dependencies without justification between you and the author/dev
