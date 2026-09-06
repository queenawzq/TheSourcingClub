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

## Consistency Reference

Use this section before changing repeated dashboard cards, list cards, tabs, or compact action controls. If a screen needs a different value, update this reference first and then apply the change everywhere the same component pattern appears.

### Shared CSS Tokens

These token names exist in the prototype stylesheets and should be used instead of local magic numbers:

| Token | Value | Use |
|---|---:|---|
| `--card-radius` | `8px` | Standard card and list-row radius |
| `--card-padding` | `24px` | Default full card padding |
| `--card-row-padding` | `20px 24px` | Standard compact list row padding |
| `--card-compact-padding` | `16px` | Dense dashboard production cards |
| `--card-mobile-padding` | `12px 14px 13px` | Production/RFQ dashboard cards below compact breakpoints |
| `--card-section-gap` | `16px` | Gap between major card regions |
| `--card-row-gap` | `10px` | Gap between compact card internals, actions, and metric cells |
| `--card-column-gap` | `26px` | Desktop gap between left content and right action/progress column |
| `--card-title-media` | `46px` | Thumbnail/avatar size in compact production/RFQ cards |
| `--card-title-gap` | `12px` | Thumbnail to title text gap |
| `--card-title-size` | `15px` | Compact card title size |
| `--card-title-line` | `19px` | Compact card title line height |
| `--card-subtitle-offset` | `3px` | Title to subtitle vertical offset |
| `--card-subtitle-size` | `12px` | Compact subtitle/meta/body size |
| `--card-subtitle-line` | `17px` | Compact subtitle/meta/body line height |
| `--card-metric-padding` | `8px 10px` | Compact metric cell padding |
| `--card-metric-min-height` | `48px` | Compact metric cell minimum height |
| `--card-metric-label-size` | `10px` | Compact metric label size |
| `--card-metric-label-line` | `14px` | Compact metric label line height |
| `--card-metric-value-size` | `14px` | Compact metric value size |
| `--card-metric-value-line` | `19px` | Compact metric value line height |
| `--production-card-detail-row-height` | `56px` | Shared metric/progress row height inside mirrored production cards |
| `--production-card-progress-bottom-clearance` | `0px` | Extra progress-block bottom padding inside mirrored production cards |
| `--button-height` | `34px` | Default primary/secondary button height |
| `--button-radius` | `34px` | Default primary/secondary button radius |
| `--button-padding` | `0 14px` | Default primary/secondary button horizontal padding |
| `--button-font-size` | `12px` | Default primary/secondary button text size |
| `--button-line` | `18px` | Default primary/secondary CTA line height |
| `--bottom-nav-button-height` | `38px` | RFQ bottom navigation button height |
| `--bottom-nav-button-padding` | `0 22px` | RFQ bottom navigation button horizontal padding |
| `--bottom-nav-button-font-size` | `13px` | RFQ bottom navigation button text size |
| `--bottom-nav-button-line` | `18px` | RFQ bottom navigation button line height |
| `--pill-height` | `28px` | Default pill/tag/filter chip height |
| `--pill-radius` | `5px` | Default pill/tag/filter chip radius |
| `--pill-padding` | `0 10px` | Default pill/tag/filter chip padding |
| `--pill-font-size` | `12px` | Default pill/tag/filter chip text size |
| `--pill-line` | `16px` | Default pill/tag/filter chip line height |
| `--compact-control-height` | `34px` | Small dashboard CTA height |
| `--compact-control-padding` | `0 14px` | Small dashboard CTA horizontal padding |
| `--compact-control-font-size` | `12px` | Small dashboard CTA text size |
| `--brand-action-height` | `34px` | Brand-side compact page, header, and card action buttons |
| `--brand-action-padding` | `0 14px` | Brand-side compact action horizontal padding |
| `--brand-action-font-size` | `12px` | Brand-side compact action text size |
| `--brand-action-line` | `18px` | Brand-side compact action line height |
| `--dashboard-action-height` | `34px` | Dashboard side-card and attention-card action buttons |
| `--dashboard-action-padding` | `0 14px` | Dashboard action horizontal padding |
| `--dashboard-action-font-size` | `12px` | Dashboard action text size |
| `--dashboard-action-line` | `18px` | Dashboard action line height |
| `--status-pill-height` | `26px` | Compact status/match pill height |
| `--status-pill-padding` | `0 10px` | Compact status/match pill padding |
| `--status-pill-radius` | `5px` | Compact status/match pill radius |
| `--status-pill-font-size` | `11px` | Compact status/match pill text size |
| `--status-pill-line` | `24px` | Compact status/match pill line height |
| `--pill-tab-gap` | `32px` | Gap between simple underline tabs |
| `--pill-tab-cluster-gap` | `24px` | Gap inside scrollable tab groups with add/manage actions |
| `--pill-tab-offset-before` | `-8px` | Standard vertical position above pill/underline tabs |
| `--pill-tab-offset-after` | `0` | Standard spacing below pill/underline tabs |
| `--pill-tab-height` | `30px` | Underline tab control height |
| `--pill-tab-padding` | `0 0 6px` | Underline tab bottom padding |
| `--pill-tab-font-size` | `14px` | Underline tab text size |
| `--nav-expanded-width` | `276px` | Expanded side navigation width used in page width calculations |
| `--nav-expanded-page-offset` | `276px` | Standard expanded-sidebar page left offset |
| `--nav-collapsed-page-offset` | `78px` | Standard collapsed-sidebar page left offset |
| `--page-max-width` | `none` | Override max width for app pages that should fill available space |
| `--page-padding-inline` | `28px` | Standard left/right page padding beside side navigation |
| `--page-padding-inline-mobile` | `16px` | Mobile left/right page padding beside side navigation |
| `--page-top-standard` | `72px` | Standard top padding for dashboards, RFQs, project/detail pages |
| `--page-top-compact` | `36px` | Compact top padding for dense workspace pages such as messages/settings |
| `--page-top-directory` | `32px` | Directory/search page top padding |
| `--page-shell-max` | `1048px` | Standard shell width for dashboard/RFQ content |
| `--page-shell-gap` | `26px` | Gap between major shell sections or dashboard columns |
| `--page-grid-gap` | `24px` | Standard page grid gap |
| `--page-controls-gap` | `24px` | Desktop gap between search/filter/sort controls |
| `--page-controls-responsive-gap` | `18px 14px` | Responsive search/filter/sort control gap |
| `--responsive-card-top-gap` | `14px` | Gap after card headers collapse to one column |
| `--responsive-card-action-gap` | `18px` | Gap between title and action groups before full mobile collapse |
| `--responsive-media-max` | `420px` | Maximum media preview width after card body collapse |

