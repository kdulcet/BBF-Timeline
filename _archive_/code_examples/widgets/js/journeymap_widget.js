// ============================================================================
// JOURNEYMAP WIDGET - VIEW LAYER (MVC)
// ============================================================================
// MVC ARCHITECTURE: Timeline UI orchestrator for journey progression
//
// PATTERN: Widget → Controller → Timeline System → Audio Models
// - Widget (this file): Orchestrates timeline UI, delegates click handlers & rendering
// - Controller (journeymap_presets.js): Manages state, loads/saves journeys, owns IsResumeJM flag
// - Timeline System (src/timeline/): Validates & compiles journey segments
// - Audio Models (binaural_synth.js + binaural_iso.js): Pure audio generation
//
// JOURNEY STRUCTURE:
// - Segments: Plateau (sustained Hz) + Transition (Hz ramp)
// - Timeline: Array of segments with time/duration/Hz values
// - BPM Calculation: BPM = (Hz × 60) / 8 (CORE TECHNOLOGY - do not change)
//
// CLICK-TO-LOOP FEATURE (BBF "Fidget Toy" Achievement):
// - User clicks plateau → Transport loops that segment instantly
// - Does NOT set IsResumeJM flag (temporary playback mode, not permanent edit)
// - Provides instant gratification for exploration
// - Communicates with transport_widget via custom events
//
// REAL-TIME HZ DRAG FEATURE:
// - Live frequency adjustment during playback (drag plateau freq labels)
// - DOES set IsResumeJM = true (permanent timeline edit)
// - Updates BOTH binaural + isochronic synths immediately
// - Visual feedback: DOM updates, Transport BPM recalculation
//
// ISRESUMEJM FLAG SYSTEM:
// - Owned by Controller (journeymap_presets.js)
// - Tracks manual timeline edits (Hz drag, segment changes)
// - Different from IsResume (voice controls - owned by binaural presets)
// - Preset load: Checks IsResumeJM to decide apply vs preserve
//
// CSS COMPLIANCE:
// - All styling via CSS classes (journeymap.css)
// - Brainwave band colors from CSS variables (--band-alpha-primary, etc.)
// - No inline styles except animation transforms
// - See docs/CSS_STYLEGUIDE.md for architecture details
//
// EXTRACTED MODULES (Refactor complete):
// ✅ journeymap_timeline.js: Timeline rendering + Hz drag handlers (250 lines extracted)
// ✅ journeymap_onclick.js: Click-to-loop feature (150 lines extracted)
// ✅ Main widget reduced to orchestration only (~500 lines)
// ============================================================================

import "../../src/ui_controls.js"; // Generic UI control utilities
import { createPresetController } from "./journeymap_ui.js"; // Preset selector + save modal
import {
  listRecipeFiles,
  loadRecipe,
  processAllRecipes,
} from "../../src/interpreter.js"; // Journey recipe processing system
import {
  collectPresetFromDOM,
  savePresetFile,
  importPresetObject,
  getPreset
} from "../../src/preset_resources.js"; // Preset I/O infrastructure

// Extracted timeline rendering module
import {
  darkenHex,
  getWaveType,
  updateTotalDisplay,
  attachDragHz,
  attachDragMinutes
} from "./journeymap_timeline.js";

// Extracted click-to-loop module
import {
  handleBoxClick,
  clearAllLoops,
  initClickToLoopAPI
} from "./journeymap_onclick.js";

// Note: binaural preset controller and renderer handled by binaural_widget.js

// ==============================================
// COLOR HELPERS - Brainwave Band Styling
// ==============================================
// PURPOSE: Extract primary colors for brainwave bands (alpha, delta, theta, etc.)
// PATTERN: CSS variable lookup → Fallback to computed background gradient parsing
// CSS COMPLIANCE: Queries CSS variables, never sets inline styles
// CACHING: Performance optimization for repeated color lookups
// ==============================================

const bandColorCache = {}; // Cache for band color lookups (performance)

