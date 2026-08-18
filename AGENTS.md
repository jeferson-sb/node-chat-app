
## Technology Stack

TBD

## Project Structutre

TBD

## Build, Lint, Format, and Test Commands

| Command | Description |
|---------|-------------|
| pnpm run build | TBD |
| pnpm run lint | TBD |
| pnpm run fmt | TBD |
| pnpm run test | TBD |

## TypeScript/JavaScript

- Prefer Type over Interface for defining types, unless you need declaration merging or to describe an object with callable properties.
- Prefer arrow functions for all function definitions, except when defining methods on classes or objects.
- Avoid using any type; use unknown if you need to represent an unknown type and want to enforce type checking when using it.
- Avoid generic types or types that are too broad (e.g. Record<string, string>)
- Break down long types with smaller ones, like splitting profile props from user to have User and UserProfile.
- If a type already exists as a named, exported type, import and reuse it instead of re-deriving it with `Parameters<typeof fn>[0]['field']`, `ReturnType<typeof fn>`, or similar utility-type gymnastics against another function/component's signature. Prefer duplicating a small inline type over deriving from an unrelated function if no shared type exists yet — but exporting and importing the real type is the preferred fix.
- Avoid multiple if clauses and nested ternaries; prefer early returns and guard clauses for better readability.
- Function parameters cannot be more than 3, and if they are, consider refactoring to use an options object or breaking the function into smaller ones.
- Avoid barrel files (index.ts) for exports, as they can lead to circular dependencies and make it harder to trace where a type or function is coming from. Instead, export types and functions directly from their respective files.

## CSS/UI styles
- Use CSS nesting whenever possible, but avoid deep nesting (more than 3 levels) to maintain readability and prevent overly specific selectors.
- Use container queries to handle responsive design on components.
- Reuse values with custom properties (CSS variables) to maintain consistency and make it easier to update styles across the app.
- Never use hardcoded colors, use tokens and preferably oklch values.
- Avoid using !important to override styles, instead use specificity and cascade layers (@layer)
- Prefer gap over margin for spacing between elements in flex and grid layouts.
- RTL/LTR Support: Always use logical properties (e.g., margin-inline-start, padding-block-end) instead of physical properties (e.g., margin-left, padding-bottom) to ensure proper support for both left-to-right and right-to-left languages.
- Prefer rem units for font sizes and spacing.
- Use the `:is()` CSS pseudo-class to group selectors that share the same styles, reducing redundancy and improving maintainability.
- Avoid animation the `all` property, instead focus on individual properties you use to animate.
- Animate performant properties like `transform` (or individual scale, rotate, translate)  and `opacity` to ensure smooth animations without causing layout thrashing or jank.
- Use the min(), max(), and clamp() CSS functions to handle adaptive designs, such as `.container` classes that need to be responsive but also have a max width.


## Code Style

- Functions should be self-explanatory and not require many comments to being with. But when necessary, use JSDoc style comments for functions, especially if they are part of a public API or have complex logic.
- Avoid vague or redundant comments that only explain what the code is doing without providing additional context or reasoning. Instead, focus on explaining why certain decisions were made or any non-obvious behavior.
- Favor use state machines rather than boolean flags for complex states either in UI, Backend, CLI, etc.

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
