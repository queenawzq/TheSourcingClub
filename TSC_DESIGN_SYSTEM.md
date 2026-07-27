# The Sourcing Club Design System v2

This guide is the enforceable source of truth for TSC product screens: factory search, brand RFQs, quote comparison, quote details, contract terms, funding, active RFQs, and project workspaces.

Use this before designing or developing any new TSC screen. If an existing screen conflicts with these rules, update the screen in a controlled cleanup pass instead of inventing a local exception.

## Operating Rules

- Product font: Satoshi.
- Do not introduce a second product font.
- Build with shared components first: Button, Pill, Card, FilterPanel, TipPanel, ProgressStepper, Upload, BottomActionBar, MetricRow.
- Repeated elements must keep the same size and placement across screens in the same flow.
- If a component type does not have a rule here, add the rule before adding the new pattern.
- Quote pages must only show information from the brand RFQ, factory quote input, selected quote, contract specifics, or payment calculation.

## Color Tokens

```ts
export const colors = {
  primary: "#1A4DF2",
  primaryHover: "#123FD6",
  bgPage: "#F8FAFC",
  surface: "#FFFFFF",
  tagFill: "#ECF1F6",
  border: "#D7E0EA",
  borderStrong: "#CAD5E2",
  softBlueFill: "#EAF4FF",
  softBlueStroke: "#8DB7FF",
  text: "#0B1020",
  textMuted: "#5A6B87",
};
```

Primary blue is for primary CTAs, selected checkbox/radio controls, active navigation, and current step states. Do not use it as decoration. Selected filter chips use the soft selected pill state, not a solid blue fill.

## Signal Colors

Fit percentage and fit labels use the same tier logic:

```ts
export const fitTiers = {
  strong: { range: "90-100%", fill: "#EAF4FF", stroke: "#8DB7FF", text: "#1A4DF2" },
  good: { range: "75-89%", fill: "#EAFBFF", stroke: "#9DDCE9", text: "#087E96" },
  potential: { range: "60-74%", fill: "#FFF7E8", stroke: "#F2B253", text: "#A76500" },
  tradeoff: { fill: "#FFF1EA", stroke: "#F2A48A", text: "#B33416" },
  notFit: { range: "Below 60%", fill: "#F3F4F8", stroke: "#D7E0EA", text: "#5A6B87" },
};
```

Trust labels:

```ts
export const trustTiers = {
  trusted: { fill: "#EAF4FF", stroke: "#8DB7FF", text: "#1A4DF2" },
  verified: { fill: "#EAFBFF", stroke: "#9DDCE9", text: "#087E96" },
  basic: { fill: "#F1F4F8", stroke: "#CAD5E2", text: "#5A6B87" },
};
```

## Typography

Typography is role-based. Do not choose a size by eye. Pick the role that matches the content.

Use Satoshi for every product screen. Letter spacing is always `0%`. Do not use viewport-scaled type or negative letter spacing.

```ts
export const typography = {
  heading1: { size: 44, lineHeight: 48, weight: "Black" },
  heading2: { size: 38, lineHeight: 44, weight: "Black" },
  heading3: { size: 22, lineHeight: 28, weight: "Bold" },
  heading4: { size: 20, lineHeight: 26, weight: "Bold" },
  heading5: { size: 17, lineHeight: 22, weight: "Bold" },

  subheading1: { size: 17, lineHeight: 24, weight: "Medium" },
  subheading2: { size: 13, lineHeight: 18, weight: "Bold" },
  subheading4: { size: 13, lineHeight: 18, weight: "Bold" },
  textInstruction: { size: 14, lineHeight: 20, weight: "Medium" },

  bigNumberColor: { size: 20, lineHeight: 24, weight: "Bold" },
  bigNumberBlack: { size: 20, lineHeight: 24, weight: "Bold" },
  value1: { size: 17, lineHeight: 22, weight: "Bold" },
  value2: { size: 14, lineHeight: 20, weight: "Bold" },
  value3: { size: 12, lineHeight: 16, weight: "Bold" },

  body1: { size: 14, lineHeight: 20, weight: "Medium" },
  body2: { size: 13, lineHeight: 18, weight: "Medium" },
  label1: { size: 12, lineHeight: 16, weight: "Bold" },
  label2: { size: 11, lineHeight: 14, weight: "Medium" },

  textButton: { size: 14, lineHeight: 18, weight: "Medium" },
  buttonText: { size: 12, lineHeight: 16, weight: "Bold" },
};
```

