// ============================================================================
// JOURNEYMAP UI MODULE - Preset Selector & Save Modal
// ============================================================================
// EXTRACTION: Generic preset UI controller separated from main widget
// PATTERN: Reusable preset navigation system (can be used by other widgets)
// DEPENDENCIES: Requires listRecipeFiles, processAllRecipes, preset_resources
//
// RESPONSIBILITIES:
// - Preset selector navigation (prev/next buttons)
// - Save modal UI (save new vs overwrite)
// - Preset name input validation
// - Preset list management
// - Button flash animations
// - Local storage integration (last saved preset)
//
// DELEGATES TO:
// - renderPreset() callback (widget-provided)
// - getCurrentPresetData() callback (widget-provided)
// - getCurrentPresetFilename() callback (widget-provided)
// - collectPresetFromDOM() (preset_resources.js)
// - savePresetFile() (preset_resources.js)
//
// REUSABILITY:
// This module can be used by ANY widget that needs preset management
// Just provide the required DOM elements and callbacks in options object
// ============================================================================

import { listRecipeFiles, processAllRecipes } from "../../src/interpreter.js";
import {
  collectPresetFromDOM,
  savePresetFile,
  importPresetObject,
  getPreset
} from "../../src/preset_resources.js";

// ==============================================
// PRESET CONTROLLER - Generic Presetter System
// ==============================================
// PURPOSE: Wire up preset listing, navigation, and save modal
// PATTERN: Options object with DOM refs + callbacks → Returns controller API
// REUSABLE: Works for journeymap, binaural, noise, sub, any preset-based widget
//
// OPTIONS OBJECT:
// {
//   // DOM Elements (required)
//   presetDisplay: Element,    // Shows current preset name
//   presetPrev: Button,        // Previous preset button
//   presetNext: Button,        // Next preset button
//   journeySequence: Element,  // Container for collectPresetFromDOM()
//   
//   // Save Modal Elements (optional)
//   saveBtn: Button,           // Triggers save modal
//   revertBtn: Button,         // Reverts to saved (not implemented yet)
//   saveModal: Element,        // Modal dialog container
//   modalSaveNew: Button,      // Save as new preset
//   modalOverwrite: Button,    // Overwrite existing preset
//   modalBack: Button,         // Close modal
//   presetNameInput: Input,    // Preset name input field
//   nameCount: Element,        // Character count display
//   
//   // Debug (optional)
//   debugPanel: Element,       // Shows preset list
//   
//   // Callbacks (required)
//   renderPreset: async (name) => {},           // Load and display preset
//   getCurrentPresetData: () => {},             // Get current preset data
//   getCurrentPresetFilename: () => 'filename'  // Get current filename
// }
//
// RETURNS:
// {
//   getPresets: () => string[],    // Get all preset names
//   getCurrentIndex: () => number,  // Get current preset index
//   refresh: async () => {}         // Refresh preset list
// }
export async function createPresetController(options = {}) {
  const {
    debugPanel,
    presetDisplay,
    presetPrev,
    presetNext,
    journeySequence,
    saveBtn,
    revertBtn,
    saveModal,
    modalSaveNew,
    modalOverwrite,
    modalBack,
    presetNameInput,
    nameCount,
    renderPreset,
    getCurrentPresetData,
    getCurrentPresetFilename,
  } = options;

  // ==============================================
  // HELPER: Update Preset Text Display
  // ==============================================
  // PURPOSE: Update preset name without breaking button elements
  // PATTERN: Preserve buttons, replace text node only
  function updatePresetText(newText) {
    if (!presetDisplay) return;
    
    // Find all button elements
    const buttons = presetDisplay.querySelectorAll('button');
    
    // Clear all content
    presetDisplay.innerHTML = '';
    
    // Add first button if exists
    if (buttons[0]) presetDisplay.appendChild(buttons[0]);
    
    // Add text node
    presetDisplay.appendChild(document.createTextNode(newText));
    
    // Add second button if exists  
    if (buttons[1]) presetDisplay.appendChild(buttons[1]);
  }

  // ==============================================
  // HELPER: Get Current Preset Text
  // ==============================================
  // PURPOSE: Extract preset name from display (ignoring buttons)
  // PATTERN: Collect text nodes only
  function getCurrentPresetText() {
    if (!presetDisplay) return '';
    
    // Get text content excluding button text
    const textNodes = [];
    for (const node of presetDisplay.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        textNodes.push(node.textContent);
      }
    }
    return textNodes.join('').trim();
  }

  // Validation: Check critical elements
  if (!presetPrev || !presetNext || !presetDisplay) {
    console.error('Critical preset controller elements missing!');
  }

  let presets = [];
  let currentPresetIndex = 0;
  let isSaving = false;

  // ==============================================
  // INITIALIZATION - Load Preset List
  // ==============================================
  try {
    await processAllRecipes();
    presets = await listRecipeFiles();
    
    // Restore last saved preset (if page reloaded during save)
    // This prevents external file watchers from losing user work
    try {
      const last = localStorage.getItem('auramax:lastSavedPresetId');
      if (last) {
        const lp = await getPreset(last);
        if (lp && lp.name) {
          const short = (lp.name || '').replace(/\.json$/i, '');
          if (!presets.includes(short)) presets.unshift(short);
          currentPresetIndex = presets.indexOf(short);
          if (presetDisplay) updatePresetText(presets[currentPresetIndex]);
          if (renderPreset) await renderPreset(lp);
        }
      }
    } catch (e) {
      console.warn('Failed to restore last saved preset', e);
    }
    
    if (debugPanel) debugPanel.textContent = (presets || []).join('\n');
    
    if (presets.length > 0) {
      currentPresetIndex = 0;
      if (presetDisplay) updatePresetText(presets[currentPresetIndex]);
      if (renderPreset) await renderPreset(presets[currentPresetIndex]);
    }
  } catch (err) {
    if (debugPanel) debugPanel.textContent = `Error: ${err.message}`;
    console.error('createPresetController init error', err);
  }

  // ==============================================
  // BUTTON FLASH ANIMATION
  // ==============================================
  // PURPOSE: Visual feedback on button clicks
  // PATTERN: Add .inverted class → Remove after 160ms
  function flashButton(btn) {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      const el = e.currentTarget;
      el.classList.add('inverted');
      setTimeout(() => el.classList.remove('inverted'), 160);
    });
  }

  // ==============================================
  // SAVE BUTTON - Open Modal
  // ==============================================
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (saveModal) saveModal.setAttribute('aria-hidden', 'false');
      if (presetNameInput) {
        presetNameInput.value = '';
        const current = getCurrentPresetText() || '';
        presetNameInput.placeholder = current || 'Preset name (max 18)';
        presetNameInput.dataset.pristine = 'true';
        if (nameCount) nameCount.textContent = String(presetNameInput.maxLength || 18);
      }
      if (modalSaveNew) modalSaveNew.disabled = true;
    });
  }

  // ==============================================
  // PRESET NAME INPUT - Validation & Character Count
  // ==============================================
  if (presetNameInput) {
    const max = Number(presetNameInput.getAttribute('maxlength') || 18);
    const update = () => {
      const v = presetNameInput.value || '';
      const remaining = Math.max(0, max - v.length);
      if (nameCount) nameCount.textContent = String(remaining);
      if (modalSaveNew) modalSaveNew.disabled = v.trim().length === 0;
    };
    presetNameInput.addEventListener('input', update);
    presetNameInput.addEventListener('keydown', update);
    presetNameInput.addEventListener('focus', () => {
      if (presetNameInput.dataset.pristine === 'true') {
        const current = getCurrentPresetText() || '';
        presetNameInput.value = current;
        presetNameInput.select();
        if (nameCount) nameCount.textContent = String(max - (presetNameInput.value || '').length);
        if (modalSaveNew) modalSaveNew.disabled = (presetNameInput.value || '').trim().length === 0;
        delete presetNameInput.dataset.pristine;
      }
    });
  }

  // ==============================================
  // PRESET NORMALIZATION - Wrap Raw Data
  // ==============================================
  // PURPOSE: Ensure preset has proper structure (name, widget_type, payload)
  // PATTERN: Detect format → Normalize → Return canonical structure
  function _normalizePresetForSave(payload, nameOverride) {
    if (!payload || typeof payload !== 'object') return null;
    
    // Case A: Already a full preset (has id or widget_type and payload.segments)
    if (payload.id || payload.widget_type || (payload.payload && Array.isArray(payload.payload.segments))) {
      const top = Object.assign({}, payload);
      if (nameOverride) top.name = nameOverride;
      top.widget_type = top.widget_type || 'journeymap';
      
      // Unwrap double-wrapped payloads (if any)
      let inner = top.payload;
      while (inner && inner.payload) inner = inner.payload;
      top.payload = inner || top.payload || { segments: [] };
      return top;
    }
    
    // Case B: Raw journey data (segments list) - wrap into preset
    return {
      name: nameOverride || (payload && payload.name) || 'preset',
      widget_type: 'journeymap',
      payload: payload,
      tags: [],
      author: { name: 'Unknown' }
    };
  }

  // ==============================================
  // SAVE NEW PRESET - Modal Handler
  // ==============================================
  if (modalSaveNew) {
    modalSaveNew.addEventListener('click', async (e) => {
      const el = e.currentTarget;
      const name = (presetNameInput && presetNameInput.value.trim()) || '';
      if (!name) return;
      if (isSaving) return;
      isSaving = true;
      if (modalSaveNew) modalSaveNew.disabled = true;
      if (modalOverwrite) modalOverwrite.disabled = true;
      el.classList.add('inverted');
      
      try {
        // Collect preset data (prefer live DOM, fallback to in-memory)
        let payload = collectPresetFromDOM(journeySequence);
        if (!payload && typeof getCurrentPresetData === 'function') payload = getCurrentPresetData();
        
        if (!payload) {
          alert('No preset loaded to save.');
        } else {
          const normalized = _normalizePresetForSave(payload, name);
          if (!normalized) {
            alert('Failed to normalize preset for saving.');
          } else {
            // Save to IndexedDB first (prevents loss on external reload)
            let savedPreset = null;
            try {
              savedPreset = await importPresetObject(normalized);
              try { localStorage.setItem('auramax:lastSavedPresetId', savedPreset.id); } catch (e) {}
            } catch (err) {
              console.error('Import before save failed', err);
            }
            
            // Update UI immediately
            try {
              const uiPreset = savedPreset || normalized;
              const short = (name || uiPreset.name || '').replace(/\.json$/i, '');
              if (!presets.includes(short)) presets.push(short);
              currentPresetIndex = presets.indexOf(short);
              if (presetDisplay) updatePresetText(presets[currentPresetIndex]);
              if (debugPanel) debugPanel.textContent = (presets || []).join('\n');
              if (renderPreset) await renderPreset(uiPreset);
            } catch (err) {
              console.error('Failed to update UI after import', err);
            }

            // Hide modal before native dialog (prevents overlay issues)
            if (saveModal) saveModal.setAttribute('aria-hidden', 'true');
            
            // Save to disk (native file dialog)
            const res = await savePresetFile(savedPreset || normalized, name, name);
            try { document.activeElement && document.activeElement.blur(); } catch (e) {}
            
            if (!res || !res.saved) {
              if (res && res.via === 'native' && res.cancelled) {
                console.log('User cancelled native save dialog; save-to-disk aborted.');
              } else {
                console.error('Save file to disk did not complete', res);
                alert('Save to disk did not complete (app copy retained).');
              }
            }
          }
        }
      } catch (err) {
        console.error('Save failed', err);
      }
      
      setTimeout(() => {
        el.classList.remove('inverted');
        if (saveModal) saveModal.setAttribute('aria-hidden', 'true');
        isSaving = false;
        if (modalSaveNew) modalSaveNew.disabled = true;
        if (modalOverwrite) modalOverwrite.disabled = false;
      }, 160);
    });
  }

  // ==============================================
  // OVERWRITE PRESET - Modal Handler
  // ==============================================
  if (modalOverwrite) {
    modalOverwrite.addEventListener('click', async (e) => {
      const el = e.currentTarget;
      if (isSaving) return;
      isSaving = true;
      if (modalSaveNew) modalSaveNew.disabled = true;
      if (modalOverwrite) modalOverwrite.disabled = true;
      el.classList.add('inverted');
      
      const suggested = (typeof getCurrentPresetFilename === 'function' && getCurrentPresetFilename()) || (presetNameInput && presetNameInput.value.trim()) || 'preset';
      
      try {
        // Collect preset data (prefer live DOM, fallback to in-memory)
        let payload = collectPresetFromDOM(journeySequence);
        if (!payload && typeof getCurrentPresetData === 'function') payload = getCurrentPresetData();
        
        if (!payload) {
          alert('No preset loaded to save.');
        } else {
          const nameToUse = suggested.replace(/\.json$/i, '') || (presetNameInput && presetNameInput.value.trim()) || 'preset';
          const normalized = _normalizePresetForSave(payload, nameToUse);
          
          if (!normalized) {
            alert('Failed to normalize preset for saving.');
          } else {
            // Save to IndexedDB first
            let savedPreset = null;
            try {
              savedPreset = await importPresetObject(normalized);
              try { localStorage.setItem('auramax:lastSavedPresetId', savedPreset.id); } catch (e) {}
            } catch (err) {
              console.error('Import before overwrite failed', err);
            }
            
            // Update UI
            try {
              const uiPreset = savedPreset || normalized;
              const short = nameToUse;
              if (!presets.includes(short)) presets.push(short);
              currentPresetIndex = presets.indexOf(short);
              if (presetDisplay) updatePresetText(presets[currentPresetIndex]);
              if (debugPanel) debugPanel.textContent = (presets || []).join('\n');
              if (renderPreset) await renderPreset(uiPreset);
            } catch (err) {
              console.error('Failed to update UI after import', err);
            }

            if (saveModal) saveModal.setAttribute('aria-hidden', 'true');
            
            // Save to disk (native file dialog allows overwrite confirmation)
            const res = await savePresetFile(savedPreset || normalized, nameToUse, nameToUse);
            try { document.activeElement && document.activeElement.blur(); } catch (e) {}
            
            if (!res || !res.saved) {
              if (res && res.via === 'native' && res.cancelled) {
                console.log('User cancelled native overwrite dialog; save-to-disk aborted.');
              } else {
                console.error('Overwrite to disk did not complete', res);
                alert('Overwrite to disk did not complete (app copy retained).');
              }
            }
          }
        }
      } catch (err) {
        console.error('Overwrite failed', err);
      }
      
      setTimeout(() => {
        el.classList.remove('inverted');
        if (saveModal) saveModal.setAttribute('aria-hidden', 'true');
        isSaving = false;
        if (modalSaveNew) modalSaveNew.disabled = true;
        if (modalOverwrite) modalOverwrite.disabled = false;
      }, 160);
    });
  }

  // ==============================================
  // MODAL BACK BUTTON - Close Modal
  // ==============================================
  if (modalBack) {
    modalBack.addEventListener('click', () => {
      modalBack.classList.add('inverted');
      setTimeout(() => {
        modalBack.classList.remove('inverted');
        if (saveModal) saveModal.setAttribute('aria-hidden', 'true');
      }, 120);
    });
  }

  // Attach flash animations to save/revert buttons
  flashButton(saveBtn);
  flashButton(revertBtn);

  // ==============================================
  // NAVIGATION HANDLERS - Prev/Next Preset
  // ==============================================
  if (presetPrev) {
    presetPrev.addEventListener('click', async () => {
      if (presets.length > 0) {
        currentPresetIndex = (currentPresetIndex - 1 + presets.length) % presets.length;
        if (presetDisplay) updatePresetText(presets[currentPresetIndex]);
        if (renderPreset) await renderPreset(presets[currentPresetIndex]);
      }
    });
  }
  
  if (presetNext) {
    presetNext.addEventListener('click', async () => {
      if (presets.length > 0) {
        currentPresetIndex = (currentPresetIndex + 1) % presets.length;
        if (presetDisplay) updatePresetText(presets[currentPresetIndex]);
        if (renderPreset) await renderPreset(presets[currentPresetIndex]);
      }
    });
  }

  // ==============================================
  // RETURN API - Public Methods
  // ==============================================
  return {
    getPresets: () => presets.slice(),
    getCurrentIndex: () => currentPresetIndex,
    refresh: async () => {
      // Preserve currently displayed preset (don't reset to presets[0])
      const currentName = getCurrentPresetText() || (presets[currentPresetIndex]) || null;
      presets = await listRecipeFiles();
      
      if (!presets || presets.length === 0) {
        currentPresetIndex = 0;
        if (presetDisplay) updatePresetText('');
        return;
      }
      
      if (currentName) {
        const idx = presets.indexOf(currentName);
        if (idx !== -1) {
          currentPresetIndex = idx;
        } else {
          // Keep existing index if valid, else clamp to 0
          if (currentPresetIndex < 0 || currentPresetIndex >= presets.length) currentPresetIndex = 0;
        }
      } else {
        if (currentPresetIndex < 0 || currentPresetIndex >= presets.length) currentPresetIndex = 0;
      }
      
      if (presetDisplay) updatePresetText(presets[currentPresetIndex]);
    }
  };
}
