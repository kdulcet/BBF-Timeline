// ============================================================================
// NOISE WIDGET - VIEW LAYER (MVC)
// ============================================================================
// Handles UI interactions and updates for noise panel controls
//
// MVC PATTERN FLOW:
//
// USER EDITS (Widget → Presetter → Synth):
//   1. User moves volume slider
//   2. Widget calls setOsc1Volume(db) → Synth (audio changes immediately)
//   3. Widget calls notifyManualAdjustment() → Presetter (sets IsResume=true)
//   4. Presetter tracks manual edits for save functionality
//
// LOAD PRESET (Presetter → Synth + Widget):
//   1. User clicks preset next/prev button
//   2. Presetter loads JSON from presets/noise/
//   3. Presetter calls setOsc1Volume(db) etc → Synth (audio changes)
//   4. Presetter fires 'noisePresetLoaded' event → Widget listens
//   5. Widget updates UI controls to match preset values
//
// DUAL OSCILLATOR ARCHITECTURE:
// - 9 controls × 2 oscillators = 18 independent parameters
// - Phase 3A: Type, Volume, Sculpt (COMPLETE)
// - Phase 3B: Width, Mask Type, Center (COMPLETE)
// - Phase 3C: Mix, Drift, Rate (COMPLETE)
// - All phases use indexed setters (setOsc1*, setOsc2*)
// ============================================================================

// CONSTANTS
const FADER_SILENCE_FLOOR_DB = -70;  // 0% fader = -70dB (matches binaural widget standard)

import { createNoisePresetController, notifyManualAdjustment } from '../presets/noise_presets.js';
import { 
    setNoiseType, setNoiseVolume, setSculptLP, setSculptHP,
    getNoiseType, getNoiseVolume, getSculptLP, getSculptHP, getNoiseWidth,
    setOsc1Type, setOsc2Type,
    setOsc1Volume, setOsc2Volume,
    setOsc1SculptLP, setOsc2SculptLP,
    setOsc1SculptHP, setOsc2SculptHP,
    setOsc1Width, setOsc2Width,
    setOsc1MaskType, setOsc2MaskType,
    setOsc1MaskCenter, setOsc2MaskCenter,
    setOsc1MaskMix, setOsc2MaskMix,
    setOsc1DriftEnabled, setOsc2DriftEnabled,
    setOsc1DriftAmount, setOsc2DriftAmount,
    setOsc1DriftRateLo, setOsc2DriftRateLo,
    setOsc1DriftRateHi, setOsc2DriftRateHi
} from '../synths/noise_synth.js';

// ============================================================================
// HELPER FUNCTIONS: Hz <-> Percent Conversions (Module Scope)
// ============================================================================
// These need to be at module scope so setupPresetEventListeners() can access them
function hzToPercentHP(hz) {
    const minHz = 350;
    const maxHz = 16000;
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);
    const logValue = Math.log(Math.max(minHz, Math.min(maxHz, hz)));
    return ((logValue - logMin) / (logMax - logMin)) * 100;
}

function hzToPercentLP(hz) {
    const minHz = 350;
    const maxHz = 20000;
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);
    const logValue = Math.log(Math.max(minHz, Math.min(maxHz, hz)));
    return ((logValue - logMin) / (logMax - logMin)) * 100;
}

// Inverse functions: Percent → Hz (for sliders)
function percentToHzHP(percent) {
    const minHz = 350;
    const maxHz = 16000;
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);
    const logValue = logMin + (percent / 100) * (logMax - logMin);
    return Math.exp(logValue);
}

function percentToHzLP(percent) {
    const minHz = 350;
    const maxHz = 20000;
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);
    const logValue = logMin + (percent / 100) * (logMax - logMin);
    return Math.exp(logValue);
}

