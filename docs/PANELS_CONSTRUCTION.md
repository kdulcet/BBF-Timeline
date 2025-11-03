# Control Panel Construction Guide

## Overview

This document describes the standardized architecture for creating control panels in AuraMatrix. Each panel follows identical patterns for HTML structure, CSS styling, JavaScript initialization, and navigation integration.

## Core Architecture Pattern

Every control panel consists of:
1. **HTML Panel** - Minimal structure in `widgets/panels/<panel_name>_panel.html`
2. **CSS Styling** - Panel-specific styles in `widgets/styles/<panel_name>.css`
3. **JavaScript Controller** - Widget logic in `widgets/js/<panel_name>_widget.js`
4. **Main Panel Integration** - Navigation wiring in `widgets/js/main_panel_widget.js`

## HTML Structure (Required)

**File:** `widgets/panels/<panel_name>_panel.html`

```html
<!-- Panel Name Widget Panel -->
<div id="control-panel-<panel_name>" class="ui-base control-panel-<panel_name>">
    <div class="control-panel-top-row">
        <!-- Back arrow -->
        <img src="assets/back_arrow.svg" alt="Back" class="control-panel-back-arrow">
    </div>
</div>
```

**Critical Requirements:**
- Container ID: `control-panel-<panel_name>` (lowercase, hyphenated)
- Container classes: `ui-base control-panel-<panel_name>` (MUST include both)
- Top row: Uses generic `.control-panel-top-row` class
- Back arrow: Uses generic `.control-panel-back-arrow` class

**Why ui-base is required:**
- Provides white background, border, rounded corners, shadow
- Provides 0.75rem padding via `body .ui-base[id^="control-panel-"]` rule
- Ensures visual consistency across all panels
- See `styles/ui_elements.css` lines 90-100

## CSS Structure (Required)

**File:** `widgets/styles/<panel_name>.css`

```css
/* PANEL_NAME PANEL STYLES */

/* Panel container - matches binaural panel isolation */
.control-panel-<panel_name> {
  position: relative;
  z-index: 9999;
  transform: translate3d(0, 0, 0);
  isolation: isolate;
  contain: layout style;
  mix-blend-mode: normal;
  filter: opacity(1);
  overflow: visible;
  display: flex;
  flex-direction: column;
  flex: 1;
  /* Padding handled by generic .ui-base[id^="control-panel-"] rule in ui_elements.css */
}

/* Top row and back arrow inherit from .control-panel-top-row and .control-panel-back-arrow in ui_elements.css */
```

**Critical Requirements:**
- Class name: `.control-panel-<panel_name>` (matches HTML)
- GPU isolation properties (z-index, transform3d, isolation, contain)
- NO padding declaration (inherited from ui-base)
- Comment explaining padding inheritance
- Comment explaining top row inheritance

**Why these properties:**
- `z-index: 9999` - Ensures panel renders on top
- `transform: translate3d(0, 0, 0)` - Forces GPU layer for smoother rendering
- `isolation: isolate` - Prevents blend mode conflicts
- `contain: layout style` - CSS containment for performance
- `display: flex; flex-direction: column; flex: 1` - Vertical layout, fill parent

**Shadow System:**
- ALL control panels automatically inherit lighter shadows via `--control-panel-shadow` CSS variable
- Applies to buttons, selectors, and all UI elements inside the panel
- Panel-specific elements (handles, content boxes, etc.) should use `box-shadow: var(--control-panel-shadow)` for consistency
- DO NOT create panel-specific shadow variables - use the generic `--control-panel-shadow`

## Generic Control Widgets (Standard Components)

**File:** `styles/ui_elements.css` (Lines 143-237)

All panels should use the generic control widget system for consistent sizing and styling:

### `.control-widget` - Base Container
```css
.control-widget {
    width: 3.4rem;  /* STANDARD width for all widgets */
    height: 1.5rem; /* STANDARD height for all widgets */
}
```

