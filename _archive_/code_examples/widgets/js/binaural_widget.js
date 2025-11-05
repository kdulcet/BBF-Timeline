// ============================================================================
// BINAURAL WIDGET - VIEW LAYER (MVC) - Refactored Phase 3
// ============================================================================
// MVC ARCHITECTURE: Widget orchestrator for binaural audio controls
//
// PATTERN: Widget → Controller → Model
// - Widget (this file): Orchestrates UI initialization, delegates control handling
// - Controller (binaural_presets.js): Manages state, loads/saves presets, owns IsResume flag
// - Model (binaural_synth.js + binaural_iso.js): Pure audio generation
//
// DELEGATION STRATEGY (Post-Refactor):
// - Volume faders: Handled inline (generic vertical fader pattern)
// - Specialized controls: Delegated to binaural_controls.js module
//   • Octave buttons (harmonic transposition)
//   • Width sliders (stereo positioning)
//   • Length sliders (isochronic pulse duration)
//   • ISO crossfade (binaural/isochronic blend)
//
// PRESET FLOW:
// - User loads preset → Controller fires event → Widget updates UI → Model updates audio
// - Widget respects element.dataset.manuallyAdjusted flags (IsResume pattern)
//
// CSS COMPLIANCE:
// - CSS handles all visual presentation via classes
// - Exception: Fader/slider positioning uses inline styles (UI control necessity)
// - See docs/CSS_STYLEGUIDE.md for architecture details
// ============================================================================

import "../../src/ui_controls.js";
import { getRootKeyFrequency, getMoodSemitones } from '../../src/key_and_mood.js';
import { initVerticalFader } from '../../src/ui_linear_controls.js';
import { initOctaveControls, updateOctaveControlDisplay, initWidthControls, updateWidthPositionFromPreset, initLengthControls, updateLengthPositionFromPreset, initIsoControls, updateIsoPositionFromPreset } from './binaural_controls.js';
import { createBinauralPresetController } from '../presets/binaural_presets.js';
import { setCarrierFrequency, setMoodSemitones, setVoiceVolume, setBinauralBeat, setVoiceOctaveOffset, setVoiceWidth, setCrossfadeGain } from '../synths/binaural_synth.js';
import { setCarrierFrequency as setIsoCarrierFrequency, setVoiceVolume as setIsoVoiceVolume, setCrossfadeGain as setIsoCrossfadeGain, setVoiceWidth as setIsoVoiceWidth, setVoiceOctaveOffset as setIsoVoiceOctaveOffset, setPulseLength, setMoodSemitones as setIsoMoodSemitones } from '../synths/binaural_iso.js';

// ==============================================
// CONSTANTS - Audio configuration
// ==============================================

const FADER_SILENCE_FLOOR_DB = -70;  // 0% fader = -70dB (effectively silent, prevents pops)
const ISO_MAKEUP_GAIN_DB = 2;        // +2dB boost for isochronic (compensates gating energy loss)
const ISO_CROSSFADE_CURVE = 1;       // Linear crossfade (1 = equal power, >1 = bias toward ISO)

// ==============================================
// WIDGET INITIALIZATION - Main entry point
// ==============================================
// PURPOSE: Initialize all binaural widget UI components
// PATTERN: Panel-session tracking prevents duplicate initialization
// - Uses sessionId to allow panel swapping without conflicts
// - Safe to call multiple times (idempotent)
// ==============================================

