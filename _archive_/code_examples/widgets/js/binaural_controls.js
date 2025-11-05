// ============================================================================
// BINAURAL WIDGET CONTROLS - Specialized Control Module (Refactored Phase 3)
// ============================================================================
// MVC ARCHITECTURE: VIEW LAYER - Control initialization and user interaction
//
// RESPONSIBILITY: Initialize and manage binaural-specific controls
// - Octave buttons (harmonic offset selection)
// - Width sliders (stereo positioning)
// - Length sliders (isochronic pulse duration)
// - ISO crossfade (binaural/isochronic blend)
//
// PATTERN: Widget imports this module, module calls Model setters directly
// - Widget (binaural_widget.js) orchestrates initialization
// - Controls module (this file) handles user interaction
// - Model (binaural_synth.js + binaural_iso.js) processes audio
//
// CSS COMPLIANCE: Uses data attributes for state, CSS classes for styling
// - element.dataset.manuallyAdjusted = 'true' triggers IsResume flag
// - CSS handles all visual presentation via classes
// - No inline styles except for slider positioning (UI control necessity)
// ============================================================================

import { initHorizontalSlider, constrainSliderPercent } from '../../src/ui_linear_controls.js';
import { setVoiceOctaveOffset, setVoiceWidth, setCrossfadeGain } from '../synths/binaural_synth.js';
import { setVoiceOctaveOffset as setIsoVoiceOctaveOffset, setVoiceWidth as setIsoVoiceWidth, setCrossfadeGain as setIsoCrossfadeGain, setPulseLength } from '../synths/binaural_iso.js';

// Audio constants - compensate for psychoacoustic differences between synth types
const ISO_MAKEUP_GAIN_DB = 2;        // +2dB boost for isochronic (gating reduces perceived loudness)
const ISO_CROSSFADE_CURVE = 1;       // Linear crossfade (1 = equal power, >1 = bias toward ISO)

// ============================================================================
// OCTAVE CONTROLS - Harmonic transposition buttons
// ============================================================================
// PURPOSE: Shift voice frequencies up/down by octaves (-2, -1, 0, +1, +2)
// PATTERN: Button click → Mark manual → Notify controller → Update both synths
// CSS: Uses .active class for visual state (no inline styles)
// ============================================================================

export function initOctaveControls() {
    const octaveWidgets = document.querySelectorAll('.octave-widget');
    
    octaveWidgets.forEach(widget => {
        const voiceNumber = parseInt(widget.dataset.voice);
        const buttons = widget.querySelectorAll('.octave-btn');
        
        buttons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const octaveValue = parseInt(button.dataset.oct);
                console.log(`Voice ${voiceNumber} octave clicked: ${octaveValue}`);
                
                // MVC: Mark element as manually adjusted (triggers IsResume flag in Controller)
                widget.dataset.manuallyAdjusted = 'true';
                
                // Notify Controller of manual change (sets IsResume = true)
                import('../presets/binaural_presets.js').then(module => {
                    module.notifyManualAdjustment();
                });
                
                // CSS: Toggle .active class for visual feedback (no inline styles)
                buttons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // Call Model setters to update audio immediately
                updateVoiceOctave(voiceNumber, octaveValue);
            });
        });
    });
    
    console.log('Octave controls initialized for all voices');
}

function updateVoiceOctave(voiceNumber, octaveOffset) {
    // Convert 1-based voice number to 0-based index for Model layer
    const voiceIndex = voiceNumber - 1;
    
    try {
        // Update BOTH synths (binaural + isochronic must stay in sync)
        setVoiceOctaveOffset(voiceIndex, octaveOffset);
        setIsoVoiceOctaveOffset(voiceIndex, octaveOffset);
        console.log(`🎵 Updated Voice ${voiceNumber} octave to ${octaveOffset}`);
        
        // Sync timeline with octave change (journeymap tracks Hz progression)
        const journeyData = window.JourneymapWidget?.collectJourneyDataFromDOM();
        if (journeyData && journeyData.segments) {
            console.log(`🔄 Triggering journeymapRestart after octave change`);
            window.dispatchEvent(new CustomEvent('journeymapRestart', {
                detail: { 
                    timeline: { segments: journeyData.segments },
                    preset: journeyData
                }
            }));
        }
    } catch (e) {
        console.error('Error updating voice octave:', e);
    }
}

