---
name: Architectural Studio CAD
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#3f4850'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#707881'
  outline-variant: '#bfc7d2'
  surface-tint: '#006398'
  primary: '#006194'
  on-primary: '#ffffff'
  primary-container: '#007bb9'
  on-primary-container: '#fdfcff'
  inverse-primary: '#93ccff'
  secondary: '#712ae2'
  on-secondary: '#ffffff'
  secondary-container: '#8a4cfc'
  on-secondary-container: '#fffbff'
  tertiary: '#ba0035'
  on-tertiary: '#ffffff'
  tertiary-container: '#e21e49'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cce5ff'
  primary-fixed-dim: '#93ccff'
  on-primary-fixed: '#001d31'
  on-primary-fixed-variant: '#004b73'
  secondary-fixed: '#eaddff'
  secondary-fixed-dim: '#d2bbff'
  on-secondary-fixed: '#25005a'
  on-secondary-fixed-variant: '#5a00c6'
  tertiary-fixed: '#ffdada'
  tertiary-fixed-dim: '#ffb3b6'
  on-tertiary-fixed: '#40000c'
  on-tertiary-fixed-variant: '#920028'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: 0.01em
  label-mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: -0.01em
  label-mono-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0em
  label-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 0.875rem
    letterSpacing: 0.02em
  label-ui:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.6875rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-desktop: 1rem
  margin: 0.75rem
  margin-desktop: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system drives an ultra-clean, technical, and spatial CAD environment tailored for high-precision residential electrical planning. It merges the deliberate minimalism and spatial calm of modern architectural drafting tools with the tactile ergonomics and micro-interactions of next-generation developer tooling.

### Aesthetic Character
- **Spatial Subordination:** The interface remains largely translucent and muted to keep total visual focus on the 3D model, conductor pathways, and panel balancing.
- **Glassmorphism & Precision Surfaces:** Translucent canvas-floating panels (`rgba(255, 255, 255, 0.85)` to `0.95`) with delicate `1px` structural borders avoid visual occlusion while creating distinct elevation above the infinite canvas.
- **Instrumental Density:** Information density is disciplined and high-utility without feeling cramped. Data points rely on tabular monospaced layouts, micro-badges, and crisp phase chips.
- **Tactile Polish:** Modest pill toolbars, zero-fluff segmented switches, and whisper-quiet hover states emulate specialized high-end precision hardware.
- **Tone:** Professional, architectural, meticulous, fluent in French nomenclature (e.g., *Tableau Principal*, *Équilibrage de Phase*, *Calibre Disjoncteur*).

## Colors

The palette is engineered to resolve electrical phase mapping unequivocally. To maintain uncompromising semantic clarity and regulatory safety contrast, the interface explicitly omits green and yellow from phase identities.

### Studio Canvas & Structural Neutrals
- **Studio Backdrop:** `#EBF0F5` — An architectural blueprint tint providing soft ambient reflection beneath 3D models.
- **Panel Surface (Pure):** `#FFFFFF` — Used with backdrop blur and low opacity (`85%`–`95%`).
- **Hairline Borders:** `#E2E8F0` (standard container divisions), `#CBD5E1` (floating glass boundaries and active inputs).
- **Primary Typography:** `#0F172A` (Slate 900) — High-contrast readability for labels, metrics, and structural titles.
- **Secondary Typography:** `#475569` (Slate 600) — Descriptive metadata, units, and structural subheadings.
- **Muted Typography / Disabled:** `#94A3B8` (Slate 400) — Inactive coordinates, guide labels, and placeholder states.

### Strict Three-Phase Electrical Spectrum
- **Phase 1 (L1 - Crimson):** `#E11D48` — Conductor traces, terminal indicators, and L1 load distribution bars.
- **Phase 2 (L2 - Sky Blue / Primary Action):** `#0284C7` — Primary UI focal points, selection borders, L2 conductors, and system active states.
- **Phase 3 (L3 - Violet):** `#7C3AED` — Phase 3 distribution traces, secondary telemetry indicators, and tertiary status chips.
- **Non Assigné / Inconnu (? - Neutral Slate):** `#64748B` — Unallocated loads, pending circuits, unrouted 3D junction points.

