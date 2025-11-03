// Main Panel Widget
// Navigation hub for AuraMatrix app

export function initMainPanel() {
    console.log('🏠 Initializing main panel');

    // Get noise icon
    const noiseIcon = document.querySelector('.main-nav-icon[alt="Noise"]');
    if (noiseIcon) {
        noiseIcon.addEventListener('click', async () => {
            console.log('🔊 Noise icon clicked - loading noise panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('noise_panel', 'control-panel-container');
                // Re-initialize noise widget after panel loads
                const { initNoiseWidget, initNoiseController } = await import('./noise_widget.js');
                await initNoiseWidget();
                await initNoiseController(); // Also reinitialize preset controller
                // Re-attach noise back arrow listener after panel loads
                attachNoiseBackArrow();
            }
        });
    }

    // Get binaural icon
    const binauralIcon = document.querySelector('.main-nav-icon[alt="Binaural"]');
    if (binauralIcon) {
        binauralIcon.addEventListener('click', async () => {
            console.log('🎵 Binaural icon clicked - loading binaural panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('binaural_panel', 'control-panel-container');
                // Re-initialize binaural widget after panel loads
                const { initBinauralWidget, initBinauralController } = await import('./binaural_widget.js');
                await initBinauralWidget();
                await initBinauralController(); // Also reinitialize preset controller (save button, nav buttons, etc)
                // Re-attach binaural back arrow listener after panel loads
                attachBinauralBackArrow();
            }
        });
    }

    // Get sub icon
    const subIcon = document.querySelector('.main-nav-icon[alt="Sub"]');
    if (subIcon) {
        subIcon.addEventListener('click', async () => {
            console.log('🔊 Sub icon clicked - loading sub panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('sub_panel', 'control-panel-container');
                // Re-initialize sub widget after panel loads
                const { initSubWidget } = await import('./sub_widget.js');
                await initSubWidget();
                // Re-attach sub back arrow listener after panel loads
                attachSubBackArrow();
            }
        });
    }
}

// Attach back arrow listener to noise panel
function attachNoiseBackArrow() {
    const backArrow = document.querySelector('.control-panel-back-arrow');
    if (backArrow) {
        backArrow.addEventListener('click', async () => {
            console.log('🔙 Back arrow clicked - loading main panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('main_panel', 'control-panel-container');
                // Re-initialize main panel after loading
                initMainPanel();
            }
        });
    }
}

// Attach back arrow listener to binaural panel
function attachBinauralBackArrow() {
    const backArrow = document.querySelector('.control-panel-back-arrow');
    if (backArrow) {
        backArrow.addEventListener('click', async () => {
            console.log('🔙 Back arrow clicked - loading main panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('main_panel', 'control-panel-container');
                // Re-initialize main panel after loading
                initMainPanel();
            }
        });
    }
}

// Attach back arrow listener to sub panel
function attachSubBackArrow() {
    const backArrow = document.querySelector('.control-panel-back-arrow');
    if (backArrow) {
        backArrow.addEventListener('click', async () => {
            console.log('🔙 Back arrow clicked - loading main panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('main_panel', 'control-panel-container');
                // Re-initialize main panel after loading
                initMainPanel();
            }
        });
    }
}

// Export for use by other widgets
window.attachBinauralBackArrow = attachBinauralBackArrow;
window.attachNoiseBackArrow = attachNoiseBackArrow;
window.attachSubBackArrow = attachSubBackArrow;