### `.control-widget-label` - Widget Labels
```css
.control-widget-label {
    font-size: 0.65rem;
    text-align: right;  /* Right-aligned for colon alignment */
    min-width: 2.5rem;  /* Fixed width ensures labels line up */
}
```

### `.control-widget--slider` - Horizontal Sliders
For ISO controls, pulse length, filter cutoff, etc.
```html
<label class="control-widget-label">Iso:</label>
<div class="control-widget control-widget--slider pulse-control">
    <div class="control-widget__track"></div>
    <div class="control-widget__handle"></div>
</div>
```

### `.control-widget--buttons` - Button Arrays
For octave selection, wave type, etc.
```html
<label class="control-widget-label">Oct:</label>
<div class="control-widget control-widget--buttons octave-widget">
    <button class="octave-btn" data-oct="-2"></button>
    <button class="octave-btn" data-oct="-1"></button>
    <button class="octave-btn active" data-oct="0"></button>
    <button class="octave-btn" data-oct="1"></button>
    <button class="octave-btn" data-oct="2"></button>
</div>
```

### Widget Naming Pattern
- **Base class:** `.control-widget` (required)
- **Variant class:** `.control-widget--slider` or `.control-widget--buttons` (required)
- **Panel-specific class:** `.pulse-control`, `.octave-widget`, etc. (optional, for unique styling)

**Example - Binaural Panel:**
- Pulse control: `class="control-widget control-widget--slider pulse-control"`
- Length control: `class="control-widget control-widget--slider length-control"`
- Octave widget: `class="control-widget control-widget--buttons octave-widget"`
- Width control: `class="control-widget width-control"` (SVG variant, no --slider)

**Benefits:**
- All widgets exactly 3.4rem wide - perfect table-like alignment
- Labels right-aligned at 2.5rem - colons line up vertically
- Single inheritance pattern - extend generic base, never override twice
- Copy-paste to new panels - instant consistency

## JavaScript Controller (Required)

**File:** `widgets/js/<panel_name>_widget.js`

```javascript
// Panel Name Widget
// Description of panel purpose

export function init<PanelName>Widget() {
    console.log('🎵 Initializing <panel_name> panel');

    // Initialize back arrow to load main panel
    const backArrow = document.querySelector('#control-panel-<panel_name> .control-panel-back-arrow');
    if (backArrow) {
        backArrow.addEventListener('click', async () => {
            console.log('🔙 Back arrow clicked - loading main panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('main_panel', 'control-panel-container');
            }
        });
    }

    // Additional widget initialization here...
}
```

**Critical Requirements:**
- Export function: `init<PanelName>Widget()` (PascalCase)
- Back arrow selector: Scoped to specific panel ID
- Back arrow loads `main_panel` into `control-panel-container`
- Console log for debugging

## Main Panel Integration (Required)

**File:** `widgets/js/main_panel_widget.js`

Add icon navigation in `initMainPanel()`:

```javascript
// Get <panel_name> icon
const <panel_name>Icon = document.querySelector('.main-nav-icon[alt="<Panel Name>"]');
if (<panel_name>Icon) {
    <panel_name>Icon.addEventListener('click', async () => {
        console.log('🎵 <Panel Name> icon clicked - loading <panel_name> panel');
        if (window.panelLoader) {
            await window.panelLoader.loadPanel('<panel_name>_panel', 'control-panel-container');
            // Re-initialize widget after panel loads
            const { init<PanelName>Widget } = await import('./<panel_name>_widget.js');
            await init<PanelName>Widget();
            // Re-attach back arrow listener after panel loads
            attach<PanelName>BackArrow();
        }
    });
}
```

And add back arrow helper function:

```javascript
function attach<PanelName>BackArrow() {
    const backArrow = document.querySelector('#control-panel-<panel_name> .control-panel-back-arrow');
    if (backArrow) {
        backArrow.addEventListener('click', async () => {
            console.log('🔙 <Panel Name> back arrow clicked - loading main panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('main_panel', 'control-panel-container');
            }
        });
    }
}
```

**Why this pattern:**
- Dynamically imports widget controller after panel loads
- Reinitializes widget to attach event listeners to fresh DOM
- Separate back arrow function for reattachment after panel swap