// Convert rgb/rgba string to hex color code (#RRGGBB format)
function rgbStringToHex(s) {
  const m = s && s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((p) => Number(p.trim()));
  const r = parts[0] || 0;
  const g = parts[1] || 0;
  const b = parts[2] || 0;
  return (
    "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

// Normalize color token (hex or rgb) to hex format
function normalizeColorToken(tok) {
  if (!tok) return null;
  tok = tok.trim();
  if (tok.startsWith("#")) return tok;
  if (tok.startsWith("rgb")) return rgbStringToHex(tok);
  return null;
}

// Parse all colors from CSS background gradient string
function parseColorsFromBackground(bg) {
  if (!bg) return [];
  const re = /(rgba?\([^)]+\)|#[0-9a-fA-F]{3,6})/g;
  const out = [];
  let m;
  while ((m = re.exec(bg)) !== null) {
    const hex = normalizeColorToken(m[1]);
    if (hex) out.push(hex);
  }
  return out;
}

// Get primary color for brainwave band (alpha, delta, theta, etc.)
// STRATEGY 1: Check CSS variable --band-{key}-primary (preferred, robust)
// STRATEGY 2: Probe computed background of temporary element (fallback, legacy)
function getPrimaryColorForBand(band) {
  if (!band) return null;
  const key = String(band).toLowerCase();
  
  // STRATEGY 1: Try CSS variables first (robust and independent of gradient parsing)
  try {
    const root = getComputedStyle(document.documentElement);
    const varName = `--band-${key}-primary`;
    const val = root.getPropertyValue(varName).trim();
    if (val) {
      // Normalize rgb(...) to hex if necessary
      const normalized = normalizeColorToken(val) || val;
      bandColorCache[key] = [normalized];
      return normalized;
    }
  } catch (e) {
    // Continue to fallback strategy
  }

  // STRATEGY 2: Fallback - probe computed background of temporary element (legacy)
  if (bandColorCache[key]) return bandColorCache[key][0] || null;
  
  // Create temporary element with band class to query computed styles
  const temp = document.createElement("div");
  temp.className = "jm-box plateau " + key;
  temp.style.position = "absolute";
  temp.style.left = "-9999px";
  temp.style.top = "-9999px";
  temp.style.visibility = "hidden";
  document.body.appendChild(temp);
  
  const comp = window.getComputedStyle(temp);
  const bg = comp.backgroundImage || comp.background || "";
  const colors = parseColorsFromBackground(bg);
  document.body.removeChild(temp);
  
  bandColorCache[key] = colors;
  return colors[0] || null;
}

// Click-to-loop feature now imported from journeymap_onclick.js
// Initialize API for external use
initClickToLoopAPI();

// ==============================================
// INIT JOURNEYMAP - Main Widget Entry Point
// ==============================================
// NOTE: createPresetController extracted to journeymap_ui.js (393 lines)
// (Widget orchestration below continues to use the imported function)

export async function initJourneyMap() {
  // console.log('Logger integrated: initJourneyMap started'); // Reduced console spam

  const presetDisplay = document.getElementById('jm-preset-selector');
  const presetPrev = document.getElementById("preset-prev");
  const presetNext = document.getElementById("preset-next");
  const journeySequence = document.querySelector(".journey-sequence");
  const totalBox = document.getElementById("totaltime");

  // Debug: Check if elements are found
  // Element checking logs commented out to reduce console spam
  // console.log('Journey Map Elements Check:');
  // console.log('- renderBtn:', renderBtn);
  // console.log('- presetDisplay:', presetDisplay);
  // console.log('- presetPrev:', presetPrev);
  // console.log('- presetNext:', presetNext);
  // console.log('- journeySequence:', journeySequence);
  // console.log('- totalBox:', totalBox);

  if (!presetDisplay || !presetPrev || !presetNext) {
    console.error('Critical journey map elements not found!');
    console.log('All elements with id containing "preset":', 
      Array.from(document.querySelectorAll('[id*="preset"]')).map(el => ({id: el.id, element: el}))
    );
    console.error('Cannot initialize journey map preset functionality');
    return;
  }

  let presets = [];
  let currentPresetIndex = 0;
  let currentPresetData = null;
  let currentPresetFilename = null;

  // Wire up the preset controller (moved to journeymap_presets.js)
  const saveBtn = document.getElementById('save-preset');
  const revertBtn = document.getElementById('revert-preset');
  const saveModal = document.getElementById('save-modal');
  const modalSaveNew = document.getElementById('modal-save-new');
  const modalOverwrite = document.getElementById('modal-overwrite');
  const modalBack = document.getElementById('modal-back');
  const presetNameInput = document.getElementById('preset-name');
  const nameCount = document.getElementById('name-count');

  // create the controller which will call our renderPreset and use our getters
  await createPresetController({
    presetDisplay,
    presetPrev,  // Use the already-fetched elements
    presetNext,  // Use the already-fetched elements
    journeySequence,
    saveBtn,
    revertBtn,
    saveModal,
    modalSaveNew,
    modalOverwrite,
    modalBack,
    presetNameInput,
    nameCount,
    renderPreset: async (name) => await renderPreset(name),
    getCurrentPreset: () => currentPresetData,
    getCurrentPresetData: () => currentPresetData,
    getCurrentPresetFilename: () => currentPresetFilename,
  });
  // expose a tiny bridge so the binaural widget can access current preset info
  // without the journey map being responsible for binaural playback UI wiring.
  window.JourneyMapAPI = window.JourneyMapAPI || {};
  window.JourneyMapAPI.getCurrentPreset = () => currentPresetData;
  window.JourneyMapAPI.getCurrentPresetData = () => currentPresetData;
  window.JourneyMapAPI.getCurrentPresetFilename = () => currentPresetFilename;
  window.JourneyMapAPI.renderPreset = async (name) => await renderPreset(name);

  // console.log('journeymap_widget: JourneyMapAPI bridge installed');

  // Note: rootkey UI is owned and initialized by the binaural widget.
  // Do not initialize rootkey here — that would duplicate the control.

  presetPrev.addEventListener("click", async () => {
    if (presets.length > 0) {
      currentPresetIndex =
        (currentPresetIndex - 1 + presets.length) % presets.length;
      presetDisplay.textContent = presets[currentPresetIndex];
      await renderPreset(presets[currentPresetIndex]);
    }
  });

  presetNext.addEventListener("click", async () => {
    if (presets.length > 0) {
      currentPresetIndex = (currentPresetIndex + 1) % presets.length;
      presetDisplay.textContent = presets[currentPresetIndex];
      await renderPreset(presets[currentPresetIndex]);
    }
  });

  // ==============================================
  // DOM RENDERING - Build Journey Sequence HTML
  // ==============================================
  // PURPOSE: Render timeline segments as .jm-box elements in journey sequence
  // INPUT: Preset name (string) OR preset object (with segments array)
  // OUTPUT: Populated .journey-sequence container with plateau/transition boxes
  //
  // PATTERN: Load preset → Parse segments → Build DOM → Attach handlers
  // CSS COMPLIANCE: All styling via CSS classes (never inline styles)
  // VISUAL STRUCTURE:
  // - .jm-box.plateau.{band} - Sustained Hz segments (DELTA, THETA, etc.)
  // - .jm-box.transition - Hz ramp segments (with envelope SVG)
  // - Edge gradients via .first-plateau and .last-plateau classes
  //
  // DRAG HANDLERS: Attached for real-time Hz and duration editing
  // CLICK HANDLERS: Attached for click-to-loop feature
  // TOTAL TIME: Calculated and displayed in footer
  //
  // EXTRACTION CANDIDATE: Core of journeymap_timeline.js module
  // ==============================================
  
  async function renderPreset(nameOrObject) {
    try {
      let data;
      
      // Accept either preset name (load from disk) or preset object (already loaded)
      if (typeof nameOrObject === 'string') {
        data = await loadRecipe(nameOrObject);
        currentPresetFilename = nameOrObject;
      } else if (nameOrObject && typeof nameOrObject === 'object') {
        data = nameOrObject;
        currentPresetFilename = data.name || null;
      } else {
        throw new Error('renderPreset requires a filename or preset object');
      }
      
      // Normalize currentPresetData structure (ensure payload.segments exists)
      // Supports both legacy format (top-level segments) and new format (payload.segments)
      currentPresetData = Object.assign({}, data);
      if (!currentPresetData.payload && Array.isArray(currentPresetData.segments)) {
        currentPresetData.payload = { segments: currentPresetData.segments };
      }
      
      // Clear existing timeline and prepare for render
      journeySequence.innerHTML = "";
      const segments = data.segments || (data.payload && data.payload.segments) || [];
      let totalMinutes = 0;
      
      // Determine first and last plateau indices (for edge gradient styling)
      // First plateau gets left gradient, last plateau gets right gradient
      const firstPlateauIdx = segments.findIndex((s) => s.type === "plateau");
      let lastPlateauIdx = -1;
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].type === "plateau") {
          lastPlateauIdx = i;
          break;
        }
      }

      // Helper functions now imported from journeymap_timeline.js
      // - darkenHex: Create darker shade for transition gradients  
      // - updateTotalDisplay: Recalculate total journey time
      // - attachDragHz: Real-time frequency adjustment
      // - attachDragMinutes: Segment duration editing
      // - getWaveType: Hz to brain wave band mapping
      // ==============================================

      // ==============================================
      // BOX CREATION LOOP - Build Timeline Elements
      // ==============================================
      // PURPOSE: Iterate segments and create .jm-box elements for plateaus/transitions
      // PATTERN: For each segment → Create box div → Add labels → Attach handlers → Append to DOM
      // CSS COMPLIANCE: All styling via classes (delta, theta, alpha, smr, beta, first-plateau, last-plateau)
      // EXTRACTION CANDIDATE: Core of journeymap_timeline.js module
      segments.forEach((segment, idx) => {
        totalMinutes += segment.duration_min || 0;

        if (segment.type === "plateau") {
          const box = document.createElement("div");
          box.className = "jm-box plateau";
          if (idx === firstPlateauIdx) box.classList.add("first-plateau");
          if (idx === lastPlateauIdx) box.classList.add("last-plateau");
          const waveType = getWaveType(segment.hz);

          const label = document.createElement("div");
          label.className = "label";
          label.textContent = waveType;
          label.setAttribute('data-text', waveType);

          const freq = document.createElement("div");
          freq.className = "freq";
          freq.textContent = `${segment.hz}hz`;
          freq.setAttribute('data-text', `${segment.hz}hz`);

          // make non-selectable and draggable
          freq.style.cursor = "ns-resize";
          freq.style.userSelect = "none";
          freq.style.webkitUserSelect = "none";

          const duration = document.createElement("div");
          duration.className = "duration";
          duration.textContent = `${segment.duration_min}m`;
          duration.setAttribute('data-text', `${segment.duration_min}m`);

          duration.style.cursor = "ns-resize";
          duration.style.userSelect = "none";
          duration.style.webkitUserSelect = "none";

          // Assemble plateau box (label + freq + duration)
          box.appendChild(label);
          box.appendChild(freq);
          box.appendChild(duration);

          // Attach drag handlers (Hz and duration editors) - imported from journeymap_timeline.js
          attachDragHz(freq, segment, box, label, idx, firstPlateauIdx, lastPlateauIdx);
          attachDragMinutes(duration, segment, journeySequence, totalBox);

          // CSS COMPLIANCE: Add band class (delta, theta, alpha, smr, beta)
          // CSS variables (--delta-color, --theta-color, etc.) control colors
          const band = waveType.toLowerCase();
          if (band) box.classList.add(band);
          
          // CSS COMPLIANCE: Add edge gradient classes (first/last plateau special styling)
          if (idx === firstPlateauIdx) {
            box.classList.add("first-plateau");
          } else if (idx === lastPlateauIdx) {
            box.classList.add("last-plateau");
          }
          box.style.background = ""; // Clear inline styles, CSS takes control
          
          // Store segment data attributes (for click-to-loop + debugging)
          box.dataset.segmentIndex = idx;
          box.dataset.segmentType = 'plateau';
          box.dataset.hz = segment.hz;
          box.dataset.duration = segment.duration_min;
          
          // Add click-to-loop handler (BBF "fidget toy")
          box.addEventListener('click', (e) => {
            // Ignore clicks on draggable elements (freq/duration editing takes precedence)
            if (e.target.classList.contains('freq') || e.target.classList.contains('duration')) {
              return;
            }
            handleBoxClick(box, segment, idx);
          });
          
          journeySequence.appendChild(box);
        } else if (segment.type === "transition") {
          // ==============================================
          // TRANSITION BOX CREATION - Visual Sweep Between Plateaus
          // ==============================================
          // PURPOSE: Show frequency sweep from prev plateau Hz to next plateau Hz
          // PATTERN: Create box → Derive prev/next wave types → Apply CSS classes
          // CSS COMPLIANCE: Uses transition class (e.g., "delta-theta") + CSS gradients
          // NO DRAGGING: Transitions are fixed-duration sweeps (not user-adjustable)
          const next = document.createElement("div");
          next.className = "jm-box transition";

          // Derive wave types from adjacent plateaus
          const prevHz = segments[idx - 1]?.hz;
          const nextHz = segments[idx + 1]?.hz;
          const prevWave = getWaveType(prevHz);
          const nextWave = getWaveType(nextHz);
          
          // CSS COMPLIANCE: Add transition class (e.g., "delta-theta" triggers CSS gradient)
          const prevBand = (prevWave || "").toLowerCase();
          const nextBand = (nextWave || "").toLowerCase();
          const transitionClass = `${prevBand}-${nextBand}`;
          next.classList.add(transitionClass);
          next.style.background = ""; // Clear inline styles, CSS takes control

          // Add sine wave envelope graphic (visual representation of sweep)
          const img = document.createElement("img");
          img.src = "assets/sine_env.svg";
          img.className = "env";
          // Determine sweep direction (up = increasing Hz, down = decreasing Hz)
          const shape = (nextHz || 0) > (prevHz || 0) ? "up" : "down";
          img.classList.add(shape);

          // Add duration label (transitions can be dragged to adjust sweep time)
          const duration = document.createElement("div");
          duration.className = "duration";
          duration.textContent = `${segment.duration_min}m`;
          duration.setAttribute('data-text', `${segment.duration_min}m`);

          // Make duration draggable (same pattern as plateau durations)
          duration.style.cursor = "ns-resize";
          duration.style.userSelect = "none";
          duration.style.webkitUserSelect = "none";

          // Assemble transition box (sine graphic + duration)
          next.appendChild(img);
          next.appendChild(duration);

          // Attach drag handler for transition duration
          attachDragMinutes(duration, segment);
          
          // Store segment data attributes (for click-to-loop + debugging)
          next.dataset.segmentIndex = idx;
          next.dataset.segmentType = 'transition';
          next.dataset.duration = segment.duration_min;
          
          // Add click-to-loop handler for transitions
          // BEHAVIOR: Clicking transition plays transition + loops destination plateau
          next.addEventListener('click', (e) => {
            // Ignore clicks on duration element (editing takes precedence)
            if (e.target.classList.contains('duration')) {
              return;
            }
            handleBoxClick(next, segment, idx);
          });
          
          journeySequence.appendChild(next);
        }
      });

      // Update total time display (sum of all durations)
      if (totalBox)
        totalBox.textContent = `Total Time: ${totalMinutes} minutes`;
      
      // ==============================================
      // PRESET LOAD EVENTS - Notify Other Systems
      // ==============================================
      // PURPOSE: Broadcast preset change to adaptive background + audio systems
      // PATTERN: Dispatch CustomEvents with timeline + preset data
      // LISTENERS: adaptive_background.js (color updates), audio synths (pre-scheduling)
      
      // Event 1: Adaptive background (immediate color update)
      document.dispatchEvent(new CustomEvent('presetSelected', {
        detail: { preset: currentPresetData, segments }
      }));
      
      // Event 2: Journey restart (synth pre-schedules Hz automation + Transport BPM map)
      // CRITICAL: This is how isochronic pulses stay synced to Hz throughout journey
      window.dispatchEvent(new CustomEvent('journeymapRestart', {
        detail: { 
          timeline: { segments },
          preset: currentPresetData 
        }
      }));
      
    } catch (err) {
      console.error(err);
      if (debugPanel)
        debugPanel.textContent = `Error loading preset ${name}: ${err.message}`;
    }
  }

  // getWaveType function now imported from journeymap_timeline.js

  // PUBLIC API: Read current journeymap segment values from DOM
  // This function is called by the controller to get live journey data for playback
  window.JourneymapWidget = window.JourneymapWidget || {};
  window.JourneymapWidget.collectJourneyDataFromDOM = function() {
    const segments = [];
    
    // Find all segment elements in the journey sequence
    const segmentElements = document.querySelectorAll('.segment, [data-segment-type], .jm-box');
    
    segmentElements.forEach((element, index) => {
      // Determine segment type
      let segmentType = element.dataset.segmentType;
      if (!segmentType) {
        if (element.classList.contains('plateau')) {
          segmentType = 'plateau';
        } else if (element.classList.contains('transition')) {
          segmentType = 'transition';
        } else {
          // Fallback - shouldn't happen with proper markup
          return;
        }
      }
      
      let hz = 0;
      let duration_min = 1;
      
      // Extract Hz from plateau segments (transitions don't have Hz)
      if (segmentType === 'plateau') {
        const hzElement = element.querySelector('.freq, input[type="number"], .hz-input, [data-hz]');
        if (hzElement) {
          const hzText = hzElement.textContent || hzElement.value || hzElement.dataset.hz || '0';
          hz = parseFloat(hzText.replace(/[^0-9.]/g, '')) || 0;
        }
      }
      
      // Extract duration from all segments
      const durationElement = element.querySelector('.duration, .duration-input, [data-duration]');
      if (durationElement) {
        const durText = durationElement.textContent || durationElement.value || durationElement.dataset.duration || '1';
        duration_min = parseFloat(durText.replace(/[^0-9.]/g, '')) || 1;
      }
      
      segments.push({
        type: segmentType,
        hz: hz,
        duration_min: duration_min,
        envelope_type: 'linear'
      });
    });
    
    return segments.length > 0 ? { segments } : null;
  };
  
  // ===== JOURNEY MAP PROGRESS TIMER =====
  // Update title with elapsed/total time during playback (debugging/troubleshooting)
  // COMMENTED OUT: May want back later for development/debug
  /*
  const titleElement = document.querySelector('.journey-title');
  let timerInterval = null;
  let startTime = 0;
  
  function updateTitleWithProgress() {
    if (!titleElement || !totalBox) return;
    
    const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes
    const totalText = totalBox.textContent || '';
    const totalMatch = totalText.match(/(\d+)\s*minutes?/);
    const totalMinutes = totalMatch ? parseInt(totalMatch[1]) : 0;
    
    titleElement.textContent = `Journey Map (${elapsed.toFixed(1)}m of ${totalMinutes}m)`;
  }
  
  function startProgressTimer() {
    if (timerInterval) return; // Already running
    startTime = Date.now();
    updateTitleWithProgress();
    timerInterval = setInterval(updateTitleWithProgress, 100); // Update 10x per second
    console.log('🕐 Journey Map progress timer started');
  }
  
  function stopProgressTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
      if (titleElement) {
        titleElement.textContent = 'Journey Map'; // Reset to default
      }
      console.log('⏸️ Journey Map progress timer stopped');
    }
  }
  
  // Listen for transport play/stop events
  window.addEventListener('transportPlay', startProgressTimer);
  window.addEventListener('transportStop', stopProgressTimer);
  
  console.log('✅ Journey Map progress timer initialized');
  */
}