export async function initBinauralWidget() {
    // Panel session tracking - prevents duplicate initialization during panel swaps
    const currentPanelId = document.querySelector('#control-panel-binaural')?.dataset.sessionId || Date.now();
    
    if (document.body.dataset.binauralWidgetInitialized === String(currentPanelId)) {
        return;  // Already initialized for this panel instance
    }
    
    const panel = document.querySelector('#control-panel-binaural');
    if (panel) panel.dataset.sessionId = String(currentPanelId);
    document.body.dataset.binauralWidgetInitialized = String(currentPanelId);

    // Back arrow navigation - returns to main panel
    const backArrow = document.querySelector('.control-panel-back-arrow');
    if (backArrow) {
        backArrow.addEventListener('click', async () => {
            // Clear journeymap loop state when exiting edit mode
            document.querySelectorAll('.jm-box.looping').forEach(box => box.classList.remove('looping'));
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('main_panel', 'control-panel-container');
            }
        });
    }

    // Root key selector - sets carrier frequency base (C, C#, D, etc.)
    // FUTURE: Move to global header (affects all harmonic widgets)
    try {
        if (window.UIControls && typeof window.UIControls.initRootKey === 'function') {
            const rootContainer = document.querySelector('.root-selector-container');
            if (rootContainer) {
                const existingSelector = rootContainer.querySelector('.button_selector--rootkey');
                if (existingSelector && !existingSelector.dataset.binauralInitialized) {
                    window.UIControls.initRootKey(rootContainer, {
                        initial: 'G',  // Default: G3 (196 Hz carrier)
                        onChange: (v, i) => {
                            // Update BOTH synths with new carrier frequency
                            const frequency = getRootKeyFrequency(v);
                            setCarrierFrequency(frequency);
                            setIsoCarrierFrequency(frequency);
                        }
                    });

                    existingSelector.dataset.binauralInitialized = 'true';
                    
                    // Set initial carrier frequency for both synths
                    const initialFreq = getRootKeyFrequency('G');
                    setCarrierFrequency(initialFreq);
                    setIsoCarrierFrequency(initialFreq);
                }
            }
        }
    } catch (e) {
        console.warn('Failed to initialize rootkey selector', e);
    }

    // Mood selector - controls harmonic intervals (Radiance/Depth/Stillness)
    // BBF: Mood scoped to binaural widget
    // FUTURE (AuraMatrix): Mood becomes global (controls pads harmonics too)
    try {
        if (window.UIControls && typeof window.UIControls.initMood === 'function') {
            const moodContainer = document.querySelector('.mood-selector-container');
            if (moodContainer) {
                const existingMoodSelector = moodContainer.querySelector('.button_selector--mood');
                if (existingMoodSelector && !existingMoodSelector.dataset.binauralInitialized) {
                    window.UIControls.initMood(moodContainer, {
                        initial: 'Radiance',  // Default: Bright, uplifting intervals
                        onChange: (v, i) => {
                            // Map mood to semitone array and update BOTH synths
                            const semitones = getMoodSemitones(v);
                            setMoodSemitones(semitones);
                            setIsoMoodSemitones(semitones);
                            
                            // Legacy renderer support (backward compatibility)
                            const transport = window.TransportAPI || {};
                            if (transport.setMood && typeof transport.setMood === 'function') {
                                transport.setMood(v);
                            }
                        }
                    });

                    existingMoodSelector.dataset.binauralInitialized = 'true';
                    
                    // Set initial mood semitones for both synths
                    const initialSemitones = getMoodSemitones('Radiance');
                    setMoodSemitones(initialSemitones);
                    setIsoMoodSemitones(initialSemitones);
                }
            }
        }
    } catch (e) {
        console.warn('Failed to initialize mood selector', e);
    }

    // Initialize volume faders (generic vertical fader pattern)
    initVolumeFaders();

    // Preset event listeners - update UI when presets load
    // Controller fires these events after loading preset JSON
    window.addEventListener('binauralPresetLoaded', (event) => {
        updateFaderPositions(event.detail.presetData);
    });
    
    window.addEventListener('binauralPresetApplied', (event) => {
        updateFaderPositions(event.detail.presetData);
    });

    // Global API exposure - allows other widgets to access fader state
    if (!window.BinauralFaderAPI) {
        window.BinauralFaderAPI = {
            applyCurrentFaderValues,
            getCurrentFaderValues
        };
    }

    // Preset selector - loads binaural presets from /presets/binaural/
    try {
        if (window.UIControls && typeof window.UIControls.initSelector === 'function') {
            const presetContainer = document.querySelector('.binaural-bottom-row');
            if (presetContainer) {
                const existingPresetSelector = presetContainer.querySelector('.button_selector--preset');
                if (existingPresetSelector && !existingPresetSelector.dataset.binauralInitialized) {
                    // Load preset list from filesystem
                    const { loadBinauralPresets } = await import('../presets/binaural_presets.js');
                    const binauralPresets = await loadBinauralPresets();
                    
                    const controller = window.UIControls.initSelector(existingPresetSelector, {
                        values: binauralPresets,
                        initialIndex: 0,  // Start with first preset
                        onChange: async (v, i) => {
                            // Load and apply selected preset
                            const { loadAndApplyBinauralPreset } = await import('../presets/binaural_presets.js');
                            await loadAndApplyBinauralPreset(v);
                        }
                    });

                    existingPresetSelector.dataset.binauralInitialized = 'true';
                    presetContainer.presetController = controller;
                }
            }
        }
    } catch (e) {
        console.warn('Failed to initialize preset selector', e);
    }

    // Initialize all control modules
    // Delegated to binaural_controls.js for specialized controls
    initBinauralContentNavigation();  // Page navigation for content box
    initOctaveControls();              // Harmonic transposition buttons
    initWidthControls();               // Stereo width sliders
    initLengthControls();              // Isochronic pulse duration sliders
    initIsoControls();                 // Binaural/isochronic crossfade sliders
    
    // Edit mode: Auto-loop first plateau for immediate audio feedback
    // Allows user to hear synth changes while tweaking controls
    const firstPlateau = document.querySelector('.jm-box.plateau');
    if (firstPlateau) {
        firstPlateau.classList.add('looping');
    }
}

