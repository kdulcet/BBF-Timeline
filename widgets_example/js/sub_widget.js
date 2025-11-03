// Sub Widget
// Subharmonic/sub-bass frequency generator

export function initSubWidget() {
    console.log('🔊 Initializing sub panel');

    // Initialize back arrow to load main panel
    const backArrow = document.querySelector('#control-panel-sub .control-panel-back-arrow');
    if (backArrow) {
        backArrow.addEventListener('click', async () => {
            console.log('🔙 Back arrow clicked - loading main panel');
            if (window.panelLoader) {
                await window.panelLoader.loadPanel('main_panel', 'control-panel-container');
            }
        });
    }

    // Additional sub widget initialization here...
}
