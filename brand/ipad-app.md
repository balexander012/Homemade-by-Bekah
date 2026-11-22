# 7. iPad baking app

The app should look like Homemade by Bekah, but it is a tool first. It is used at counter height, often at arm's length, with flour or butter on the hands, while several batches run. See the *IpadDashboard*, *RecipeStep*, *Timer* and *StatusChip* cards (switch the page to **Kitchen Dark** to see the dark theme).

## Principles

1. **Readable from 3 feet.** Current step 26px, quantities 40px, timers 64px, all tabular figures.
2. **Big targets.** Minimum 64 x 64pt (`touch-app`), 12px minimum gap between targets. Primary actions bottom-right within thumb reach in landscape.
3. **Status is never color alone.** Each state has a color, a shape and a word: Prepping (info, dot), Proofing (warn, dot), Baking (walnut, dot), Done (ready, dot), Overdue (danger, diamond + bold border).
4. **Shallow navigation.** Four destinations in a left rail: Today, Recipes, Calendar, Photos. Everything else is a sheet over the current screen.
5. **Forgiving.** Undo on every check-off, no swipe-to-delete in active sessions, confirm only destructive actions.
6. **Screen stays awake** while a session is running; timers alert with sound and a full-width banner.

## Screens

| Screen | Content |
|---|---|
| Today (dashboard) | One tile per active batch with timer and status; "Up next" step panel; photo checklist; + New batch |
| Recipe library | Grid of recipe cards (photo, name, yield, total time, last baked); filter chips by category |
| Recipe / session | Left: ingredient checklist with scaled quantities; right: one step at a time, Back and Next, inline timer start |
| Production calendar | Week view by day, bake blocks per batch, order counts; order cutoffs marked |
| Photo checklist | Shot list per product (overhead, 45 degree, detail, crumb), checkbox per shot, notes on light and props |

## Layout

- iPad landscape 1180 x 820pt: 96pt rail + content with 24pt margins, 12pt gutters, 4-column batch grid.
- iPad portrait: rail becomes bottom tab bar (4 items), batch grid 2 columns.
- iPhone: single column, sheets for ingredients, same type tokens scaled 0.85.

## Themes

- **Bakery Light** (default, daylight kitchen): cream ground, paper panels.
- **Kitchen Dark** (low light, early mornings): `#1C1B17` ground, `#2E2B25` panels, light olive accents; all text 7:1 or higher.
- Follow the system setting with a manual override in Settings.

## Components

- Buttons: `.hb-btn--app` (64pt, 20px label, `radius-lg`).
- Checklist rows: 64pt min height, 44pt checkbox, checked rows strike through and dim to `ink-600`.
- Ingredient quantities: number in 34 to 40px bold, unit at 60% in `ink-600`; grams first, volume as secondary text if shown.
- Timer tile: border turns `status-warn` under 2 minutes, `status-danger` and "+mm:ss" when overdue.