### Card Alignment Contract

- Card padding must come from `--card-padding`, `--card-row-padding`, `--card-compact-padding`, or `--card-mobile-padding`.
- Cards with the same density must use the same internal left edge for title, subtitle, metrics, and actions.
- Compact production cards use two desktop columns: left content `minmax(420px, 1fr)` and right progress/actions `minmax(360px, 500px)`.
- Compact production cards use `--card-row-gap` vertically and `--card-column-gap` horizontally.
- Compact production card titles sit in row 1, column 1. Actions sit in row 1, column 2. Metrics sit in row 2, column 1. Progress sits in row 2, column 2.
- Compact production cards must set the same desktop grid rows on both brand and factory sides: row 1 equals `--card-title-media`; row 2 equals `--production-card-detail-row-height`.
- The bottom clearance of mirrored production cards is measured from the lowest rendered child, not just from the card's declared padding. Metric cells and progress steppers must both fit within `--production-card-detail-row-height`.
- Mirrored production-card progress steppers must use the same labels for the same state. For the second step, use `Fit sample`, not a side-specific synonym.
- Below the compact breakpoint, the title remains row 1 column 1, the primary action moves to row 1 column 2, the status pill moves to row 2 column 1, metrics span row 3, and progress fills row 4.
- Title thumbnails are always `--card-title-media` square. Do not make brand/factory thumbnails different sizes in matching dashboard cards.
- Compact title text uses `--card-title-size` / `--card-title-line`; compact subtitles and metadata use `--card-subtitle-size` / `--card-subtitle-line`.
- The subtitle starts `--card-subtitle-offset` below the title. Do not use one-off `translateY()` nudges for matching title stacks.
- Compact metric cells use `--card-metric-min-height` and `--card-metric-padding`; matching metric labels and values use the metric tokens.
- Brand profile asset cards use the same responsive image-card settings as factory profile sample cards: images sit next to each other in a three-column grid at larger breakpoints, then stack to one column at the small mobile breakpoint.