### Type Role Usage

| Role | Size / weight | Use for | Example |
|---|---:|---|---|
| `heading1` | 44 Black | Directory and marketplace page titles only | `SEARCH VETTED FACTORIES` |
| `heading2` | 38 Black | RFQ flow page titles and major workspace titles | `Describe what you need made.` |
| `heading3` | 22 Bold | Primary card title, factory/project names in large cards | `Atelier Minho` |
| `heading4` | 20 Bold | Summary card titles and list-count headings | `24 open requests` |
| `heading5` | 17 Bold | Right-rail panel titles and subsection titles | `Activity on this request` |
| `subheading1` | 17 Medium | Hero support copy under a page title | `Start with a rough product brief...` |
| `subheading2` | 13 Bold | Location and small linked metadata under titles | `Porto, Portugal` |
| `textInstruction` | 14 Medium | Instruction copy, helper paragraphs, form guidance | `Break out sample stages...` |
| `subheading4` | 13 Bold | Uppercase eyebrow labels | `FACTORY QUOTE REQUEST` |
| `bigNumberColor` | 20 Bold | Colored match, quote total, or active metric values | `92%`, `$5,780` |
| `bigNumberBlack` | 20 Bold | Black score/metric values | `4.9` |
| `value1` | 17 Bold | Prominent range or list metric values | `$18-$24` |
| `value2` | 14 Bold | Secondary metric values | `300 units` |
| `value3` | 12 Bold | Compact yes/no or table values | `Yes` |
| `body1` | 14 Medium | Main descriptive text and text inputs | Brand/project description |
| `body2` | 13 Medium | Compact body copy inside cards and insight panels | Factory insight bullets |
| `label1` | 12 Bold | Field labels above or beside values | `Target unit price` |
| `label2` | 11 Medium | Labels under metric values | `match` |
| `textButton` | 14 Medium | Text-only links or quiet text actions | `Swim & activewear` |
| `buttonText` | 12 Bold | Text inside pills, filter chips, and small buttons | `GOTS` |

### Type Enforcement

- Use `heading1` only for marketing-sized directory titles. Do not use it inside cards, sidebars, or modal content.
- Use `heading2` for RFQ step titles, review pages, quote submission pages, and workspace detail pages.
- Use `heading3` for the main title inside a result card or detail card.
- Use `heading4` for result summary cards, not individual row titles.
- Use `heading5` for right-rail cards, tips, checklists, and smaller section headings.
- Use `body1` for editable or user-authored text. Use `body2` when text lives inside a compact card, note, insight, or status panel.
- Metric labels under large values always use `label2`.
- Field labels always use `label1`.
- Pill, tag, small-chip, and filter-button text always uses `buttonText`.

## Spacing

```ts
export const spacing = [4, 8, 12, 16, 20, 24, 32, 40, 56];
```

- Page nav to hero: 56px.
- Hero to main content: 32px.
- Main column gap: 24px.
- Card padding: 24px desktop.
- Compact card/list row padding: 20px vertical, 24px horizontal.
- Card internal rhythm: name to metadata 4px, metadata to description 12px, description to tags 12px, tag gap 8px, tags to note 16px.
- Filter panel padding: 24px.
- Filter section gap: 32px.
- Filter section title to controls: 14px.
- Tip panel padding: 24px.
- Tip title to body: 16px.
- Bottom action bar height: 76px.

## Component Specs

### Button

- Height: 42px.
- Radius: 21px.
- Primary/secondary CTA text: 14px / 18px / Bold.
- Primary: `#1A4DF2` fill, white text.
- Secondary: white fill, `#CAD5E2` stroke, primary text.
- Text is always vertically and horizontally centered.