// ==============================================
// CONTROLLER INITIALIZATION - Preset management
// ==============================================
// PURPOSE: Initialize binaural preset controller (separate from widget UI)
// PATTERN: Controller manages state, Widget manages presentation
// - Controller owns IsResume flag (tracks manual adjustments)
// - Controller loads/saves presets, fires events for Widget
// ==============================================

export async function initBinauralController() {
    // Panel session tracking (matches widget initialization pattern)
    const currentPanelId = document.querySelector('#control-panel-binaural')?.dataset.sessionId || Date.now();
    
    if (document.body.dataset.binauralControllerInitialized === String(currentPanelId)) {
        return;  // Already initialized for this panel instance
    }
    document.body.dataset.binauralControllerInitialized = String(currentPanelId);
    
    // Gather DOM references for preset controller
    const presetDisplay = document.getElementById('binaural-preset-selector');
    const saveBtn = document.getElementById('binaural-save-preset');
    const revertBtn = document.getElementById('binaural-revert-preset');

    // JourneyMap bridge - provides timeline context for presets
    const jm = window.JourneyMapAPI || {};
    const options = {
        presetDisplay,
        presetPrev: document.getElementById('binaural-preset-prev'),
        presetNext: document.getElementById('binaural-preset-next'),
        saveBtn,
        revertBtn,
        // Safe getters reference JourneyMap bridge if available
        renderPreset: typeof jm.renderPreset === 'function' ? jm.renderPreset : async (n)=>{console.warn('renderPreset not available yet', n);},
        getCurrentPresetData: typeof jm.getCurrentPresetData === 'function' ? jm.getCurrentPresetData : () => null,
        getCurrentPresetFilename: typeof jm.getCurrentPresetFilename === 'function' ? jm.getCurrentPresetFilename : () => null,
        playBtn: document.getElementById('transport-play'),
        stopBtn: null,
        x60Btn: document.getElementById('transport-x60')
    };

    try {
        await createBinauralPresetController(options);
    } catch (e) {
        console.error('Failed to initialize binaural preset controller', e);
    }
}

// ==============================================
// VOLUME FADERS - Vertical fader controls
// ==============================================
// PURPOSE: Control voice volumes (-70dB to 0dB range)
// PATTERN: Generic vertical fader from ui_linear_controls.js
// - Uses initVerticalFader for consistent behavior across app
// - Calls Model setters immediately on change
// - Marks manual adjustments for IsResume flag
// CSS EXCEPTION: Fader handle position uses inline styles (UI necessity)
// ==============================================

function initVolumeFaders() {
    const faders = document.querySelectorAll('.voice-fader');
    
    faders.forEach((fader, index) => {
        const voiceNumber = parseInt(fader.dataset.voice);
        
        // Use generic vertical fader pattern from ui_linear_controls.js
        initVerticalFader(fader, {
            onChange: (db, percent) => {
                // Update Model immediately (no delay, no batching)
                updateVoiceVolume(voiceNumber, db);
            },
            onManualAdjust: () => {
                // Mark manual adjustment (triggers IsResume flag in Controller)
                fader.dataset.manuallyAdjusted = 'true';
                import('../presets/binaural_presets.js').then(module => {
                    module.notifyManualAdjustment();
                });
            }
        });
    });
}