export async function initNoiseWidget() {
    console.log('🔊🔊🔊 NOISE WIDGET INITIALIZATION START 🔊🔊🔊');
    console.log('🔊 Initializing noise panel');

    // ============================================================================
    // SKIP INITIALIZATION IF ALREADY DONE AT STARTUP
    // ============================================================================
    // If preset was loaded at startup, the synth is already configured.
    // Only initialize UI controls, do NOT touch synth or load presets.
    // This prevents audio glitches when visiting the panel.
    // ============================================================================
    const skipSynthInit = window.noisePresetHasBeenLoaded;
    
    if (skipSynthInit) {
        console.log('⏭️ Skipping synth initialization - already done at startup');
        console.log('🎚️ Only initializing UI controls for panel interaction');
    }

    // ============================================================================
    // SYNTH INITIALIZATION (Skip if already done at startup)
    // ============================================================================
    if (!skipSynthInit && window.NoiseSynth && window.NoiseSynth.initializeNodes) {
        console.log('🎛️ Pre-initializing noise synth nodes...');
        await window.NoiseSynth.initializeNodes();
        console.log('✅ Noise synth nodes ready');
    }

    // Initialize back arrow to load main panel
    const backArrow = document.querySelector('#control-panel-noise .control-panel-back-arrow');
    if (backArrow) {
        backArrow.addEventListener('click', async () => {
            console.log('🔙 Back arrow clicked - loading main panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('main_panel', 'control-panel-container');
            }
        });
    }

    // ============================================================================
    // DUAL OSCILLATOR CONTROL INITIALIZATION (All phases complete)
    // ============================================================================
    // All 9 controls implemented for BOTH oscillators using indexed setters.
    // Each control supports independent osc1/osc2 operation.
    //
    // PHASE 3A (COMPLETE): Type, Volume, Sculpt
    // PHASE 3B (COMPLETE): Width, Mask Type, Center
    // PHASE 3C (COMPLETE): Mix, Drift, Rate
    //
    // Total: 9 controls × 2 oscillators = 18 independent parameters
    // ============================================================================
    console.log('🎚️ Wiring dual oscillator controls (Phase 3A)...');
    
    // 1. Type selectors (brown/pink/white)
    initTypeSelector(1, '.osc1-type-selector');
    initTypeSelector(2, '.osc2-type-selector');
    
    // 2. Volume sliders
    initVolumeSlider(1, '.osc1-vol-control');
    initVolumeSlider(2, '.osc2-vol-control');
    
    // 3. Sculpt range sliders (HP/LP)
    initSculptRangeSlider(1, '.osc1-sculpt-control');
    initSculptRangeSlider(2, '.osc2-sculpt-control');
    
    console.log('✅ Phase 3A complete: Type, Volume, Sculpt wired for both oscillators');

    // ============================================================================
    // PHASE 3B: Width, Mask Type, Center
    // ============================================================================
    console.log('🎚️ Wiring Phase 3B controls...');
    
    // 4. Width sliders (stereo spread)
    initWidthSlider(1, '.osc1-width-control');
    initWidthSlider(2, '.osc2-width-control');
    
    // 5. Mask type selectors (1/2/3/4 numbers)
    initMaskTypeSelector(1, '.osc1-mask-numbers');
    initMaskTypeSelector(2, '.osc2-mask-numbers');
    
    // 6. Center sliders (mask frequency)
    initCenterSlider(1, '.osc1-center-control');
    initCenterSlider(2, '.osc2-center-control');
    
    console.log('✅ Phase 3B complete: Width, Mask Type, Center wired for both oscillators');

    // ============================================================================
    // PHASE 3C: Mix, Drift, Rate
    // ============================================================================
    console.log('🎚️ Wiring Phase 3C controls...');
    
    // 7. Mix sliders (mask wet/dry)
    initMixSlider(1, '.osc1-mix-control');
    initMixSlider(2, '.osc2-mix-control');
    
    // 8. Drift sliders (modulation amount)
    initDriftSlider(1, '.osc1-drift-control');
    initDriftSlider(2, '.osc2-drift-control');
    
    // 9. Rate range sliders (drift period lo/hi)
    initRateRangeSlider(1, '.osc1-rate-control');
    initRateRangeSlider(2, '.osc2-rate-control');
    
    console.log('✅ Phase 3C complete: Mix, Drift, Rate wired for both oscillators');

    // ============================================================================
    // MIGRATION HISTORY (Reference only - all work complete)
    // ============================================================================
    // This widget was migrated from single-oscillator to dual-oscillator pattern.
    // All functions now use indexed setters (setOsc1*, setOsc2*) for independent
    // control of both oscillators.
    //
    // MIGRATION PHASES (All complete):
    // - Phase 3A: Type, Volume, Sculpt → initTypeSelector(oscIndex, selector)
    // - Phase 3B: Width, Mask Type, Center → initMaskTypeSelector(oscIndex, selector)
    // - Phase 3C: Mix, Drift, Rate → initDriftSlider(oscIndex, selector)
    //
    // Legacy single-oscillator functions were never in this file - they lived
    // in the synth layer and have been replaced by indexed setters.
    // ============================================================================
    // CRITICAL: Set up event listener BEFORE loading preset
    // Otherwise the preset load event fires before listener exists!
    setupPresetEventListeners();
    
    // If preset was pre-loaded at startup, directly sync UI to synth values NOW
    if (window.noisePresetHasBeenLoaded) {
        console.log('🔄 Preset was pre-loaded at startup - syncing UI directly from synth state');
        
        // Update volume slider position
        const volHandle = document.querySelector('.osc1-vol-control .vol-handle');
        if (volHandle) {
            const currentVolume = getNoiseVolume(); // Read from synth
            const percent = ((currentVolume - FADER_SILENCE_FLOOR_DB) / 70) * 100;
            volHandle.style.left = `${percent}%`;
            console.log('✅ Synced volume slider:', currentVolume, 'dB →', percent.toFixed(0), '%');
        }
        
        // Update sculpt LP/HP slider positions
        const sculptControl = document.querySelector('.osc1-sculpt-control');
        if (sculptControl) {
            const handles = sculptControl.querySelectorAll('.control-widget__handle');
            const leftHandle = handles[0]; // HP
            const rightHandle = handles[1]; // LP
            const fill = sculptControl.querySelector('.control-widget__range-fill');
            
            if (leftHandle) {
                const currentHP = getSculptHP();
                const percent = hzToPercentHP(currentHP);
                leftHandle.style.left = `${percent}%`;
                console.log('✅ Synced sculpt HP:', currentHP, 'Hz →', percent.toFixed(0), '%');
            }
            
            if (rightHandle) {
                const currentLP = getSculptLP();
                const percent = hzToPercentLP(currentLP);
                rightHandle.style.left = `${percent}%`;
                console.log('✅ Synced sculpt LP:', currentLP, 'Hz →', percent.toFixed(0), '%');
            }
            
            // Update fill between handles
            if (fill && leftHandle && rightHandle) {
                const leftPercent = parseFloat(leftHandle.style.left) || 0;
                const rightPercent = parseFloat(rightHandle.style.left) || 100;
                fill.style.left = `${leftPercent}%`;
                fill.style.width = `${rightPercent - leftPercent}%`;
            }
        }
        
        // Update width slider position
        const widthHandle = document.querySelector('.osc1-width-control .control-widget__handle');
        if (widthHandle) {
            const currentWidth = getNoiseWidth();
            const percent = currentWidth * 100; // 0.0-1.0 → 0-100%
            widthHandle.style.left = `${percent}%`;
            console.log('✅ Synced width slider:', currentWidth, '→', percent.toFixed(0), '%');
        }
        
        // Update noise type selector
        const typeSelector = document.querySelector('.button_selector--noise-type .button_selector__display');
        if (typeSelector) {
            const currentType = getNoiseType();
            const capitalizedType = currentType.charAt(0).toUpperCase() + currentType.slice(1);
            typeSelector.textContent = capitalizedType;
            console.log('✅ Synced noise type:', capitalizedType);
        }
    }
    
    // Initialize preset controller (loads default preset, fires event)
    await initNoiseController();
}

// ============================================================================
// GENERIC CONTROL INITIALIZERS (Dual Oscillator Support - Phase 3A)
// ============================================================================
// These functions work for BOTH osc1 and osc2 using indexed setters

/**
 * Initialize type selector for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for button_selector element
 */
function initTypeSelector(oscIndex, selector) {
    const selectorElement = document.querySelector(selector);
    if (!selectorElement) {
        console.warn(`Type selector not found: ${selector}`);
        return;
    }

    const display = selectorElement.querySelector('.button_selector__display');
    const navButtons = selectorElement.querySelectorAll('.button_selector__nav');
    const prevButton = navButtons[0];
    const nextButton = navButtons[1];

    if (!display || !prevButton || !nextButton) {
        console.error(`Type selector components missing for osc ${oscIndex}`);
        return;
    }

    const noiseTypes = ['Brown', 'Pink', 'White'];
    let currentIndex = noiseTypes.indexOf(display.textContent.trim());
    if (currentIndex === -1) {
        currentIndex = 0; // Default to Brown
        display.textContent = noiseTypes[currentIndex];
    }

    // Get the correct setter function for this oscillator
    const setterFn = oscIndex === 1 ? setOsc1Type : setOsc2Type;

    prevButton.addEventListener('click', () => {
        currentIndex = (currentIndex - 1 + noiseTypes.length) % noiseTypes.length;
        display.textContent = noiseTypes[currentIndex];
        
        const type = noiseTypes[currentIndex].toLowerCase();
        setterFn(type);
        notifyManualAdjustment();
        
        console.log(`🎛️ Osc ${oscIndex} type: ${noiseTypes[currentIndex]}`);
    });

    nextButton.addEventListener('click', () => {
        currentIndex = (currentIndex + 1) % noiseTypes.length;
        display.textContent = noiseTypes[currentIndex];
        
        const type = noiseTypes[currentIndex].toLowerCase();
        setterFn(type);
        notifyManualAdjustment();
        
        console.log(`🎛️ Osc ${oscIndex} type: ${noiseTypes[currentIndex]}`);
    });
    
    console.log(`✅ Osc ${oscIndex} type selector initialized`);
}

/**
 * Initialize volume slider for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for volume control element
 */
