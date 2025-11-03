# WIDGET STYLESHEET REFERENCE

**Status**: Reference documentation for all widget stylesheets  
**Last Updated**: October 21, 2025  
**Purpose**: Blueprint for consistent, maintainable widget styling

---

## 📖 **OVERVIEW**

`binaural.css` is the **REFERENCE IMPLEMENTATION** for all widget stylesheets in the Auramatrix ecosystem. It demonstrates proper CSS architecture, inheritance patterns, and integration with the global style system.

This stylesheet is:
- ✅ **Properly layered** (base → generic → widget-specific)
- ✅ **DRY** (extends base styles, minimal overrides)
- ✅ **GPU-optimized** (compositing layer isolation for GLSL shaders)
- ✅ **Debug-aware** (visibility controls via data attributes)
- ✅ **Well-documented** (clear sections, purpose-driven comments)

---

## 🏗️ **CSS ARCHITECTURE**

### **Three-Layer System**

All widget stylesheets follow a strict layering hierarchy:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: BASE STYLES (styles/base.css)                    │
│  - CSS variables (colors, shadows, spacing)                │
│  - Typography (Inter font)                                 │
│  - Global resets (box-sizing, margins)                     │
│  - :root variable definitions                              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: GENERIC WIDGET STYLES (styles/ui_elements.css)   │
│  - .control-panel (white panel container)                  │
│  - .ui-base (base interactive element)                     │
│  - .button_selector (nav buttons, displays)                │
│  - .ui-btn (action buttons)                                │
│  - .control-grid (2×2 control layout)                      │
│  - .fader-track, .fader-handle (generic fader)             │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: WIDGET-SPECIFIC (widgets/styles/[widget].css)    │
│  - Widget-specific layout (rows, sections)                 │
│  - Size/spacing overrides (font-size, gaps)                │
│  - Unique controls (binaural faders, pagination)           │
│  - This file: Minimal overrides, maximum inheritance       │
└─────────────────────────────────────────────────────────────┘
```

### **Inheritance Example**

```css
/* ❌ WRONG: Duplicate base styles in widget CSS */
.binaural-widget .ui-btn {
    background-color: white;
    border: 0.125rem solid #000;
    border-radius: 0.3rem;
    box-shadow: 0 0.125rem 0.375rem rgba(0,0,0,0.1);
    /* ...50 more lines of redundant styles */
}

/* ✅ CORRECT: Inherit base, override only what's needed */
.binaural-widget .ui-btn {
    font-size: 0.8em; /* Widget-specific sizing */
}
/* All other styles inherited from .ui-btn in ui_elements.css */
```

---

## 📐 **LAYOUT STRUCTURE**

### **Binaural Widget Anatomy**

```
.control-panel-binaural (container from ui_elements.css)
│
├── .binaural-widget (widget flex container)
│   │
│   ├── .control-panel-top-row (Row 1: Root/Mood selectors)
│   │   ├── .root-selector-container
│   │   │   ├── <label>Root:</label>
│   │   │   └── .button_selector (← → Display)
│   │   └── .mood-selector-container
│   │       ├── <label>Mood:</label>
│   │       └── .button_selector (← → Display)
│   │
│   ├── .binaural-middle-section (flex: 1, fills available space)
│   │   ├── .binaural-content-box (expandable content area)
│   │   │   ├── .binaural-nav-left (button)
│   │   │   ├── .binaural-content-area
│   │   │   │   ├── .binaural-page-number (1/3)
│   │   │   │   ├── .binaural-page.active (visible page)
│   │   │   │   │   └── .control-grid (2×2 widget grid)
│   │   │   │   └── .binaural-page (hidden pages)
│   │   │   └── .binaural-nav-right (button)
│   │   │
│   │   └── .binaural-faders-row (voice volume faders)
│   │       ├── .voice-fader × 5
│   │       │   ├── .fader-track
│   │       │   ├── .fader-handle
│   │       │   └── .voice-label (V1, V2, V3, V4, V5)
│   │
│   └── .control-panel-bottom-row (Row 3: Preset controls)
│       └── .binaural-presets
│           ├── .ui-btn (Save)
│           ├── .button_selector--preset (← → Display)
│           └── .ui-btn (Revert)
```

### **Flex Ordering**

Binaural uses `order` property for layout control:

```css
.control-panel-top-row {
    order: 0; /* Top: Root/Mood selectors */
}