### Pill / Tag / Filter Chip

- Height: 28px.
- Radius: 5px.
- Text: `buttonText` = 12px / 16px / Bold.
- Neutral: `#ECF1F6` fill, `#D7E0EA` stroke, `#0B1020` text.
- Selected filter: `#EAF4FF` fill, `#8DB7FF` stroke, `#1A4DF2` text.
- Soft active/capacity: `#EAF4FF` fill, `#8DB7FF` stroke, `#1A4DF2` text.
- Do not use solid primary-blue fill for selected filters. Solid primary-blue is reserved for CTAs and selected checkbox/radio/current-step controls.

### Card

- Radius: 8px.
- Default fill: white.
- Default stroke: `#D7E0EA`.
- Selected stroke: `#8DB7FF`.
- Selected fill may use `#F9FBFF` only when the selected state needs a full-row highlight.
- Card titles use `heading3`.
- Card descriptions use `body1`.
- Compact notes or insights inside cards use `body2`.

### Inputs And Selects

- Height: 42px minimum.
- Radius: 8px.
- Fill: white.
- Stroke: `#CAD5E2`.
- Placeholder: `#5A6B87`.
- Input text uses `body1`.
- Input labels use `label1`.

### Upload

- Fill: `#F8FAFC`.
- Stroke: `#CAD5E2`, dashed.
- Radius: 8px.
- Full width when it is the only attachment action in a section.
- Individual uploaded files are shown as removable file pills or file rows.

### Progress Stepper

- Use one vertical 8-step progress rail in RFQ-to-contract flows.
- Completed step: white circle, blue checkmark, blue line.
- Current step: blue circle, white number.
- Upcoming step: pale neutral circle.

### Bottom Action Bar

- Height: 76px.
- Fill: white.
- Top border: `#D7E0EA`.
- Back button appears at the same left x-position across the flow.
- Primary CTA is right aligned.

### Metric Group

- Main metric values use `bigNumberColor` or `bigNumberBlack`.
- Secondary metric values use `value1` or `value2` depending on emphasis.
- Labels under metrics use `label2`.
- Do not mix 18px and 20px metrics in the same group.

## Screen Contracts

### Directory / Browse Pages

- Left filter panel width: 280px.
- Main content starts aligned with the filter panel top after the hero.
- Search width: 620-720px.
- Result summary card sits above result cards.
- Factory cards use square factory logos, never circular profile images.

### RFQ Creation

- Left side: vertical 8-step progress.
- Main area: form/review content.
- Right rail: tips/checklists with consistent 24px padding.
- Bottom action bar appears on every step.

### Quote Comparison

Prioritize:

- Unit price
- Exact quantity
- Bulk lead time
- Sample plan
- Capacity window
- Factory notes
- Open questions or caveats

Do not use MOQ or rating as the primary quote comparison metric.

### Quote Detail

All detail must trace to one of:

- Brand RFQ
- Factory quote input
- Selected quote
- Contract specifics

Do not show unexplained generated text like "Included" or "Clarify" unless it is renamed to its real source, such as "Notes from factory."

### Contract Terms

Use one editable `Contract specifics` field. It should summarize:

- Scope
- Sample path
- Color and quantity
- QC and delivery expectations
- Any agreed exceptions

### Project Workspace

- Header metrics row.
- Tabs: Overview, Messages, Files, Contract details.
- Timeline updates appear inline with date/time and attachments.
- Factory update action appears on the active milestone.

## LLM Enforcement Checklist

Before making or accepting a screen change:

1. Identify the screen family.
2. Identify every repeated component on the screen.
3. Apply the matching component spec.
4. Check type sizes against the typography scale.
5. Check dimensions: 42px buttons, 28px pills, 76px bottom bar, 8px cards.
6. Check color meaning: primary blue for actions and selected checkbox/radio controls, soft blue for selected filters, signal colors for fit/risk, trust colors for trust labels.
7. Check placement: same kind of element in the same flow should sit in the same position.
8. Check data provenance: remove unexplained text that does not come from RFQ, quote, contract, or payment data.
9. List any intentional exception in the handoff.
