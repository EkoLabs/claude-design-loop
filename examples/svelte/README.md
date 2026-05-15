# Example: SvelteKit project

Drop the `.design-loop.config.ts` file in this directory at the root of your SvelteKit repo.

```bash
cp examples/svelte/.design-loop.config.ts /path/to/your-svelte-app/.design-loop.config.ts
```

Then in your SvelteKit project:

```bash
pnpm add -D github:EkoLabs/claude-design-loop playwright
pnpm exec playwright install chromium
pnpm exec design-loop login        # one-time per machine
pnpm exec design-loop systems      # discover design-system UUIDs
# Edit the config — paste the UUIDs into designSystem[].id
pnpm dev                           # in another terminal
pnpm exec design-loop              # interactive wizard
```

The wizard's route picker will list every `+page.svelte` it finds under `src/routes/`, respecting:
- SvelteKit `(group)/` folders (the group name is stripped from the route)
- `_private/` folders (skipped entirely)
- Dynamic params like `[slug]` (rendered as-is in the picker; resolve them via the "custom route" option)