.binaural-middle-section {
    order: 1; /* Middle: Expandable content + faders */
    flex: 1; /* Takes all available space */
}

.control-panel-bottom-row {
    order: 2; /* Bottom: Preset controls */
}
```

---

## 🎨 **STYLING PATTERNS**

### **1. Container Isolation (GPU Compositing)**

**Problem**: GLSL shaders in adaptive background interfere with UI rendering  
**Solution**: Force UI elements onto separate GPU compositing layers

```css
.control-panel-binaural {
  z-index: 9999;
  transform: translate3d(0, 0, 0); /* Force GPU layer */
  isolation: isolate; /* Isolate from backdrop effects */
  contain: strict; /* Prevent leakage to/from shader layer */
}

/* All interactive elements also isolated */
body #control-panel-binaural.ui-base .binaural-widget .button_selector,
body #control-panel-binaural.ui-base .binaural-widget .ui-btn,
body #control-panel-binaural.ui-base .binaural-widget .fader-handle {
  position: relative;
  z-index: 1000;
  transform: translate3d(0, 0, 0);
  isolation: isolate;
  backdrop-filter: blur(0); /* Force compositing layer */
}
```

**Why high specificity?**  
The GPU isolation rules need to override any generic rules from ui_elements.css. High specificity ensures these critical rendering fixes are not overridden.

### **2. Debug Visibility Controls**

**Pattern**: CSS-level hiding via data attributes  
**Controller**: UI Debug system toggles attributes on `<body>`  
**Purpose**: Show/hide widget sections without JavaScript DOM manipulation

```css
/* Default: Controls hidden */
.binaural-widget .control-panel-top-row {
  display: none;
}

/* Show when debug system sets attribute */
[data-debug-binaural-controls="visible"] .control-panel-top-row {
  display: flex !important;
}

/* Hide entire panel */
[data-debug-panel-bg="hidden"] .control-panel-binaural {
  display: none !important;
}
```

**Widget Structure Mapping**:
- `data-debug-panel-bg` → `.control-panel-binaural` (white panel container)
- `data-debug-binaural-controls` → `.control-panel-top-row` (Root/Mood)
- `data-debug-binaural-presets` → `.control-panel-bottom-row` (Save/Preset/Revert)

**Naming Convention**:
- Panel background: `data-debug-panel-bg`
- Widget controls: `data-debug-[widget]-controls`
- Widget presets: `data-debug-[widget]-presets`

### **3. Size Inheritance**

**Pattern**: Inherit base sizes, override sparingly

```css
/* Base sizing in ui_elements.css */
.button_selector {
    font-size: 1em; /* Inherits from parent */
    height: 2rem;
}

/* Widget-specific override */
.binaural-widget .button_selector {
    font-size: 0.8em; /* Scale down for compact layout */
}
/* Height inherited from .button_selector */
```

**When to override**:
- ✅ Font size (widget-specific density)
- ✅ Gaps/spacing (widget-specific layout)
- ✅ Margins (alignment adjustments)
- ❌ Colors (use CSS variables instead)
- ❌ Borders (inherit from base)
- ❌ Shadows (use `var(--control-panel-shadow)`)

### **4. Fader Positioning**

**Pattern**: Percentage-based positioning with JavaScript control

```css
.fader-handle {
    position: absolute;
    left: 50%; /* Center on track */
    transform: translateX(-50%); /* Correct for handle width */
    /* Bottom position set via JS: handle.style.bottom = `${percentage}%` */
}
```

**JavaScript sets**:
```javascript
// 0% = bottom of track, 100% = top of track
handle.style.bottom = `${(volume + 70) / 70 * 100}%`;
```

**Why not `top`?**  
Faders represent volume: higher visual position = higher volume. Using `bottom` makes the math intuitive.

### **5. Octave Widget (Custom Pseudo-elements)**

**Pattern**: Pure CSS control widget using `::before` and `::after`

```css
/* Horizontal base line */
.octave-widget::before {
    content: '';
    position: absolute;
    bottom: 0.625rem;
    width: 3.4rem;
    height: 0.075rem;
    background: #333;
}