### Page Spacing Contract

- Product pages with side navigation use the same left offset model: expanded pages use `--nav-expanded-page-offset`; collapsed pages use `--nav-collapsed-page-offset`.
- Dashboard/profile pages that intentionally breathe away from the nav add `40px` to the sidebar offset with `calc(...)`; do not replace this with a new literal offset.
- Brand and factory profile pages must share the same `factory-profile-page` outer shell, offset, top padding, and `factory-profile-shell` max width. Do not render one side inside the generic dashboard/home page wrapper.
- Brand and factory profile pages must keep the same responsive profile contract: owner toggle position, hero identity collapse, overview/detail grids, section headers, image-card grids, side cards, and history cards use the same breakpoints and layout rules. Brand-specific profile selectors may change copy/data only; they must not introduce one-off spacing, width, or stacking behavior unless the factory side gets the matching rule too.
- Profile value sections stay horizontal until the small mobile breakpoint, then stack together on both sides. Do not let brand-only metric overrides force earlier stacking.
- Standard product pages use `--page-padding-inline` at desktop/tablet widths and `--page-padding-inline-mobile` at mobile widths.
- Dashboard, RFQ, project, detail, and submit pages use `--page-top-standard`.
- Messages and settings-style dense workspaces use `--page-top-compact`.
- Directory/search pages use `--page-top-directory`.
- Dashboard/RFQ shells use `--page-shell-max` and `--page-shell-gap`.
- Page-level grids use `--page-grid-gap`. Search/filter/sort rows use `--page-controls-gap` on desktop and `--page-controls-responsive-gap` when controls wrap.
- RFQ flow pages with the fixed bottom navigation use the `rfq-bottom-nav-flow` shell rule and must not keep extra bottom page padding above the footer. The quote request sent page is the reference: the footer border should sit directly at the bottom edge of the content area with no white gap.
- When card bodies collapse, image/visual columns use `--responsive-media-max` and align to the same side across brand/factory screens.
- Production-order card status pills stay in the top action cluster beside the primary action and overflow menu at desktop/tablet breakpoints. At the smaller `1180px` card breakpoint and below, the status pill moves to a full-width second row under the title/action row; use the factory-side production-orders card as the reference.
- Brand/factory profile value sections use the same performance-card layout: one large lead metric in the left column and three supporting metrics in a horizontal right grid. Do not collapse these supporting metrics at `900px` or `760px`; keep the factory-side profile performance card as the reference and only move to a single-column stack at `560px` and below.
- Brand/factory profile view toggles use the same owner-bar responsive layout: at `1180px` and below, the owner bar stacks vertically, the segmented toggle becomes full width, and both toggle buttons split the available width equally.

### Responsive Breakpoint Contract

CSS variables cannot be used directly in media query conditions, so these breakpoints remain literal in CSS. Do not add a new breakpoint unless the layout cannot be solved within this ladder.

| Breakpoint | Purpose |
|---:|---|
| `1540px` | Rare wide-screen page-specific adjustment only |
| `1320px` | Project/list cards begin simplifying right-side media and action layouts |
| `1220px` | Side-nav pages normalize to collapsed-style page insets when space is tight |
| `1180px` | Dashboard/page grids collapse from multi-column to single-column |
| `900px` | Card headers and search/filter controls simplify further |
| `820px` | Settings/billing dense forms collapse |
| `760px` | Mobile side-nav content inset and one-column card structure |

### Audit Contract

- Do not rely only on text scans for repeated UI. For mirrored brand/factory components, compare rendered geometry: outer card height, top padding, bottom padding, title x/y, subtitle x/y, action y, metric row y, progress row y, and distance from lowest child to bottom border.
- A mirrored component passes only when matching geometry differs by no more than 1px at the same viewport.
- Run the comparison at desktop, `1180px`, `900px`, and `760px` widths for components governed by the responsive breakpoint contract.
- If a visual difference comes from copy length or a side-specific label, either align the copy or document the exception before adjusting CSS.