## Typography

Typography prioritizes fast scannability during CAD operations:
- **UI & Structural Content:** Set in **Plus Jakarta Sans**, offering a clean, contemporary grotesque presence with humanist warmth. Uppercase micro-labels (`label-ui`) maintain a `0.04em` tracking for crisp section categorization.
- **Telemetry & Computational Metrics:** Set strictly in **JetBrains Mono**. All power tallies (W, kW, kVA), current intensity (A), voltage drops (V), wire gauges (mm²), and 3D spatial coordinates (X, Y, Z) enforce tabular numbers to guarantee vertical column alignment across inspectors and balance matrices.

## Layout & Spacing

The canvas follows a spatial overlay paradigm rather than a segmented fluid layout. 

### Spatial Framework
- **Viewport Canvas:** Spans 100vw × 100vh with `#EBF0F5` studio floor lighting.
- **Header Bar:** Docked to the top edge, fixed height of exactly `52px` (3.25rem), suspended with subtle bottom border isolation and `backdrop-blur-md`.
- **Primary Tool Dock:** Centered horizontally along the lower third or viewport top-center, styled as a floating pill toolbar with `space-xs` item gaps.
- **Inspector Deck:** Pinned to the right margin (`1rem` offset from edges), strictly constrained to a maximum width of `290px` to preserve CAD camera perspective and geometric focus.
- **Reflow & Device Behavior:**
  - **Desktop (>= 1024px):** Dual floating side-docks (Left: Circuit Hierarchy, Right: Inspector & Diagnostics) with active 3D canvas viewport.
  - **Tablet (768px - 1023px):** Side-docks collapse into transient floating drawers triggered via top bar icons; bottom tool pill remains anchored.
  - **Mobile (< 768px):** View-only diagnostic mode; panels collapse into full-width bottom sheets with gestures.

## Elevation & Depth

Visual hierarchy is communicated through translucent glass stratification, border luminosity, and low-opacity ambient shadows.

### Elevation Levels
1. **Base Layer (Level 0 - Studio Floor):**
   - Solid `#EBF0F5` canvas with optional 24px orthographic grid lines rendered in `#E2E8F0`.
2. **Glass Tier 1 (Level 1 - Floating Bars & Sidebars):**
   - Background: `rgba(255, 255, 255, 0.88)`
   - Backdrop filter: `blur(12px) saturate(180%)`
   - Border: `1px solid #CBD5E1`
   - Shadow: `0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 1px 2px -1px rgba(15, 23, 42, 0.04)` (`shadow-sm`)
3. **Glass Tier 2 (Level 2 - Contextual Inspector Cards & Menus):**
   - Background: `rgba(255, 255, 255, 0.95)`
   - Backdrop filter: `blur(16px)`
   - Border: `1px solid #CBD5E1`
   - Shadow: `0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.04)` (`shadow-md`)
4. **Interactive Layer (Level 3 - Active Dragging & Focus Overlays):**
   - Background: `#FFFFFF`
   - Border: `1px solid #0284C7` (Primary) or corresponding Phase color
   - Shadow: `0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.03)`

## Shapes

The interface balances soft technical contours with precision containment:
- **Panels & Inspector Containers:** `rounded-lg` (0.75rem / 12px) to softly frame engineering tools without dead screen real-estate.
- **Form Controls & Inputs:** `rounded` (0.375rem / 6px) to maintain a crisp, surgical appearance inside dense 290px inspector panes.
- **Toolbars & Phase Badges:** Full pill geometry (`rounded-full`) for high-touch interactions, drawing tool selectors, and phase assignment chips.

## Components