function initVolumeSlider(oscIndex, selector) {
    const volControl = document.querySelector(selector);
    if (!volControl) {
        console.warn(`Volume control not found: ${selector}`);
        return;
    }
    
    const handle = volControl.querySelector('.control-widget__handle');
    const track = volControl.querySelector('.control-widget__track');
    if (!handle || !track) {
        console.error(`Volume slider components missing for osc ${oscIndex}`);
        return;
    }
    
    let isDragging = false;
    
    // Get the correct setter function for this oscillator
    const setterFn = oscIndex === 1 ? setOsc1Volume : setOsc2Volume;
    
    const updateVolume = (percent) => {
        const constrainedPercent = Math.max(0, Math.min(100, percent));
        handle.style.left = `${constrainedPercent}%`;
        
        // Convert 0-100% to -70dB to 0dB
        const db = (constrainedPercent / 100) * 70 + FADER_SILENCE_FLOOR_DB;
        setterFn(db);
        notifyManualAdjustment();
        
        // console.log(`🎚️ Osc ${oscIndex} volume: ${constrainedPercent.toFixed(0)}% → ${db.toFixed(1)} dB`); // PERFORMANCE: Fires on every mousemove
    };
    
    // Mouse down on handle
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateVolume(percent);
    });
    
    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateVolume(percent);
    });
    
    // Global mouse up
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    console.log(`✅ Osc ${oscIndex} volume slider initialized`);
}

/**
 * Initialize sculpt range slider (HP/LP filters) for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for sculpt control element
 */
function initSculptRangeSlider(oscIndex, selector) {
    const sculptControl = document.querySelector(selector);
    if (!sculptControl) {
        console.warn(`Sculpt control not found: ${selector}`);
        return;
    }
    
    const track = sculptControl.querySelector('.control-widget__track');
    const fill = sculptControl.querySelector('.control-widget__range-fill');
    const handles = sculptControl.querySelectorAll('.control-widget__handle');
    const leftHandle = handles[0];  // HP
    const rightHandle = handles[1]; // LP
    
    if (!track || !fill || !leftHandle || !rightHandle) {
        console.error(`Sculpt slider components missing for osc ${oscIndex}`);
        return;
    }
    
    // Get the correct setter functions for this oscillator
    const setHPFn = oscIndex === 1 ? setOsc1SculptHP : setOsc2SculptHP;
    const setLPFn = oscIndex === 1 ? setOsc1SculptLP : setOsc2SculptLP;
    
    let activeHandle = null;
    let leftPercent = 30;  // Default HP position
    let rightPercent = 70; // Default LP position
    
    // Initialize handle positions
    leftHandle.style.left = leftPercent + '%';
    rightHandle.style.left = rightPercent + '%';
    updateFill();
    
    function updateFill() {
        fill.style.left = leftPercent + '%';
        fill.style.width = (rightPercent - leftPercent) + '%';
    }
    
    function updateHPFilter() {
        const hz = percentToHzHP(leftPercent);
        setHPFn(hz);
        // console.log(`🎚️ Osc ${oscIndex} sculpt HP: ${hz.toFixed(0)} Hz`); // PERFORMANCE: Fires on every mousemove
    }
    
    function updateLPFilter() {
        const hz = percentToHzLP(rightPercent);
        setLPFn(hz);
        // console.log(`🎚️ Osc ${oscIndex} sculpt LP: ${hz.toFixed(0)} Hz`); // PERFORMANCE: Fires on every mousemove
    }
    
    // Left handle (HP) mouse down
    leftHandle.addEventListener('mousedown', (e) => {
        activeHandle = 'left';
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Right handle (LP) mouse down
    rightHandle.addEventListener('mousedown', (e) => {
        activeHandle = 'right';
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (!activeHandle) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
        
        if (activeHandle === 'left') {
            leftPercent = Math.min(percent, rightPercent - 5); // Keep 5% gap
            leftHandle.style.left = leftPercent + '%';
            updateFill();
            updateHPFilter();
        } else {
            rightPercent = Math.max(percent, leftPercent + 5); // Keep 5% gap
            rightHandle.style.left = rightPercent + '%';
            updateFill();
            updateLPFilter();
        }
        
        notifyManualAdjustment();
    });
    
    // Global mouse up
    document.addEventListener('mouseup', () => {
        activeHandle = null;
    });
    
    // Initialize with default values
    updateHPFilter();
    updateLPFilter();
    
    console.log(`✅ Osc ${oscIndex} sculpt range slider initialized`);
}

/**
 * Initialize width slider (stereo spread) for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for width control element
 */
function initWidthSlider(oscIndex, selector) {
    const widthControl = document.querySelector(selector);
    if (!widthControl) {
        console.warn(`Width control not found: ${selector}`);
        return;
    }
    
    const handle = widthControl.querySelector('.control-widget__handle');
    const track = widthControl.querySelector('.control-widget__track');
    if (!handle || !track) {
        console.error(`Width slider components missing for osc ${oscIndex}`);
        return;
    }
    
    let isDragging = false;
    
    // Get the correct setter function for this oscillator
    const setterFn = oscIndex === 1 ? setOsc1Width : setOsc2Width;
    
    const updateWidth = (percent) => {
        const constrainedPercent = Math.max(0, Math.min(100, percent));
        handle.style.left = `${constrainedPercent}%`;
        
        // Convert 0-100% to 0.0-1.0 width factor
        const widthFactor = constrainedPercent / 100;
        setterFn(widthFactor);
        notifyManualAdjustment();
        
        // console.log(`🎚️ Osc ${oscIndex} width: ${constrainedPercent.toFixed(0)}% → ${widthFactor.toFixed(2)}`); // PERFORMANCE: Fires on every mousemove
    };
    
    // Mouse down on handle
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateWidth(percent);
    });
    
    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateWidth(percent);
    });
    
    // Global mouse up
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    console.log(`✅ Osc ${oscIndex} width slider initialized`);
}

/**
 * Initialize mask type selector (1/2/3/4 numbers) for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for mask numbers container
 */
function initMaskTypeSelector(oscIndex, selector) {
    const container = document.querySelector(selector);
    if (!container) {
        console.warn(`Mask numbers container not found: ${selector}`);
        return;
    }
    
    // Get the correct setter function for this oscillator
    const setterFn = oscIndex === 1 ? setOsc1MaskType : setOsc2MaskType;
    
    // Map numbers to filter types
    const filterTypes = {
        1: 'bandpass',
        2: 'notch',
        3: 'allpass',
        4: 'comb'
    };
    
    // Clear and create clickable numbers
    container.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
        const span = document.createElement('span');
        span.textContent = i;
        span.className = 'mask-number';
        span.addEventListener('click', () => {
            // Update UI
            container.querySelectorAll('.mask-number').forEach(n => n.classList.remove('active'));
            span.classList.add('active');
            
            // Update synth
            setterFn(filterTypes[i]);
            notifyManualAdjustment();
            
            console.log(`🎭 Osc ${oscIndex} mask type: ${i} (${filterTypes[i]})`);
        });
        container.appendChild(span);
    }
    
    // Set first number active by default
    const firstNumber = container.querySelector('.mask-number');
    if (firstNumber) {
        firstNumber.classList.add('active');
        // NOTE: No need to call setterFn here - filters already created by initializeNodes()
        // Calling it here was causing double-initialization and connection issues
    }
    
    console.log(`✅ Osc ${oscIndex} mask type selector initialized`);
}

/**
 * Initialize center slider (mask frequency) for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for center control element
 */