### Pill Tab Contract

- RFQ tabs, project tabs, invite tabs, and factory profile tabs use the same underline-tab dimensions.
- The top offset above tabs is `--pill-tab-offset-before`; the spacing below tabs is `--pill-tab-offset-after`.
- Simple tab rows use `--pill-tab-gap`; scrollable tab groups with add/manage controls use `--pill-tab-cluster-gap`.
- Tab buttons use `--pill-tab-height`, `--pill-tab-padding`, and `--pill-tab-font-size`.
- Active tabs change color/weight and underline only. Do not change height, padding, or position in the active state.

### Button And Pill Contract

- All primary, secondary, compact, dashboard, page-header, card-action, flow/footer action, filter, and sort buttons use the same `34px` button height via `--button-height`, `--compact-control-height`, `--brand-action-height`, or `--dashboard-action-height`.
- Button-like action states that are implemented as non-button elements, such as invite-card or quote-card `Message`, `Review quote`, `Invite`, and `Selected`, must visually use the same `34px` rounded button dimensions.
- Button action groups must not add local larger padding, font size, or radius. Use `--button-padding`, `--button-font-size`, `--button-line`, and `--button-radius` unless the guide defines a named exception.
- RFQ bottom navigation is the named size exception: use `--bottom-nav-button-height`, `--bottom-nav-button-padding`, `--bottom-nav-button-font-size`, and `--bottom-nav-button-line`, and vertically center every button inside the `76px` bottom bar.
- Non-action pills, tags, save pills, and status chips use `--pill-height`, `--pill-radius`, `--pill-padding`, `--pill-font-size`, and `--pill-line`.
- Clickable filter and sort buttons use the same `34px` primary/secondary button height.
- Small dashboard CTAs use `--compact-control-height`, `--compact-control-padding`, and `--compact-control-font-size`.
- Brand/factory page-header and card action buttons use `--brand-action-height`, `--brand-action-padding`, `--brand-action-font-size`, and `--brand-action-line`; this includes `View all`, `Invite brand`, `Request new quote`, `Save`, `Message`, `Request quote`, and `View RFQ` actions in dashboard panels, RFQ rows, directory, marketplace, saved lists, and profile screens.
- Profile edit controls use the same `34px` rounded secondary setting as profile detail actions. The profile hero has one visible top-right `Edit` control, and that editor manages both the profile image and banner image; do not place a second edit control on top of the profile image.
- Profile owner-card stacked actions are `34px` tall and capped at `220px` wide; do not stretch `Publish changes` / `View as public` to the full side-card width.
- Brand-side compact actions must use the same `34px` button height as default primary/secondary buttons.
- Dashboard side-card and attention-card action buttons use `--dashboard-action-height`, `--dashboard-action-padding`, `--dashboard-action-font-size`, and `--dashboard-action-line`; this applies to both white and blue buttons inside dashboard cards.
- Dashboard card actions must use the same `34px` button height as default primary/secondary buttons.
- Matching small primary and secondary buttons must share height, padding, radius, and font size.
- Compact status, match, and state pills use `--status-pill-height`, `--status-pill-padding`, `--status-pill-radius`, `--status-pill-font-size`, and `--status-pill-line`.
- Button text should remain centered by fixed height plus matching line-height/alignment, not by local top/bottom padding tweaks.

## Component Specs

### Button

- Height: 34px.
- Radius: 34px.
- Primary/secondary button text: 12px / 18px / Bold.
- Primary: `#1A4DF2` fill, white text.
- Secondary: white fill, `#CAD5E2` stroke, primary text.
- Text is always vertically and horizontally centered.

### Pill / Tag / Status Chip

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
5. Check dimensions: 34px buttons, 28px pills, 76px bottom bar, 8px cards.
6. Check color meaning: primary blue for actions and selected checkbox/radio controls, soft blue for selected filters, signal colors for fit/risk, trust colors for trust labels.
7. Check placement: same kind of element in the same flow should sit in the same position.
8. Check data provenance: remove unexplained text that does not come from RFQ, quote, contract, or payment data.
9. List any intentional exception in the handoff.