async function updateVoiceVolume(voiceNumber, volumeDb) {
    // Convert 1-based UI voice number to 0-based Model index
    const voiceIndex = voiceNumber - 1;
    // Update BOTH synths (binaural + isochronic must stay in sync)
    setVoiceVolume(voiceIndex, volumeDb);
    setIsoVoiceVolume(voiceIndex, volumeDb);
}

function applyCurrentFaderValues() {
    // Called by transport - applies screen fader values to audio
    const faders = document.querySelectorAll('.voice-fader');
    
    faders.forEach((fader, index) => {
        const handle = fader.querySelector('.fader-handle');
        const voiceNumber = index + 1;
        
        if (handle) {
            // Read current fader position from CSS
            const faderPosition = parseFloat(handle.style.bottom) || 50;
            const volumeDb = (faderPosition / 100) * 60 - 60;
            setVoiceVolume(index, volumeDb);
        }
    });
}

function getCurrentFaderValues() {
    // Returns current fader state as preset data format
    // Used by Controller when saving presets
    const faders = document.querySelectorAll('.voice-fader');
    const currentValues = {};
    
    faders.forEach((fader, index) => {
        const handle = fader.querySelector('.fader-handle');
        const voiceNumber = index + 1;
        
        if (handle) {
            const faderPosition = parseFloat(handle.style.bottom) || 50;
            const volumeDb = (faderPosition / 100) * 60 - 60;
            currentValues[voiceNumber] = { volume: volumeDb };
        }
    });
    
    // Add octave values from buttons
    const octaveWidgets = document.querySelectorAll('.octave-widget');
    octaveWidgets.forEach(widget => {
        const voiceNumber = parseInt(widget.dataset.voice);
        const activeButton = widget.querySelector('.octave-btn.active');
        const octaveValue = activeButton ? parseInt(activeButton.dataset.oct) : 0;
        
        if (currentValues[voiceNumber]) {
            currentValues[voiceNumber].octave = octaveValue;
        } else {
            currentValues[voiceNumber] = { octave: octaveValue };
        }
    });
    
    return { voices: currentValues };
}

// ==============================================
// PRESET DATA APPLICATION - Update UI from preset
// ==============================================
// PURPOSE: Apply loaded preset values to UI and audio
// PATTERN: Controller fires event → Widget updates controls → Model updates audio
// ISRESUME: Respects element.dataset.manuallyAdjusted flags
// - If control manually adjusted: Preserve screen value (skip preset value)
// - If forceUpdate=true: Always apply preset (used for initial load)
// ==============================================

function updateFaderPositions(presetData, forceUpdate = false) {
    if (!presetData || !presetData.voices) return;
    
    const faders = document.querySelectorAll('.voice-fader');
    
    Object.keys(presetData.voices).forEach(voiceKey => {
        const voiceIndex = parseInt(voiceKey) - 1;
        const voiceData = presetData.voices[voiceKey];
        
        // Update volume faders
        if (voiceIndex >= 0 && voiceIndex < faders.length && voiceData.volume !== undefined) {
            const fader = faders[voiceIndex];
            const handle = fader.querySelector('.fader-handle');
            
            // Check IsResume flag (skip if manually adjusted, unless forcing)
            if (forceUpdate || fader.dataset.manuallyAdjusted !== 'true') {
                const volumeDb = voiceData.volume;
                const faderPosition = Math.max(0, Math.min(100, ((volumeDb - FADER_SILENCE_FLOOR_DB) / Math.abs(FADER_SILENCE_FLOOR_DB)) * 100));
                
                if (handle) {
                    // Apply positioning constraint (keeps handle center within track)
                    const constrainedPercent = 5 + (faderPosition * 0.9);
                    // CSS EXCEPTION: Fader positioning requires inline styles
                    handle.style.bottom = constrainedPercent + '%';
                    // Update audio immediately
                    setVoiceVolume(voiceIndex, volumeDb);
                    setIsoVoiceVolume(voiceIndex, volumeDb);
                }
            }
        }
        
        // Update octave buttons (delegated to binaural_controls.js)
        if (voiceData.octave !== undefined) {
            const octaveWidget = document.querySelector(`.octave-widget[data-voice="${voiceKey}"]`);
            
            if (forceUpdate || !octaveWidget || octaveWidget.dataset.manuallyAdjusted !== 'true') {
                updateOctaveControlDisplay(parseInt(voiceKey), voiceData.octave);
                updateVoiceOctave(parseInt(voiceKey), voiceData.octave);
            }
        }
        
        // Update width sliders (delegated to binaural_controls.js)
        if (voiceData.stereoWidth !== undefined) {
            const widthControl = document.querySelector(`.width-control[data-voice="${voiceKey}"]`);
            
            if (forceUpdate || !widthControl || widthControl.dataset.manuallyAdjusted !== 'true') {
                updateWidthPositionFromPreset(parseInt(voiceKey), voiceData.stereoWidth);
            }
        }
        
        // Update ISO crossfade sliders (delegated to binaural_controls.js)
        if (voiceData.isochronic !== undefined) {
            const isoControl = document.querySelector(`.pulse-control[data-voice="${voiceKey}"]`);
            
            if (forceUpdate || !isoControl || isoControl.dataset.manuallyAdjusted !== 'true') {
                updateIsoPositionFromPreset(parseInt(voiceKey), voiceData.isochronic);
            }
        }
        
        // Update length sliders (delegated to binaural_controls.js)
        if (voiceData.dutycycle !== undefined) {
            const lengthControl = document.querySelector(`.length-control[data-voice="${voiceKey}"]`);
            
            if (forceUpdate || !lengthControl || lengthControl.dataset.manuallyAdjusted !== 'true') {
                updateLengthPositionFromPreset(parseInt(voiceKey), voiceData.dutycycle);
            }
        }
    });
}

