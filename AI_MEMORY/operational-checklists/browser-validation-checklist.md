# Browser Validation Checklist

- Use `tests/helpers/playwrightAuth.js`.
- Login as documented QA/system user.
- Select explicit tenant, usually `system`.
- Navigate requested route and canonical aliases.
- Wait for DOM and network settling.
- Capture final URL/path, title, headings, auth state, console errors and failed network requests.
- Validate menus/sidebar and route permissions.
- Record screenshots/traces only outside `dist/`.
- Document aliases, redirects, legacy routes and gaps in `AI_MEMORY/runtime-navigation.md`.

