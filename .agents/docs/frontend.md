# Frontend patterns

- Wrap frontend files in an IIFE: `(function () { ... })();`.
- Query the DOM after page load, inside `init()`.
- Use DOM element type assertions, such as `as HTMLButtonElement`.
- Type event listener parameters, such as `(e: Event) =>`.
- Handle failures with try/catch and log frontend errors with context using `console.error`.

For server-side logging, follow [API guidance](api-and-security.md) instead.