export function updateOctaveControlDisplay(voiceNumber, octaveValue) {
    // Called by Controller when loading presets (updates UI without triggering events)
    const octaveWidget = document.querySelector(`.octave-widget[data-voice="${voiceNumber}"]`);
    if (!octaveWidget) return;
    
    // CSS: Update .active class to reflect preset value
    const buttons = octaveWidget.querySelectorAll('.octave-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    const targetButton = octaveWidget.querySelector(`[data-oct="${octaveValue}"]`);
    if (targetButton) {
        targetButton.classList.add('active');
        console.log(`🎵 Updated octave control for Voice ${voiceNumber} to ${octaveValue}`);
    }
}

// ============================================================================
// WIDTH CONTROLS - Stereo field positioning sliders
// ============================================================================
// PURPOSE: Control stereo width (0% = mono center, 100% = full stereo spread)
// PATTERN: Drag slider → Generic initHorizontalSlider → Callback to update audio
// CSS EXCEPTION: Slider handle position uses inline styles (UI control necessity)
// - Handle.style.left is acceptable for interactive sliders
// - All other presentation must use CSS classes
// ============================================================================

export function initWidthControls() {
    const widthControls = document.querySelectorAll('.width-control');
    
    widthControls.forEach(control => {
        const voiceNumber = parseInt(control.dataset.voice);
        
        // Use generic horizontal slider from ui_linear_controls.js
        initHorizontalSlider(control, {
            onChange: (value, percent) => {
                updateWidthPosition(voiceNumber, percent);
            },
            onManualAdjust: () => {
                // Mark control as manually adjusted (triggers IsResume)
                control.dataset.manuallyAdjusted = 'true';
                import('../presets/binaural_presets.js').then(module => {
                    module.notifyManualAdjustment();
                });
            }
        });
    });
    
    console.log('Width controls initialized for all voices');
}

function updateWidthPosition(voiceNumber, percent) {
    const widthValue = percent / 100;  // Convert 0-100% to 0.0-1.0 ratio
    
    console.log(`🎚️ Width ${voiceNumber} manually adjusted to ${percent}% (${widthValue})`);
    
    try {
        // Update BOTH synths with stereo width value
        // Note: Binaural uses 1-based voice numbers, Isochronic uses 0-based indices
        setVoiceWidth(voiceNumber, widthValue);           // Binaural: 1-5
        setIsoVoiceWidth(voiceNumber - 1, widthValue);    // Isochronic: 0-4
        console.log(`setVoiceWidth(${voiceNumber}, ${widthValue}) call successful for both synths`);
    } catch (error) {
        console.error(`Width control error for voice ${voiceNumber}:`, error);
    }
}

export function updateWidthPositionFromPreset(voiceNumber, stereoWidth) {
    // Called by Controller when loading presets (updates UI + audio without manual flag)
    const widthControl = document.querySelector(`.width-control[data-voice="${voiceNumber}"]`);
    const widthHandle = widthControl?.querySelector('.width-handle');
    
    if (widthControl && widthHandle) {
        const widthPercent = Math.round(stereoWidth * 100);
        const constrainedPercent = constrainSliderPercent(widthPercent);
        // CSS EXCEPTION: Slider positioning requires inline styles
        widthHandle.style.left = `${constrainedPercent}%`;
        // Update audio immediately (no manual adjustment flag set)
        setVoiceWidth(voiceNumber, stereoWidth);
        setIsoVoiceWidth(voiceNumber - 1, stereoWidth);
    }
}

// ============================================================================
// LENGTH CONTROLS - Isochronic pulse duration sliders
// ============================================================================
// PURPOSE: Control pulse duty cycle (20%-70% of beat period)
// RANGE: 0.2-0.7 duty cycle (shorter = sharper attack, longer = smoother envelope)
// PATTERN: Generic slider with value mapping (percent → duty cycle)
// CSS EXCEPTION: Slider handle position uses inline styles (UI control necessity)
// ============================================================================

export function initLengthControls() {
    const lengthControls = document.querySelectorAll('.length-control');
    
    lengthControls.forEach(control => {
        const voiceNumber = parseInt(control.dataset.voice);
        
        // Use generic horizontal slider with custom value mapping
        initHorizontalSlider(control, {
            // Map UI percentage (0-100%) to audio duty cycle (0.2-0.7)
            mapValue: (percent) => 0.2 + (percent / 100) * 0.5,
            onChange: (lengthValue, percent) => {
                updateLengthPosition(voiceNumber, lengthValue, percent);
            },
            onManualAdjust: () => {
                control.dataset.manuallyAdjusted = 'true';
                import('../presets/binaural_presets.js').then(module => {
                    module.notifyManualAdjustment();
                });
            }
        });
    });
    
    console.log('Length controls initialized for all voices');
}

function updateLengthPosition(voiceNumber, lengthValue, percent) {
    console.log(`🎚️ Length ${voiceNumber} manually adjusted to ${percent.toFixed(1)}% (${lengthValue.toFixed(2)} duty cycle)`);
    
    try {
        // Update isochronic synth only (binaural doesn't have pulse length)
        // Uses 0-based index (voiceNumber - 1)
        setPulseLength(voiceNumber - 1, lengthValue);
        console.log(`setPulseLength(${voiceNumber - 1}, ${lengthValue.toFixed(2)}) call successful`);
    } catch (error) {
        console.error(`Length control error for voice ${voiceNumber}:`, error);
    }
}

export function updateLengthPositionFromPreset(voiceNumber, dutycycle) {
    // Called by Controller when loading presets (updates UI + audio)
    const lengthControl = document.querySelector(`.length-control[data-voice="${voiceNumber}"]`);
    const lengthHandle = lengthControl?.querySelector('.length-handle');
    
    if (lengthControl && lengthHandle) {
        // Reverse map: duty cycle (0.2-0.7) → UI percentage (0-100%)
        const lengthPercent = Math.round(((dutycycle - 0.2) / 0.5) * 100);
        const constrainedPercent = constrainSliderPercent(lengthPercent);
        // CSS EXCEPTION: Slider positioning requires inline styles
        lengthHandle.style.left = `${constrainedPercent}%`;
        // Update audio immediately
        setPulseLength(voiceNumber - 1, dutycycle);
    }
}

// ============================================================================
// ISO CONTROLS - Binaural/Isochronic crossfade sliders
// ============================================================================
// PURPOSE: Blend between continuous binaural tones and pulsed isochronic beats
// ALGORITHM: Equal-power crossfade with makeup gain for psychoacoustic balance
// - 0% = 100% binaural (continuous tones)
// - 100% = 100% isochronic (pulsed beats)
// - Middle positions blend both synths smoothly
// PATTERN: Generic slider → Power curve → dB conversion → Dual synth updates
// CSS EXCEPTION: Slider handle position uses inline styles (UI control necessity)
// ============================================================================

export function initIsoControls() {
    const isoControls = document.querySelectorAll('.pulse-control');
    
    isoControls.forEach(control => {
        const voiceNumber = parseInt(control.dataset.voice);
        
        // Use generic horizontal slider for crossfade control
        initHorizontalSlider(control, {
            onChange: (value, percent) => {
                updateIsoPosition(voiceNumber, percent);
            },
            onManualAdjust: () => {
                control.dataset.manuallyAdjusted = 'true';
                import('../presets/binaural_presets.js').then(module => {
                    module.notifyManualAdjustment();
                });
            }
        });
    });
    
    console.log('ISO controls initialized for all voices');
}

function updateIsoPosition(voiceNumber, percent) {
    // Equal-power crossfade algorithm (prevents volume dips at center)
    const rawIsoRatio = percent / 100;
    const rawBinauralRatio = 1 - rawIsoRatio;
    
    // Apply power curve for perceptually smooth crossfade
    const isoRatio = Math.pow(rawIsoRatio, .75 / ISO_CROSSFADE_CURVE);
    const binauralRatio = Math.pow(rawBinauralRatio, ISO_CROSSFADE_CURVE);
    
    // Convert ratios to decibels (hard mute at extremes for clean silence)
    const binauralCrossfadeDb = binauralRatio <= 0.001 ? -Infinity : 20 * Math.log10(binauralRatio);
    // Isochronic gets makeup gain to compensate for gating energy loss
    const isoCrossfadeDb = isoRatio <= 0.001 ? -Infinity : (20 * Math.log10(isoRatio) + ISO_MAKEUP_GAIN_DB);
    
    const binauralLabel = binauralCrossfadeDb === -Infinity ? "MUTE" : `${binauralCrossfadeDb.toFixed(1)}dB`;
    const isoLabel = isoCrossfadeDb === -Infinity ? "MUTE" : `${isoCrossfadeDb.toFixed(1)}dB`;
    console.log(`🎚️ ISO ${voiceNumber} crossfade at ${percent.toFixed(1)}% (binaural:${binauralLabel}, iso:${isoLabel})`);
    
    const voiceIndex = voiceNumber - 1;
    try {
        // Update BOTH synths with crossfade gains (stage 2 multiplies with voice gains)
        setCrossfadeGain(voiceIndex, binauralCrossfadeDb);      // Binaural synth
        setIsoCrossfadeGain(voiceIndex, isoCrossfadeDb);        // Isochronic synth
        console.log(`✅ ISO crossfade applied to voice ${voiceNumber}`);
    } catch (error) {
        console.error(`ISO control error for voice ${voiceNumber}:`, error);
    }
}

export function updateIsoPositionFromPreset(voiceNumber, isochronic) {
    // Called by Controller when loading presets (updates UI + audio)
    const isoControl = document.querySelector(`.pulse-control[data-voice="${voiceNumber}"]`);
    const isoHandle = isoControl?.querySelector('.pulse-handle');
    
    if (isoControl && isoHandle) {
        const isoPercent = Math.round(isochronic * 100);
        const constrainedPercent = constrainSliderPercent(isoPercent);
        // CSS EXCEPTION: Slider positioning requires inline styles
        isoHandle.style.left = `${constrainedPercent}%`;
        // Update audio immediately (runs full crossfade calculation)
        updateIsoPosition(voiceNumber, isoPercent);
    }
}