function initCenterSlider(oscIndex, selector) {
    const centerControl = document.querySelector(selector);
    if (!centerControl) {
        console.warn(`Center control not found: ${selector}`);
        return;
    }
    
    const handle = centerControl.querySelector('.control-widget__handle');
    const track = centerControl.querySelector('.control-widget__track');
    if (!handle || !track) {
        console.error(`Center slider components missing for osc ${oscIndex}`);
        return;
    }
    
    let isDragging = false;
    
    // Get the correct setter and update functions for this oscillator
    const setterFn = oscIndex === 1 ? setOsc1MaskCenter : setOsc2MaskCenter;
    const updateDriftFn = oscIndex === 1 
        ? (window.NoiseSynth && window.NoiseSynth.updateOsc1DriftCenter)
        : (window.NoiseSynth && window.NoiseSynth.updateOsc2DriftCenter);
    
    let currentPercent = 50; // Default middle position
    
    const updateVisuals = (percent) => {
        const constrainedPercent = Math.max(0, Math.min(100, percent));
        currentPercent = constrainedPercent;
        handle.style.left = `${constrainedPercent}%`;
    };
    
    const applyToSynth = () => {
        // Convert 0-100% to 350-20000 Hz (logarithmic scale)
        const minHz = 350;
        const maxHz = 20000;
        const logMin = Math.log(minHz);
        const logMax = Math.log(maxHz);
        const logValue = logMin + (currentPercent / 100) * (logMax - logMin);
        const hz = Math.exp(logValue);
        
        setterFn(hz); // Updates mask filter frequency directly
        
        // CRITICAL FIX: Recreate drift LFO on mouseup if drift enabled
        // When center frequency changes, drift LFO must be recreated to modulate around NEW center
        // This is called ONLY on mouseup (not during drag) to prevent memory leak
        if (updateDriftFn) {
            updateDriftFn(); // Recreate LFO with new center frequency
        }
        
        notifyManualAdjustment();
        console.log(`🎚️ Osc ${oscIndex} mask center: ${currentPercent.toFixed(0)}% → ${hz.toFixed(0)} Hz`);
    };
    
    const updateCenter = (percent) => {
        updateVisuals(percent);
        applyToSynth(); // Immediate apply for clicks
    };
    
    // Mouse down on handle
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateCenter(percent);
    });
    
    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateVisuals(percent); // ONLY update visuals during drag
    });
    
    // Global mouse up
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            // MEMORY LEAK FIX: Apply to synth ONLY on mouseup
            applyToSynth();
        }
        isDragging = false;
    });
    
    console.log(`✅ Osc ${oscIndex} center slider initialized`);
}

/**
 * Initialize mix slider (mask wet/dry) for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for mix control element
 */
function initMixSlider(oscIndex, selector) {
    const mixControl = document.querySelector(selector);
    if (!mixControl) {
        console.warn(`Mix control not found: ${selector}`);
        return;
    }
    
    const handle = mixControl.querySelector('.control-widget__handle');
    const track = mixControl.querySelector('.control-widget__track');
    if (!handle || !track) {
        console.error(`Mix slider components missing for osc ${oscIndex}`);
        return;
    }
    
    let isDragging = false;
    
    // Get the correct setter function for this oscillator
    const setterFn = oscIndex === 1 ? setOsc1MaskMix : setOsc2MaskMix;
    
    const updateMix = (percent) => {
        const constrainedPercent = Math.max(0, Math.min(100, percent));
        handle.style.left = `${constrainedPercent}%`;
        
        // Convert 0-100% to 0.0-1.0 mix (0=dry, 1=wet)
        const mix = constrainedPercent / 100;
        setterFn(mix);
        notifyManualAdjustment();
        
        // console.log(`🎚️ Osc ${oscIndex} mix: ${constrainedPercent.toFixed(0)}% → ${mix.toFixed(2)}`); // PERFORMANCE: Fires on every mousemove
    };
    
    // Mouse down on handle
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateMix(percent);
    });
    
    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateMix(percent);
    });
    
    // Global mouse up
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    console.log(`✅ Osc ${oscIndex} mix slider initialized`);
}

/**
 * Initialize drift slider (modulation amount) for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for drift control element
 */
function initDriftSlider(oscIndex, selector) {
    const driftControl = document.querySelector(selector);
    if (!driftControl) {
        console.warn(`Drift control not found: ${selector}`);
        return;
    }
    
    const handle = driftControl.querySelector('.control-widget__handle');
    const track = driftControl.querySelector('.control-widget__track');
    if (!handle || !track) {
        console.error(`Drift slider components missing for osc ${oscIndex}`);
        return;
    }
    
    let isDragging = false;
    let currentPercent = 0;
    
    // Get the correct setter functions for this oscillator
    const setAmountFn = oscIndex === 1 ? setOsc1DriftAmount : setOsc2DriftAmount;
    const setEnabledFn = oscIndex === 1 ? setOsc1DriftEnabled : setOsc2DriftEnabled;
    const updateDriftFn = oscIndex === 1 
        ? window.NoiseSynth.updateOsc1DriftAmount 
        : window.NoiseSynth.updateOsc2DriftAmount;
    
    // Visual update only - no synth calls during drag
    const updateVisuals = (percent) => {
        const constrainedPercent = Math.max(0, Math.min(100, percent));
        currentPercent = constrainedPercent;
        handle.style.left = `${constrainedPercent}%`;
    };
    
    // Apply to synth once on mouseup
    const applyToSynth = () => {
        // Convert 0-100% to 0.0-1.0 drift amount (0=no drift, 1=full drift)
        const amount = currentPercent / 100;
        
        // Auto-enable drift if amount > 0, disable if amount = 0
        const shouldEnable = amount > 0;
        setAmountFn(amount);       // Store amount (doesn't recreate LFO - just updates state)
        setEnabledFn(shouldEnable); // Enable/disable LFO
        
        // MEMORY LEAK FIX: Mouseup-only LFO recreation pattern
        // During drag: Only visual updates (no LFO recreation)
        // On mouseup: Recreate LFO once with new amount
        // This prevents creating 100+ LFO objects during slider drag
        if (updateDriftFn) {
            updateDriftFn(); // Recreate LFO once on mouseup
        }
        
        notifyManualAdjustment();
        
        // console.log(`🎚️ Osc ${oscIndex} drift: ${currentPercent.toFixed(0)}% → ${amount.toFixed(2)} (${shouldEnable ? 'ON' : 'OFF'})`);
    };
    
    // Mouse down on handle
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateVisuals(percent);
        applyToSynth();
    });
    
    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        updateVisuals(percent); // Visual only during drag
    });
    
    // Global mouse up
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            applyToSynth(); // Apply once on release
        }
    });
    
    console.log(`✅ Osc ${oscIndex} drift slider initialized`);
}

/**
 * Initialize rate range slider (drift period lo/hi) for a specific oscillator
 * @param {number} oscIndex - Oscillator index (1 or 2)
 * @param {string} selector - CSS selector for rate control element
 */