// Global exposure for cross-widget access
// Allows other widgets to query octave display state
if (typeof window !== 'undefined') {
  window.BinauralWidget = window.BinauralWidget || {};
  window.BinauralWidget.updateOctaveControlDisplay = updateOctaveControlDisplay;
}

// Transport bridge - moved to transport_widget.js
// Other widgets request renders through TransportAPI

// ==============================================
// CONTENT NAVIGATION - Page controls (5 pages)
// ==============================================
// PURPOSE: Navigate between content box pages in binaural panel
// PATTERN: Prev/Next buttons cycle through pages with wrap-around
// CSS HANDLING: Page visibility controlled by .active class (defined in CSS)
// - When user clicks prev/next: Calculate new page, toggle .active
// - Wrap-around: Page 5 → next → Page 1, Page 1 → prev → Page 5
// HTML STRUCTURE: Expects elements with IDs:
// - binaural-nav-prev, binaural-nav-next: Navigation buttons
// - .binaural-page-number: Page number display
// - .binaural-page-{N}: Individual pages (1-5)
// ==============================================

function initBinauralContentNavigation() {
    let currentPage = 1; // Current page (1-based for display)
    const totalPages = 5; // Total number of content pages
    
    const prevButton = document.getElementById('binaural-nav-prev');
    const nextButton = document.getElementById('binaural-nav-next');
    const pageNumber = document.querySelector('.binaural-page-number');
    
    if (!prevButton || !nextButton || !pageNumber) {
        console.warn('Binaural navigation elements not found');
        return;
    }
    
    // Update page display (hide all pages, show current, update number)
    function updatePage() {
        // Hide all pages by removing .active class
        document.querySelectorAll('.binaural-page').forEach(page => {
            page.classList.remove('active');
        });
        
        // Show current page by adding .active class
        const currentPageElement = document.querySelector(`.binaural-page-${currentPage}`);
        if (currentPageElement) {
            currentPageElement.classList.add('active');
        }
        
        // Update page number display
        pageNumber.textContent = currentPage;
    }
    
    // Navigate to previous page (with wrap-around to last)
    function goToPrevPage() {
        currentPage = currentPage > 1 ? currentPage - 1 : totalPages; // Wrap to last page
        updatePage();
    }
    
    // Navigate to next page (with wrap-around to first)
    function goToNextPage() {
        currentPage = currentPage < totalPages ? currentPage + 1 : 1; // Wrap to first page
        updatePage();
    }
    
    // Add event listeners
    prevButton.addEventListener('click', goToPrevPage);
    nextButton.addEventListener('click', goToNextPage);
    
    // Initialize to page 1 on load
    updatePage();
    
    console.log('Binaural content navigation initialized');
}