### Floating Pill Toolbar
- **Container:** Height `40px`, padding `4px`, `rounded-full`, surface `rgba(255, 255, 255, 0.90)`, `backdrop-blur-md`, border `1px solid #CBD5E1`.
- **Tool Buttons:** `32px × 32px` square with `rounded-full`, text `#475569`.
- **Active State:** Background `#0F172A`, text `#FFFFFF`, transition `all 150ms cubic-bezier(0.4, 0, 0.2, 1)`.
- **Divider:** Vertical `1px` rule, height `16px`, background `#E2E8F0`, margin `0 4px`.

### Contextual Inspector Card
- **Geometry:** Max-width `290px`, width `100%`, `rounded-lg`, background `rgba(255, 255, 255, 0.94)`, border `1px solid #CBD5E1`.
- **Header:** Height `38px`, padding `0 12px`, flex-between, border-bottom `1px solid #E2E8F0`. Title in `headline-sm`, subtitle/type in `label-mono-sm`.
- **Sections:** Separated by `1px solid #E2E8F0`, padding `10px 12px`.

### Phase Badges & Chips
- **Design:** Height `20px`, padding `0 6px`, `rounded-full`, inline-flex, align-center.
- **Variants:**
  - **L1 (Crimson):** Background `rgba(225, 29, 72, 0.10)`, text `#E11D48`, border `1px solid rgba(225, 29, 72, 0.25)`.
  - **L2 (Sky Blue):** Background `rgba(2, 132, 199, 0.10)`, text `#0284C7`, border `1px solid rgba(2, 132, 199, 0.25)`.
  - **L3 (Violet):** Background `rgba(124, 58, 237, 0.10)`, text `#7C3AED`, border `1px solid rgba(124, 58, 237, 0.25)`.
  - **Non Assigné (?):** Background `rgba(100, 116, 139, 0.10)`, text `#64748B`, border `1px solid rgba(100, 116, 139, 0.25)`.
- **Typography:** `label-mono-sm` with weight `500`.

### Segmented Controls (Sélecteurs de Phase)
- **Container:** Height `28px`, background `#EBF0F5`, padding `2px`, `rounded-md`, display flex.
- **Segments:** Flex 1, height `24px`, `rounded`, text-center, font `label-mono-sm`.
- **Selected Segment:** Background `#FFFFFF`, text `#0F172A`, shadow `0 1px 2px rgba(15, 23, 42, 0.08)`. For phase-specific controls, the active tab uses an accent indicator dot with the respective phase color.

### Precision Input Fields
- **Container:** Height `28px`, background `rgba(255, 255, 255, 0.80)`, border `1px solid #CBD5E1`, `rounded`, padding `0 8px`.
- **Typography:** `label-mono-md`, text `#0F172A`.
- **Adornments / Units:** Right-aligned unit suffix (`W`, `A`, `mm²`, `m`) rendered in `label-mono-sm`, color `#94A3B8`.
- **Focus:** Border color `#0284C7`, box-shadow `0 0 0 1px #0284C7`, outline none.

### Tactile Micro-Toggles (Interrupteurs)
- **Track:** Width `32px`, height `18px`, `rounded-full`, background `#CBD5E1`, transition 150ms.
- **Thumb:** Diameter `14px`, `rounded-full`, background `#FFFFFF`, shadow `0 1px 2px rgba(0, 0, 0, 0.15)`. Offset `2px`.
- **Active State:** Track background `#0284C7`. Thumb translates `14px`.

### 3D Canvas Diagnostics HUD
- **Mini Phase Balancing Bar:** Tri-color stacked bar indicator, height `4px`, `rounded-full`, showing load distribution percentages across L1, L2, and L3 against maximum circuit capacity.
- **Coordinates Readout:** Bottom-left anchored overlay, `rounded-md`, background `rgba(255, 255, 255, 0.75)`, padding `4px 8px`, `label-mono-sm`, displaying `X: 0.00m  Y: 0.00m  Z: 0.00m`.