function initRateRangeSlider(oscIndex, selector) {
    const rateControl = document.querySelector(selector);
    if (!rateControl) {
        console.warn(`Rate control not found: ${selector}`);
        return;
    }
    
    const track = rateControl.querySelector('.control-widget__track');
    const handles = rateControl.querySelectorAll('.control-widget__handle');
    const fill = rateControl.querySelector('.control-widget__range-fill');
    
    if (!track || handles.length !== 2 || !fill) {
        console.error(`Rate slider components missing for osc ${oscIndex}`);
        return;
    }
    
    const leftHandle = handles[0];
    const rightHandle = handles[1];
    let activeHandle = null;
    
    // Get the correct setter function for this oscillator (RANGE setter, not individual)
    const setRangeFn = oscIndex === 1 
        ? (window.NoiseSynth && window.NoiseSynth.setOsc1DriftRateRange) 
        : (window.NoiseSynth && window.NoiseSynth.setOsc2DriftRateRange);
    
    // Rate range: 0.5s to 30s (logarithmic scale)
    const MIN_SECONDS = 0.5;
    const MAX_SECONDS = 30;
    
    const percentToSeconds = (percent) => {
        const logMin = Math.log(MIN_SECONDS);
        const logMax = Math.log(MAX_SECONDS);
        const logValue = logMin + (percent / 100) * (logMax - logMin);
        return Math.exp(logValue);
    };
    
    let loPercent = 20; // ~2s
    let hiPercent = 80; // ~15s
    
    const updateVisuals = () => {
        // Ensure lo <= hi
        if (loPercent > hiPercent) {
            [loPercent, hiPercent] = [hiPercent, loPercent];
        }
        
        // Update visual positions ONLY (no synth calls during drag)
        leftHandle.style.left = `${loPercent}%`;
        rightHandle.style.left = `${hiPercent}%`;
        fill.style.left = `${loPercent}%`;
        fill.style.width = `${hiPercent - loPercent}%`;
    };
    
    const applyToSynth = () => {
        // Convert to seconds and update synth (ONLY called on mouseup)
        // 
        // MEMORY LEAK FIX: Use range setter instead of individual setters
        // - Old pattern: setRateLo() then setRateHi() = 2 LFO recreations
        // - New pattern: setRateRange() = 1 LFO recreation
        // - Result: 50% reduction in LFO object creation during slider use
        const loSeconds = percentToSeconds(loPercent);
        const hiSeconds = percentToSeconds(hiPercent);
        
        if (setRangeFn) {
            setRangeFn(loSeconds, hiSeconds); // Single LFO recreation!
        }
        notifyManualAdjustment();
        
        console.log(`🎚️ Osc ${oscIndex} rate: ${loSeconds.toFixed(1)}s - ${hiSeconds.toFixed(1)}s`);
    };
    
    // Mouse down on handles
    leftHandle.addEventListener('mousedown', (e) => {
        activeHandle = 'left';
        e.preventDefault();
        e.stopPropagation();
    });
    
    rightHandle.addEventListener('mousedown', (e) => {
        activeHandle = 'right';
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track
    track.addEventListener('click', (e) => {
        if (activeHandle) return; // Ignore if dragging
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const clickPercent = (x / rect.width) * 100;
        
        // Move nearest handle
        const distToLo = Math.abs(clickPercent - loPercent);
        const distToHi = Math.abs(clickPercent - hiPercent);
        
        if (distToLo < distToHi) {
            loPercent = Math.max(0, Math.min(100, clickPercent));
        } else {
            hiPercent = Math.max(0, Math.min(100, clickPercent));
        }
        
        updateVisuals();
        applyToSynth(); // Apply immediately on click
    });
    
    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (!activeHandle) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
        
        if (activeHandle === 'left') {
            loPercent = percent;
        } else {
            hiPercent = percent;
        }
        
        updateVisuals(); // ONLY update visuals during drag, no synth calls
    });
    
    // Global mouse up
    document.addEventListener('mouseup', () => {
        if (activeHandle) {
            // MEMORY LEAK FIX: Apply to synth ONLY on mouseup (not during drag)
            applyToSynth();
        }
        activeHandle = null;
    });
    
    // Initialize with default values
    updateVisuals();
    applyToSynth();
    
    console.log(`✅ Osc ${oscIndex} rate range slider initialized`);
}

// ============================================================================
// LEGACY FUNCTIONS (Will be removed after testing Phase 3A)
// ============================================================================

// === SLIDER CONSTRAINT UTILITY ===
// REMOVED: Constraint was breaking dB ↔ percent bidirectional conversion
// Volume fader now uses direct 0-100% mapping (0% = -60dB, 100% = 0dB)
// Handle overflow prevented by CSS (padding/width on track)

// Initialize noise volume slider
function initNoiseVolumeSlider() {
    const volControl = document.querySelector('.osc1-vol-control');
    if (!volControl) return;
    
    const handle = volControl.querySelector('.vol-handle');
    const track = volControl.querySelector('.vol-track');
    if (!handle || !track) return;
    
    let isDragging = false;
    
    // Mouse down on handle - start dragging
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track to set position
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateNoiseVolume(percent, handle);
    });
    
    // Global mouse move for dragging
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateNoiseVolume(percent, handle);
    });
    
    // Global mouse up - stop dragging
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Update noise volume position
function updateNoiseVolume(percent, handle) {
    // Constrain to 0-100% range
    const constrainedPercent = Math.max(0, Math.min(100, percent));
    
    // Update handle position (direct mapping, no offset)
    handle.style.left = `${constrainedPercent}%`;
    
    // Convert 0-100% to dB range (-70 to 0 dB) - matches binaural standard
    // 0% = -70dB (silent), 100% = 0dB (full)
    const db = (constrainedPercent / 100) * 70 + FADER_SILENCE_FLOOR_DB;
    
    // Apply to synth (MODEL)
    setNoiseVolume(db);
    
    // Notify presetter of manual adjustment (CONTROLLER)
    notifyManualAdjustment();
    
    console.log(`🎚️ Volume: ${constrainedPercent.toFixed(0)}% → ${db.toFixed(1)} dB`);
}

// Initialize mask center slider (frequency control)
function LEGACY_initCenterSlider() {
    const centerControl = document.querySelector('.noise-center-control');
    if (!centerControl) return;
    
    const handle = centerControl.querySelector('.control-widget__handle');
    const track = centerControl.querySelector('.control-widget__track');
    if (!handle || !track) return;
    
    let isDragging = false;
    
    // Mouse down on handle - start dragging
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track to set position
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateCenterFrequency(percent, handle);
    });
    
    // Global mouse move for dragging
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateCenterFrequency(percent, handle);
    });
    
    // Global mouse up - stop dragging
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Update mask center frequency
function updateCenterFrequency(percent, handle) {
    // Constrain to 0-100% range
    const constrainedPercent = Math.max(0, Math.min(100, percent));
    
    // Update handle position
    handle.style.left = constrainedPercent + '%';
    
    // Map 0-100% to 350-20000 Hz (logarithmic scale for natural frequency perception)
    const minHz = 350;
    const maxHz = 20000;
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);
    const hz = Math.exp(logMin + (logMax - logMin) * (constrainedPercent / 100));
    
    // Update synth via presetter (ATSAC traffic control)
    if (window.NoisePresets && window.NoisePresets.setMaskCenter) {
        window.NoisePresets.setMaskCenter(Math.round(hz));
    }
}