## CSS File Linking (Required)

**File:** `index.html`

Add stylesheet link in `<head>`:

```html
<link rel="stylesheet" href="widgets/styles/<panel_name>.css" />
```

**Load Order:**
- After `styles/ui_elements.css` (base styles)
- Before any panel-specific overrides

## Generic Classes (Used by All Panels)

**From `styles/ui_elements.css`:**

### `.control-panel-top-row`
```css
.control-panel-top-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    margin-bottom: 0.55rem;
    width: 100%;
}
```
- Horizontal flex layout for top row content
- 0.5rem gap between child elements
- 0.55rem bottom margin (spacing below row)

### `.control-panel-back-arrow`
```css
.control-panel-back-arrow {
    width: 1.25rem;
    height: 1.25rem;
    margin-left: -.1rem;
    margin-right: 0.2rem;
    cursor: pointer;
    opacity: 1;
    transition: opacity 0.2s ease;
}
```
- Fixed 1.25rem size
- Slight negative left margin for alignment
- 0.2rem right margin (spacing after arrow)
- Pointer cursor on hover

### `body .ui-base[id^="control-panel-"]`
```css
body .ui-base[id^="control-panel-"] {
  background: #fff;
  border: 0.0625rem solid #000;
  border-radius: 0.5rem;
  box-shadow: 0 0.175rem 0.75rem rgba(0, 0, 0, 0.3), 0 0.1875rem 0.375rem rgba(0, 0, 0, 0.15);
  height: auto;
  line-height: normal;
  display: flex;
  flex-direction: column;
  padding: 0.75rem; /* ALL panels inherit this padding */
}
```
- Applies to ALL elements with ID starting with "control-panel-"
- White background, black border, rounded corners, shadow
- **0.75rem padding** - This is where panel content spacing comes from
- Flex column layout for vertical stacking

### Control Panel Shadow System
```css
:root {
  --control-panel-shadow: 0 0.125rem 0.125rem rgba(0, 0, 0, .3), 0 0.125rem 0.125rem rgba(0, 0, 0, 0.3);
}

body [id^="control-panel-"].ui-base .ui-base,
body [id^="control-panel-"].ui-base .button_selector,
body [id^="control-panel-"].ui-base .button_selector__nav,
body [id^="control-panel-"].ui-base .ui-btn {
  box-shadow: var(--control-panel-shadow) !important;
}

body [id^="control-panel-"].ui-base .button_selector__display {
  box-shadow: none !important;
}
```
- **CSS Variable:** `--control-panel-shadow` provides lighter shadows for ALL control panels
- **Applies to:** All UI elements inside ANY control panel (buttons, selectors, handles, content boxes)
- **Why lighter:** Creates visual hierarchy - panels themselves have deeper shadows, internal elements have subtle shadows
- **Universal:** Binaural faders, noise controls, sub controls, all future panel widgets inherit this automatically
- **Override:** Use `var(--control-panel-shadow)` in panel-specific CSS for custom elements (handles, content boxes, etc.)

## Panel Widget Lifecycle

### 1. Initial Page Load
- `panel_loader.js` loads default panel (usually `main_panel`)
- Main panel controller initializes
- Main panel icons attach click listeners

### 2. Navigation to Panel
1. User clicks icon in main panel
2. `panelLoader.loadPanel('<panel_name>_panel', 'control-panel-container')` called
3. Old panel HTML destroyed (all event listeners lost)
4. New panel HTML injected into DOM
5. `init<PanelName>Widget()` called to attach fresh event listeners
6. Back arrow listener reattached via `attach<PanelName>BackArrow()`

### 3. Navigation Back to Main
1. User clicks back arrow
2. `panelLoader.loadPanel('main_panel', 'control-panel-container')` called
3. Panel HTML destroyed
4. Main panel HTML injected
5. Main panel controller reinitializes icons

**CRITICAL:** Every time a panel is swapped, ALL event listeners must be reattached. This is why widgets need session-based initialization guards (see binaural_widget.js for pattern).

