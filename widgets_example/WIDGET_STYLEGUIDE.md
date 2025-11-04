# AuraMatrix Widget Styleguide

*Short and pithy widget development patterns*

---

## Widget Hierarchy

### **🎯 binaural** - *Canonical Hello World Widget*
**Pattern**: Standard `.control-panel` widget  
**Use as**: Template for new widgets  
**Structure**: Clean initialization, preset integration, UI controls  

```javascript
// Standard widget pattern
export function initBinauralWidget() {
    // Prevent re-initialization
    if (document.body.dataset.binauralWidgetInitialized) return;
    document.body.dataset.binauralWidgetInitialized = 'true';
    
    // Widget logic here
}
```

---

### **🚀 transport** - *Reusable Top-Level Elements*
**Pattern**: Global transport controls  
**Use as**: System-wide functionality  
**Structure**: Bridge between widgets, cross-widget communication  

**Key**: Usually positioned at top, provides services to other widgets

---

### **🗺️ journeymap** - *Reusable Object with Special Characteristics*
**Pattern**: Complex widget with full preset system  
**Use as**: Reference for preset implementation  
**Structure**: Full feature set - widget + presets + specs  

**Special**: Only widget with functioning presetter currently

---

### **🔧 Debug Widgets** - *Special Cases*
**Pattern**: Development tools that caught fire  
**Status**: Not canonical AuraMatrix design but essential  

#### **col1debug & floatdebug**
- **Purpose**: Debugger that evolved beyond its scope
- **Pattern**: Exception to standard widget rules
- **Status**: Essential but hacky compared to core AuraMatrix widgets

---

## Widget Development Rules

### **Standard Widget Checklist**
```
widgets/
├── <name>_widget.js     # Main widget logic
├── <name>_presets.js    # Preset interface (if needed)
└── debug variants       # col1debug, col3debug, floatdebug, etc.
```

### **Initialization Pattern**
```javascript
// Every widget uses this pattern
export function init<Name>Widget() {
    if (document.body.dataset.<name>WidgetInitialized) return;
    document.body.dataset.<name>WidgetInitialized = 'true';
    // Widget implementation
}
```

### **Integration Points**
- **UI Controls**: Import `../src/ui_controls.js`
- **Preset System**: Follow `journeymap_presets.js` pattern  
- **Transport Bridge**: Use transport for cross-widget communication

---

## Widget Categories

### **🎯 Standard Widgets** (`binaural`)
- Clean initialization
- Standard `.control-panel` styling
- Preset integration when needed

### **🚀 System Widgets** (`transport`)  
- Global functionality
- Cross-widget bridges
- Top-level positioning

### **🗺️ Complex Widgets** (`journeymap`)
- Full preset system
- Advanced UI interactions
- Complete feature implementation

### **🔧 Debug Widgets** (`col1debug`, `floatdebug`)
- Development tools
- Exception to standard patterns
- Essential but not canonical

---

## Quick Reference

**New widget?** → Copy `binaural` pattern  
**Need presets?** → Study `journeymap_presets.js`  
**Cross-widget communication?** → Use `transport` bridge  
**Debug tools?** → Extend existing debug widgets

**Key principle**: Start simple, follow `binaural`, scale up as needed.