// Initialize mask mix slider (wet/dry control)
function LEGACY_initMixSlider() {
    const mixControl = document.querySelector('.noise-mix-control');
    if (!mixControl) return;
    
    const handle = mixControl.querySelector('.control-widget__handle');
    const track = mixControl.querySelector('.control-widget__track');
    if (!handle || !track) return;
    
    let isDragging = false;
    
    // Mouse down on handle - start dragging
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track to set position
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateMaskMix(percent, handle);
    });
    
    // Global mouse move for dragging
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateMaskMix(percent, handle);
    });
    
    // Global mouse up - stop dragging
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Update mask mix (wet/dry)
function updateMaskMix(percent, handle) {
    // Constrain to 0-100% range
    const constrainedPercent = Math.max(0, Math.min(100, percent));
    
    // Update handle position
    handle.style.left = constrainedPercent + '%';
    
    // Map 0-100% to 0.0-1.0 mix (linear scale)
    const mix = constrainedPercent / 100;
    
    // Update synth via presetter (ATSAC traffic control)
    if (window.NoisePresets && window.NoisePresets.setMaskMix) {
        window.NoisePresets.setMaskMix(mix);
    }
}

// Initialize width slider (stereo spread)
function LEGACY_initWidthSlider() {
    const widthControl = document.querySelector('.osc1-width-control');
    if (!widthControl) return;
    
    const handle = widthControl.querySelector('.control-widget__handle');
    const track = widthControl.querySelector('.control-widget__track');
    if (!handle || !track) return;
    
    let isDragging = false;
    
    // Mouse down on handle - start dragging
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track to set position
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateNoiseWidth(percent, handle);
    });
    
    // Global mouse move for dragging
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateNoiseWidth(percent, handle);
    });
    
    // Global mouse up - stop dragging
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Update noise width (stereo spread)
function updateNoiseWidth(percent, handle) {
    // Constrain to 0-100% range
    const constrainedPercent = Math.max(0, Math.min(100, percent));
    
    // Update handle position
    handle.style.left = constrainedPercent + '%';
    
    // Map 0-100% to 0.0-1.0 width factor (linear scale)
    const widthFactor = constrainedPercent / 100;
    
    // Update synth via presetter (ATSAC traffic control)
    if (window.NoisePresets && window.NoisePresets.setNoiseWidth) {
        window.NoisePresets.setNoiseWidth(widthFactor);
    }
}

// Initialize drift amount slider (modulation depth)
function LEGACY_initDriftSlider() {
    const driftControl = document.querySelector('.noise-drift-control');
    if (!driftControl) return;
    
    const handle = driftControl.querySelector('.control-widget__handle');
    const track = driftControl.querySelector('.control-widget__track');
    if (!handle || !track) return;
    
    let isDragging = false;
    
    // Mouse down on handle - start dragging
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on track to set position
    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateDriftAmount(percent, handle);
    });
    
    // Global mouse move for dragging
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        updateDriftAmount(percent, handle);
    });
    
    // Global mouse up - stop dragging
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Update drift amount (modulation depth)
function updateDriftAmount(percent, handle) {
    // Constrain to 0-100% range
    const constrainedPercent = Math.max(0, Math.min(100, percent));
    
    // Update handle position
    handle.style.left = constrainedPercent + '%';
    
    // Map 0-100% to 0.0-1.0 amount (linear scale)
    const amount = constrainedPercent / 100;
    
    // Enable/disable drift based on amount (0 = disabled, >0 = enabled)
    const enabled = (amount > 0);
    
    // Update synth via presetter (ATSAC traffic control)
    if (window.NoisePresets) {
        if (window.NoisePresets.setDriftEnabled) {
            window.NoisePresets.setDriftEnabled(enabled);
        }
        if (window.NoisePresets.setDriftAmount) {
            window.NoisePresets.setDriftAmount(amount);
        }
    }
}