## Common Pitfalls

### ❌ Missing ui-base class
```html
<!-- WRONG - No padding, no border, no shadow -->
<div id="control-panel-noise" class="control-panel-noise">
```

### ✅ Correct class usage
```html
<!-- CORRECT - Inherits all base styling -->
<div id="control-panel-noise" class="ui-base control-panel-noise">
```

### ❌ Adding padding to panel CSS
```css
/* WRONG - Duplicate padding rule */
.control-panel-noise {
  padding: 0.75rem; /* Don't do this! */
}
```

### ✅ Correct padding inheritance
```css
/* CORRECT - Comment explaining inheritance */
.control-panel-noise {
  /* Padding handled by generic .ui-base[id^="control-panel-"] rule in ui_elements.css */
}
```

### ❌ Not reinitializing widget after panel swap
```javascript
// WRONG - Widget never initializes after navigation
binauralIcon.addEventListener('click', async () => {
    await window.panelLoader.loadPanel('binaural_panel', 'control-panel-container');
    // Missing widget initialization!
});
```

### ✅ Correct widget initialization
```javascript
// CORRECT - Widget reinitializes with fresh DOM
binauralIcon.addEventListener('click', async () => {
    await window.panelLoader.loadPanel('binaural_panel', 'control-panel-container');
    const { initBinauralWidget } = await import('./binaural_widget.js');
    await initBinauralWidget();
});
```

## Existing Panel Examples

### Binaural Panel
- **HTML:** `widgets/panels/binaural_panel.html`
- **CSS:** `widgets/styles/binaural.css`
- **JS:** `widgets/js/binaural_widget.js`
- **Features:** Root selector, mood selector, 5 voice faders, octave controls, width controls, ISO controls, preset system

### Noise Panel
- **HTML:** `widgets/panels/noise_panel.html`
- **CSS:** `widgets/styles/noise_panel.css`
- **JS:** `widgets/js/noise_widget.js` (to be created)
- **Features:** Currently blank with back arrow only

### Main Panel
- **HTML:** `widgets/panels/main_panel.html`
- **CSS:** `widgets/styles/main_panel.css`
- **JS:** `widgets/js/main_panel_widget.js`
- **Features:** Navigation hub with SVG icons (Noise, Binaural, Sub)

## Preset System Integration

If a panel needs presets (like binaural), add:

1. **Preset Controller:** `widgets/presets/<panel_name>_presets.js`
2. **Preset HTML:** Add preset selector to panel HTML
3. **Preset ID:** `#<panel_name>-preset-selector` (unique per panel)
4. **Nav Buttons:** `#<panel_name>-preset-prev`, `#<panel_name>-preset-next`
5. **Save/Revert:** `#<panel_name>-save-preset`, `#<panel_name>-revert-preset`

**CRITICAL:** Each panel gets its own preset system with unique IDs. Never share preset selectors between panels (journeymap uses `#jm-preset-selector`, binaural uses `#binaural-preset-selector`, etc.).

## Checklist for New Panel

- [ ] Create `widgets/panels/<panel_name>_panel.html` with ui-base class
- [ ] Create `widgets/styles/<panel_name>.css` with GPU isolation
- [ ] Create `widgets/js/<panel_name>_widget.js` with init function
- [ ] Add CSS link to `index.html`
- [ ] Add icon navigation to `main_panel_widget.js`
- [ ] Add back arrow helper function
- [ ] Test navigation: main → panel → main
- [ ] Verify padding/spacing matches other panels
- [ ] Verify back arrow clickable
- [ ] Check browser console for initialization logs

## References

- **CSS Guide:** `docs/CSS_STYLEGUIDE.md`
- **Widget Guide:** `widgets/WIDGET_STYLEGUIDE.md`
- **Generic CSS:** `styles/ui_elements.css` (lines 118-129 for top row, 131-142 for back arrow, 90-100 for ui-base)
- **Panel Loader:** `src/panel_loader.js`
- **Main Panel:** `widgets/js/main_panel_widget.js` (canonical navigation example)
