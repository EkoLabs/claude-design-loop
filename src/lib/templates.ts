/**
 * Brief template — short, design-focused. The whole point of this loop is
 * Claude Design *designing* something in the canvas, not producing a
 * markdown report. The brief gives Claude:
 *
 *   - The screenshots of the current state (attached separately).
 *   - A 1-line description of what the page does.
 *   - Permission to redesign, not just re-render.
 *   - Tech constraints so the eventual handoff lands cleanly when we
 *     translate to framework-native scaffolds.
 *
 * Anything Claude wants to add (recommendations, alternatives, rationale)
 * is welcome but not demanded — the canvas is the deliverable.
 */

export interface TemplateInputs {
  framework: string;
  route: string;
  pageTitle: string;
  designSystemName: string;
  /** Optional human-supplied intent. e.g. "make this faster to scan". */
  intent?: string;
  breakpoints: number[];
}

export function renderBrief(inputs: TemplateInputs): string {
  const parts = [
    renderHeader(inputs),
    renderBody(inputs),
    renderTechConstraints(inputs),
    renderHandoffNote(),
  ];
  return parts.join('\n\n');
}

function renderHeader(i: TemplateInputs): string {
  return [
    `# Redesign brief — ${i.route}`,
    '',
    `**Page:** ${i.pageTitle || '(no title)'}`,
    `**Route:** \`${i.route}\` in our ${i.framework} app`,
    `**Design system:** ${i.designSystemName}`,
    `**Captured at:** ${i.breakpoints.join('px, ')}px`,
  ].join('\n');
}

function renderBody(i: TemplateInputs): string {
  const intentLine = i.intent
    ? `\n\n**Specific intent for this round:** ${i.intent}`
    : '';
  return `
## What we're showing you

The attached screenshots are the **current state** of this screen at the
listed breakpoints. They are not a wireframe to redraw 1:1 — treat them as
the starting point. Understand what the screen is trying to do, then design
a better version.${intentLine}

## What we want

Look at the screenshots. Decide what's working, what isn't, and **redesign
this screen** in the canvas using the **${i.designSystemName}**. You're
free to:

- Suggest UX improvements, not just visual polish.
- Restructure the page if hierarchy or grouping is wrong.
- Drop or merge sections that don't earn their space.
- Add affordances (CTAs, filters, status, empty states) the current screen lacks.
- Disagree with the existing design where you think you know better — explain
  briefly in chat why, then design accordingly.

You're a design partner here, not a render farm. If you have a strong opinion
about the page's purpose or audience, factor it in.
`.trim();
}

function renderTechConstraints(i: TemplateInputs): string {
  return `
## Tech constraints (so the design lands cleanly when we implement)

- **Framework:** ${i.framework}. Don't propose patterns from a different one.
- **Styling:** Tailwind 4 utility classes — no CSS-in-JS solutions.
- **Icons:** \`lucide-svelte\` (don't introduce a new icon set).
- **Components:** real **${i.designSystemName}** components and tokens.
- **Out of scope:** any route the team has marked as excluded (e.g. one-off
  motion / 3D experiences). Stick to the screen shown in the screenshots.
`.trim();
}

function renderHandoffNote(): string {
  return `
## After you're done

Leave the result in the canvas. We'll review and iterate with you in
claude.ai/design directly. When we're happy, we'll click **Share → Handoff
to Claude Code** to bring the design into our repo.
`.trim();
}