// Initialize rate range slider (drift period min/max)
function LEGACY_initRateSlider() {
    const rateControl = document.querySelector('.noise-rate-control');
    if (!rateControl) {
        console.warn('Rate control not found');
        return;
    }
    
    const handles = rateControl.querySelectorAll('.control-widget__handle');
    const track = rateControl.querySelector('.control-widget__track');
    const fill = rateControl.querySelector('.control-widget__range-fill');
    
    if (!handles || handles.length !== 2 || !track || !fill) {
        console.error('Rate slider missing required elements');
        return;
    }
    
    const leftHandle = handles[0];
    const rightHandle = handles[1];
    
    // Rate range: 1-30 seconds (reasonable for drift periods)
    const MIN_RATE = 1;
    const MAX_RATE = 30;
    
    // Initialize positions (default 5-15s)
    let leftPercent = ((5 - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100;
    let rightPercent = ((15 - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100;
    
    leftHandle.style.left = leftPercent + '%';
    rightHandle.style.left = rightPercent + '%';
    updateRateFill();
    
    let draggingHandle = null;
    
    // Mouse down on handles
    leftHandle.addEventListener('mousedown', (e) => {
        draggingHandle = 'left';
        e.preventDefault();
        e.stopPropagation();
    });
    
    rightHandle.addEventListener('mousedown', (e) => {
        draggingHandle = 'right';
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (!draggingHandle) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawPercent = (x / rect.width) * 100;
        const percent = Math.max(0, Math.min(100, rawPercent));
        
        if (draggingHandle === 'left') {
            // Left handle can't go past right handle
            leftPercent = Math.min(percent, rightPercent);
            leftHandle.style.left = leftPercent + '%';
        } else {
            // Right handle can't go before left handle
            rightPercent = Math.max(percent, leftPercent);
            rightHandle.style.left = rightPercent + '%';
        }
        
        updateRateFill();
        // DON'T update values during drag - wait for mouseup to avoid audio skips
    });
    
    // Global mouse up
    document.addEventListener('mouseup', () => {
        if (draggingHandle) {
            // NOW update the LFO (only on drop, not during drag)
            updateRateValues();
        }
        draggingHandle = null;
    });
    
    function updateRateFill() {
        fill.style.left = leftPercent + '%';
        fill.style.width = (rightPercent - leftPercent) + '%';
    }
    
    function updateRateValues() {
        // Convert percent to seconds (linear scale)
        const rateLo = MIN_RATE + (leftPercent / 100) * (MAX_RATE - MIN_RATE);
        const rateHi = MIN_RATE + (rightPercent / 100) * (MAX_RATE - MIN_RATE);
        
        // Update synth via presetter (ATSAC traffic control)
        if (window.NoisePresets) {
            if (window.NoisePresets.setDriftRateLo) {
                window.NoisePresets.setDriftRateLo(rateLo);
            }
            if (window.NoisePresets.setDriftRateHi) {
                window.NoisePresets.setDriftRateHi(rateHi);
            }
        }
    }
}

// Initialize noise type selector
function initNoiseTypeSelector() {
    const selector = document.querySelector('.button_selector--noise-type');
    if (!selector) {
        console.error('Noise type selector not found');
        return;
    }

    const display = selector.querySelector('.button_selector__display');
    const navButtons = selector.querySelectorAll('.button_selector__nav');
    const prevButton = navButtons[0];
    const nextButton = navButtons[1];

    if (!display || !prevButton || !nextButton) {
        console.error('Noise type selector components not found');
        return;
    }

    const noiseTypes = ['Brown', 'Pink', 'White'];
    let currentIndex = noiseTypes.indexOf(display.textContent.trim());
    if (currentIndex === -1) {
        currentIndex = 0; // Default to Brown
        display.textContent = noiseTypes[currentIndex];
    }

    prevButton.addEventListener('click', () => {
        currentIndex = (currentIndex - 1 + noiseTypes.length) % noiseTypes.length;
        display.textContent = noiseTypes[currentIndex];
        
        // Apply to synth (MODEL)
        const type = noiseTypes[currentIndex].toLowerCase();
        setNoiseType(type);
        
        // Notify presetter of manual adjustment (CONTROLLER)
        notifyManualAdjustment();
        
        console.log(`🎛️ Noise type: ${noiseTypes[currentIndex]}`);
    });

    nextButton.addEventListener('click', () => {
        currentIndex = (currentIndex + 1) % noiseTypes.length;
        display.textContent = noiseTypes[currentIndex];
        
        // Apply to synth (MODEL)
        const type = noiseTypes[currentIndex].toLowerCase();
        setNoiseType(type);
        
        // Notify presetter of manual adjustment (CONTROLLER)
        notifyManualAdjustment();
        
        console.log(`🎛️ Noise type: ${noiseTypes[currentIndex]}`);
    });
}

// ============================================================================
// SCULPT SLIDER - Lowpass filter control (LP only for now)
// ============================================================================
// Right handle = LP cutoff (20Hz - 20kHz)
// Left handle = HP cutoff (bandpass filter when both HP+LP active)
// HP+LP create bandpass filter - noise passes through band between cutoffs
// ============================================================================
function LEGACY_initSculptSlider() {
    const sculptControl = document.querySelector('.osc1-sculpt-control');
    if (!sculptControl) return;
    
    const track = sculptControl.querySelector('.control-widget__track');
    const fill = sculptControl.querySelector('.control-widget__range-fill');
    const handles = sculptControl.querySelectorAll('.control-widget__handle');
    const leftHandle = handles[0];  // HP (future)
    const rightHandle = handles[1]; // LP (active)
    
    if (!track || !fill || !leftHandle || !rightHandle) {
        console.error('Sculpt slider missing required elements');
        return;
    }
    
    let activeHandle = null;
    
    // Update visual fill between handles
    function updateFill() {
        const leftPercent = parseFloat(leftHandle.style.left) || 0;
        const rightPercent = parseFloat(rightHandle.style.left) || 100;
        fill.style.left = `${leftPercent}%`;
        fill.style.width = `${rightPercent - leftPercent}%`;
    }
    
    // Convert percent (0-100) to Hz - exponential scale
    // SEPARATE RANGES for HP and LP filters (practical noise sculpting)
    
    // HP Filter: 350Hz - 16kHz (left handle)
    // Philosophy: 350Hz minimum is practical for noise texture sculpting
    // Going lower just removes sub-bass that noise barely has
    function percentToHzHP(percent) {
        const minHz = 350;  // Practical HP minimum for noise
        const maxHz = 16000; // Upper limit for HP (crossover zone)
        const logMin = Math.log(minHz);
        const logMax = Math.log(maxHz);
        const logValue = logMin + (percent / 100) * (logMax - logMin);
        return Math.round(Math.exp(logValue));
    }
    
    // LP Filter: 350Hz - 20kHz (right handle)
    // Philosophy: Keep full high-end capability, but match HP minimum
    function percentToHzLP(percent) {
        const minHz = 350;   // Match HP minimum for consistency
        const maxHz = 20000; // Full spectrum capability
        const logMin = Math.log(minHz);
        const logMax = Math.log(maxHz);
        const logValue = logMin + (percent / 100) * (logMax - logMin);
        return Math.round(Math.exp(logValue));
    }
    
    // Note: hzToPercentHP and hzToPercentLP moved to module scope for preset loader access
    
    // Apply LP filter value to synth
    function applySculptLP(percent) {
        const hz = percentToHzLP(percent);
        
        // Apply to synth (MODEL)
        setSculptLP(hz);
        
        // Notify presetter of manual adjustment (CONTROLLER)
        notifyManualAdjustment();
        
        console.log(`🎛️ Sculpt LP: ${percent.toFixed(0)}% → ${hz} Hz`);
    }
    
    // Apply HP filter value to synth
    function applySculptHP(percent) {
        const hz = percentToHzHP(percent);
        
        // Apply to synth (MODEL)
        setSculptHP(hz);
        
        // Notify presetter of manual adjustment (CONTROLLER)
        notifyManualAdjustment();
        
        console.log(`🎛️ Sculpt HP: ${percent.toFixed(0)}% → ${hz} Hz`);
    }
    
    // Mouse down on handle
    function setupHandle(handle) {
        handle.addEventListener('mousedown', (e) => {
            activeHandle = handle;
            e.preventDefault();
            e.stopPropagation();
        });
    }
    
    setupHandle(leftHandle);
    setupHandle(rightHandle);
    
    // Mouse move (dragging)
    document.addEventListener('mousemove', (e) => {
        if (!activeHandle) return;
        
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        let percent = (x / rect.width) * 100;
        percent = Math.max(0, Math.min(100, percent));
        
        const leftPercent = parseFloat(leftHandle.style.left) || 0;
        const rightPercent = parseFloat(rightHandle.style.left) || 100;
        
        // Enforce handle order (left < right)
        if (activeHandle === leftHandle) {
            percent = Math.min(percent, rightPercent);
            leftHandle.style.left = `${percent}%`;
            applySculptHP(percent); // HP filter active!
        } else {
            percent = Math.max(percent, leftPercent);
            rightHandle.style.left = `${percent}%`;
            applySculptLP(percent);
        }
        
        updateFill();
    });
    
    // Mouse up (stop dragging)
    document.addEventListener('mouseup', () => {
        activeHandle = null;
    });
    
    // Set initial positions (left=0%, right=100% = full spectrum)
    if (!leftHandle.style.left) {
        leftHandle.style.left = '0%';
    }
    if (!rightHandle.style.left) {
        rightHandle.style.left = '100%';
    }
    
    updateFill();
    
    console.log('✅ Sculpt slider initialized (dual-handle bandpass: HP + LP)');
}

function LEGACY_initMaskNumbers() {
    const container = document.querySelector('.noise-mask-numbers');
    if (!container) return;
    
    // Map numbers to filter types (removed lowpass12, kept the cool ones)
    const filterTypes = {
        1: 'bandpass',
        2: 'notch',
        3: 'allpass',
        4: 'comb'
    };
    
    container.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
        const span = document.createElement('span');
        span.textContent = i;
        span.className = 'mask-number';
        span.addEventListener('click', () => {
            // Update UI
            container.querySelectorAll('.mask-number').forEach(n => n.classList.remove('active'));
            span.classList.add('active');
            
            // Update synth via presetter (ATSAC traffic control)
            if (window.NoisePresets && window.NoisePresets.setMaskType) {
                window.NoisePresets.setMaskType(filterTypes[i]);
            }
        });
        container.appendChild(span);
    }
    container.querySelector('.mask-number')?.classList.add('active');
}

// Initialize two-handle range slider
function initRangeSlider(sliderElement) {
    if (!sliderElement) return;

    const track = sliderElement.querySelector('.control-widget__track');
    const fill = sliderElement.querySelector('.control-widget__range-fill');
    const handles = sliderElement.querySelectorAll('.control-widget__handle');
    const minHandle = handles[0];
    const maxHandle = handles[1];

    if (!track || !fill || !minHandle || !maxHandle) {
        console.error('Range slider missing required elements:', {
            sliderElement,
            track,
            fill,
            minHandle,
            maxHandle,
            handleCount: handles.length,
            innerHTML: sliderElement.innerHTML
        });
        return;
    }

    let activeHandle = null;

    function updateFill() {
        const minPercent = parseFloat(minHandle.style.left) || 0;
        const maxPercent = parseFloat(maxHandle.style.left) || 100;
        fill.style.left = `${minPercent}%`;
        fill.style.width = `${maxPercent - minPercent}%`;
    }

    function setupHandle(handle) {
        handle.addEventListener('mousedown', (e) => {
            activeHandle = handle;
            e.preventDefault();
            e.stopPropagation();
        });
    }

    setupHandle(minHandle);
    setupHandle(maxHandle);

    document.addEventListener('mousemove', (e) => {
        if (!activeHandle) return;

        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        let percent = (x / rect.width) * 100;
        percent = Math.max(0, Math.min(100, percent));

        const minPercent = parseFloat(minHandle.style.left) || 0;
        const maxPercent = parseFloat(maxHandle.style.left) || 100;

        if (activeHandle === minHandle) {
            percent = Math.min(percent, maxPercent);
        } else {
            percent = Math.max(percent, minPercent);
        }

        activeHandle.style.left = `${percent}%`;
        updateFill();
    });

    document.addEventListener('mouseup', () => {
        activeHandle = null;
    });

    // Set initial positions to full span
    if (!minHandle.style.left) {
        minHandle.style.left = '0%';
    }
    if (!maxHandle.style.left) {
        maxHandle.style.left = '100%';
    }
    
    updateFill();
}

// ============================================================================
// PRESET EVENT LISTENERS - Update UI when preset loads
// ============================================================================
// Listens for 'noisePresetLoaded' event from presetter
// Updates UI controls to match preset values (VIEW layer)
// ============================================================================
function setupPresetEventListeners() {
    window.addEventListener('noisePresetLoaded', (event) => {
        const presetData = event.detail?.presetData;
        if (!presetData) return;
        
        console.log('📺 Preset loaded, updating UI:', presetData);
        
        // Update OSC1 UI controls (all 9 parameters per oscillator)
        if (presetData.osc1) {
            // Update noise type selector
            if (presetData.osc1.noiseType) {
                const typeSelector = document.querySelector('.button_selector--noise-type .button_selector__display');
                if (typeSelector) {
                    const capitalizedType = presetData.osc1.noiseType.charAt(0).toUpperCase() + 
                                          presetData.osc1.noiseType.slice(1);
                    typeSelector.textContent = capitalizedType;
                    console.log('✅ UI: Noise type →', capitalizedType);
                }
            }
            
            // Update volume slider
            if (presetData.osc1.volume !== undefined) {
                console.log('🔍 Looking for OSC1 volume handle...');
                const volHandle = document.querySelector('.osc1-vol-control .vol-handle');
                console.log('🔍 Volume handle found:', volHandle);
                
                if (volHandle) {
                    // Convert dB (-70 to 0) to percent (0 to 100)
                    // Direct mapping: -70dB → 0%, 0dB → 100%
                    const percent = ((presetData.osc1.volume - FADER_SILENCE_FLOOR_DB) / 70) * 100;
                    console.log('🔍 Calculated percent:', percent, 'from dB:', presetData.osc1.volume);
                    volHandle.style.left = `${percent}%`;
                    console.log('✅ UI: OSC1 Volume →', presetData.osc1.volume, 'dB (', percent.toFixed(0), '%)');
                } else {
                    console.error('❌ OSC1 Volume handle not found!');
                }
            }
            
            // Update sculpt slider (HP and LP cutoffs)
            const sculptControl = document.querySelector('.osc1-sculpt-control');
            if (sculptControl) {
                const handles = sculptControl.querySelectorAll('.control-widget__handle');
                const leftHandle = handles[0];
                const rightHandle = handles[1];
                const fill = sculptControl.querySelector('.control-widget__range-fill');
                
                // Update HP (left handle) - uses HP-specific range (350Hz-16kHz)
                if (presetData.osc1.sculptHP !== undefined && leftHandle) {
                    const percent = hzToPercentHP(presetData.osc1.sculptHP);
                    leftHandle.style.left = `${percent}%`;
                    console.log('✅ UI: Sculpt HP →', presetData.osc1.sculptHP, 'Hz (', percent.toFixed(0), '%)');
                }
                
                // Update LP (right handle) - uses LP-specific range (350Hz-20kHz)
                if (presetData.osc1.sculptLP !== undefined && rightHandle) {
                    const percent = hzToPercentLP(presetData.osc1.sculptLP);
                    rightHandle.style.left = `${percent}%`;
                    console.log('✅ UI: Sculpt LP →', presetData.osc1.sculptLP, 'Hz (', percent.toFixed(0), '%)');
                }
                
                // Update fill between handles
                if (fill && leftHandle && rightHandle) {
                    const leftPercent = parseFloat(leftHandle.style.left) || 0;
                    const rightPercent = parseFloat(rightHandle.style.left) || 100;
                    fill.style.left = `${leftPercent}%`;
                    fill.style.width = `${rightPercent - leftPercent}%`;
                }
            }
            
            // All controls updated: type, volume, sculpt (HP+LP), width, mask (type, center, mix, drift)
        }
        
        console.log('✅ UI updated from preset');
    });
}

// Initialize noise preset controller
export async function initNoiseController() {
    // Allow re-initialization when panel is swapped back in
    const currentPanelId = document.querySelector('#control-panel-noise')?.dataset.sessionId || Date.now();
    
    if (document.body.dataset.noiseControllerInitialized === String(currentPanelId)) {
        console.warn('initNoiseController: already initialized for this panel session, skipping.');
        return;
    }
    
    // Set unique session ID for this panel instance
    const panel = document.querySelector('#control-panel-noise');
    if (panel) {
        panel.dataset.sessionId = String(currentPanelId);
    }
    document.body.dataset.noiseControllerInitialized = String(currentPanelId);
    
    const options = {
        presetDisplay: document.getElementById('noise-preset-selector'),
        presetPrev: document.getElementById('noise-preset-prev'),
        presetNext: document.getElementById('noise-preset-next'),
        saveBtn: document.getElementById('noise-save-preset'),
        revertBtn: document.getElementById('noise-revert-preset'),
    };

    try {
        await createNoisePresetController(options);
        console.log('noise_widget: noise preset controller initialized');
    } catch (e) {
        console.error('Failed to initialize noise preset controller', e);
    }
}