/* Vertical tick marks (5 positions) */
.octave-widget::after {
    content: '';
    position: absolute;
    bottom: 0.25rem;
    width: 3.4rem;
    height: 0.75rem;
    background: 
        linear-gradient(90deg, #333 0rem, #333 0.075rem, transparent 0.075rem) 0rem 0rem / 0.075rem 0.75rem no-repeat,
        linear-gradient(90deg, #333 0rem, #333 0.075rem, transparent 0.075rem) 0.8rem 0.1rem / 0.9rem 0.55rem no-repeat,
        /* ...3 more tick marks */
}

/* Invisible buttons for click targets */
.octave-btn {
    position: absolute;
    bottom: 0;
    width: 1rem;
    height: 1.25rem;
    background: transparent;
    cursor: pointer;
}

.octave-btn[data-oct="-2"] { left: -0.4625rem; }
.octave-btn[data-oct="-1"] { left: 0.3375rem; }
.octave-btn[data-oct="0"] { left: 1.1875rem; }
.octave-btn[data-oct="1"] { left: 2.0375rem; }
.octave-btn[data-oct="2"] { left: 2.85rem; }

/* Active indicator */
.octave-btn.active::after {
    content: '';
    position: absolute;
    top: 0.6rem;
    left: 51%;
    width: 0.4rem;
    height: 0.4rem;
    background: #000;
    border-radius: 50%;
    transform: translate(-50%, -50%);
}
```

**Why pseudo-elements?**  
- No extra DOM nodes needed
- Pure CSS rendering
- Lighter DOM tree
- Easier to maintain (visual style in CSS, not JS)

### **6. Pagination System**

**Pattern**: Absolute-positioned pages with `.active` class toggle

```css
/* All pages hidden by default */
.binaural-page {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: none;
}

/* Show active page */
.binaural-page.active {
    display: flex;
}
```

**JavaScript navigation**:
```javascript
// Hide all pages
document.querySelectorAll('.binaural-page').forEach(p => p.classList.remove('active'));

// Show target page
document.getElementById(`binaural-page-${pageNum}`).classList.add('active');
```

**Page number indicator**:
```css
.binaural-page-number {
    position: absolute;
    top: 0.1rem;
    right: -.45rem; /* Outside content area */
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-size: 0.75rem;
    font-weight: bold;
    padding: 0.0525rem 0.010rem;
    border-radius: 0.125rem;
    z-index: 10;
}
```

---

## 🔍 **CSS INTEGRATION CHECKLIST**

When creating a new widget stylesheet:

### **File Structure**
- [ ] Create: `widgets/styles/[widget-name].css`
- [ ] Import order in HTML:
  ```html
  <link rel="stylesheet" href="styles/base.css">
  <link rel="stylesheet" href="styles/ui_elements.css">
  <link rel="stylesheet" href="widgets/styles/[widget-name].css">
  ```

### **Header Comments**
- [ ] File purpose header (80-char border)
- [ ] Architecture overview (layout structure)
- [ ] Inheritance chain (base → generic → widget)
- [ ] CSS integration notes (which base files extended)

### **Layering**
- [ ] Extend `.control-panel` for container (don't recreate)
- [ ] Use `.ui-base` for interactive elements
- [ ] Use `.button_selector` for navigation/display controls
- [ ] Use `.control-grid` for 2×2 control layouts
- [ ] Override only widget-specific sizing/spacing

### **GPU Isolation**
- [ ] Container isolation rules (if GLSL shaders present)
- [ ] Interactive element isolation (buttons, faders)
- [ ] High specificity for isolation rules

### **Debug Visibility**
- [ ] Add `data-debug-[widget]-controls` support
- [ ] Add `data-debug-[widget]-presets` support
- [ ] Add `data-debug-panel-bg` support
- [ ] Default state: hidden or visible?

### **Section Headers**
- [ ] Container isolation (if needed)
- [ ] Debug visibility controls
- [ ] Widget container
- [ ] Top row (if applicable)
- [ ] Middle section (if applicable)
- [ ] Bottom row (if applicable)
- [ ] Custom controls (widget-specific elements)

### **Documentation**
- [ ] Explain any non-obvious CSS (pseudo-elements, transforms)
- [ ] Document positioning logic (absolute, flex ordering)
- [ ] Note JS integration points (`.active` classes, `style.bottom`, etc.)
- [ ] Cross-reference base styles when extending

---

## 📚 **CSS VARIABLES**

### **Used from `styles/base.css`**

```css
/* Shadows */
--control-panel-shadow: 0 0.125rem 0.375rem rgba(0,0,0,0.1);

/* Colors (future expansion) */
--primary-color: #000000;
--bg-white: #ffffff;
--text-dark: #333333;

/* Spacing (future expansion) */
--gap-sm: 0.5rem;
--gap-md: 1.0rem;
--gap-lg: 1.5rem;
```

**When to use**:
- ✅ Shadows: `box-shadow: var(--control-panel-shadow);`
- ✅ Future: Colors, spacing (when added to base.css)
- ❌ Don't create widget-specific CSS variables (keep simple)

---

## 🚀 **ADDING A NEW WIDGET STYLESHEET**

### **Step 1: Create File**

```bash
touch widgets/styles/your-widget.css
```

### **Step 2: Add Header**

```css
/* ============================================================================
   YOUR-WIDGET STYLES
   ============================================================================
   Widget-specific CSS for [brief description].
   
   ARCHITECTURE:
   - Extends base widget styles from styles/ui_elements.css
   - Overrides generic rules for [widget]-specific layout
   - Uses control-grid system for control arrangement
   
   LAYOUT STRUCTURE:
   [ASCII diagram of your widget layout]
   
   CSS INTEGRATION:
   - Base styles: styles/base.css (variables, resets)
   - Generic widgets: styles/ui_elements.css (.control-panel, .ui-base, etc.)
   - This file: [Widget]-specific overrides
   ============================================================================ */
```

### **Step 3: GPU Isolation (if needed)**

```css
/* ==============================================
   CONTAINER ISOLATION
   ==============================================
   Force separate GPU compositing layer to prevent
   shader/backdrop interference.
   ============================================== */

.control-panel-[widget] {
  z-index: 9999;
  transform: translate3d(0, 0, 0);
  isolation: isolate;
  contain: strict;
}

/* Force interactive elements onto separate layers */
body #control-panel-[widget].ui-base .your-widget .ui-btn {
  position: relative;
  z-index: 1000;
  transform: translate3d(0, 0, 0);
  isolation: isolate;
}
```

### **Step 4: Debug Visibility**

```css
/* ==============================================
   DEBUG VISIBILITY CONTROLS
   ==============================================
   CSS-level element hiding via data attributes.
   ============================================== */

/* Default state */
.your-widget .control-panel-top-row {
  display: none;
}

/* Show when debug enabled */
[data-debug-your-widget-controls="visible"] .control-panel-top-row {
  display: flex !important;
}
```

### **Step 5: Widget-Specific Layout**

```css
/* ==============================================
   WIDGET CONTAINER
   ==============================================
   Extend .control-panel from ui_elements.css.
   ============================================== */

.control-panel-[widget] .your-widget {
    /* Minimal overrides only */
    padding: 0;
    width: 100%;
    flex-direction: column;
}

/* ==============================================
   TOP ROW
   ==============================================
   [Description of top row purpose]
   ============================================== */

.your-widget .control-panel-top-row {
    gap: 0.5rem; /* Override if needed */
    font-size: 0.8em; /* Scale for widget */
}

/* Add more sections as needed... */
```

### **Step 6: Link in HTML**

```html
<!-- In your widget panel HTML -->
<link rel="stylesheet" href="../../styles/base.css">
<link rel="stylesheet" href="../../styles/ui_elements.css">
<link rel="stylesheet" href="../styles/your-widget.css">
```

---

## ⚠️ **COMMON PITFALLS**

### **1. Recreating Base Styles**

```css
/* ❌ WRONG: Duplicating .ui-btn styles */
.your-widget .ui-btn {
    background: white;
    border: 0.125rem solid #000;
    /* ...20 more lines */
}

/* ✅ CORRECT: Inherit base, override only differences */
.your-widget .ui-btn {
    font-size: 0.75em; /* Widget needs smaller buttons */
}
```

### **2. Forgetting GPU Isolation**

**Symptom**: Buttons disappear or flicker when GLSL shader animates  
**Fix**: Add container isolation + element isolation rules

### **3. Hardcoded Values Instead of Variables**

```css
/* ❌ WRONG */
box-shadow: 0 2px 6px rgba(0,0,0,0.1);

/* ✅ CORRECT */
box-shadow: var(--control-panel-shadow);
```

### **4. Overly Specific Selectors**

```css
/* ❌ WRONG: Overly specific, hard to override */
.control-panel-binaural .binaural-widget .control-panel-top-row .root-selector-container .button_selector .button_selector__display {
    min-width: 1.35rem;
}

/* ✅ CORRECT: Specific enough, not excessive */
.root-selector-container .button_selector__display {
    min-width: 1.35rem;
}
```

**Exception**: GPU isolation rules need high specificity to override base styles.

### **5. Not Using Flex `order`**

```css
/* ❌ WRONG: DOM order determines visual order */
/* HTML: <top-row>, <bottom-row>, <middle-section> */
/* Visual: top, bottom, middle (breaks layout!) */

/* ✅ CORRECT: Use order to control visual layout */
.control-panel-top-row { order: 0; }
.binaural-middle-section { order: 1; }
.control-panel-bottom-row { order: 2; }
/* Visual: top, middle, bottom (correct!) */
```

### **6. Mixing Layout Responsibilities**

```css
/* ❌ WRONG: Widget CSS creating panel chrome */
.your-widget {
    background: white;
    border: 0.125rem solid #000;
    border-radius: 0.625rem;
    box-shadow: 0 0.375rem 1.125rem rgba(0,0,0,0.12);
    /* This is .control-panel's job! */
}

/* ✅ CORRECT: Let .control-panel handle chrome */
.control-panel-[widget] .your-widget {
    background: transparent; /* Panel provides white bg */
    border: none; /* Panel provides border */
}
```

---

## 📖 **FURTHER READING**

- **Generic Widget Styles**: `styles/ui_elements.css`
- **Base CSS Variables**: `styles/base.css`
- **CSS Style Guide**: `docs/CSS_STYLEGUIDE.md`
- **Project Structure**: `docs/PROJECT_STRUCTURE.md`
- **Widget Construction**: `widgets/WIDGET_STYLEGUIDE.md`

---

## 🎯 **QUALITY CHECKLIST**

Before considering a widget stylesheet "complete":

- [ ] Extends base styles (not recreating)
- [ ] Minimal overrides (only widget-specific sizing/spacing)
- [ ] GPU isolation (if GLSL shaders present)
- [ ] Debug visibility controls (data attributes)
- [ ] Section headers (clear boundaries)
- [ ] Comprehensive header comment (architecture, layout, integration)
- [ ] Uses CSS variables (shadows, colors when available)
- [ ] Responsive to control-grid (if using 2×2 layout)
- [ ] Proper specificity (not overly specific, not too loose)
- [ ] Documented non-obvious CSS (pseudo-elements, transforms, positioning)
- [ ] Cross-references to base styles
- [ ] HTML import order correct (base → ui_elements → widget)

---

**Last Updated**: October 21, 2025  
**Maintained By**: Auramatrix Development Team  
**Reference File**: `widgets/styles/binaural.css`
