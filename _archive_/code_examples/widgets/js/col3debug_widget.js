// console.log('widgets/col3debug_widget.js loaded');

// Import the bridge class directly
import '../../src/console_column3_bridge_clean.js';

export function initCol3DebugWidget() {
    // Prevent re-initialization
    if (document.body.dataset.col3debugWidgetInitialized) {
        console.warn('initCol3DebugWidget: already initialized, skipping.');
        return;
    }
    document.body.dataset.col3debugWidgetInitialized = 'true';

    console.log('🎯 Initializing col3debug widget...');

    // Initialize console bridge - use singleton instance
    try {
        if (window.ConsoleColumn3Bridge) {
            // Get or create singleton instance
            if (!window.consoleColumn3Bridge) {
                window.consoleColumn3Bridge = new window.ConsoleColumn3Bridge();
            }
            // Use the singleton instance for this widget
            window.col3debugBridge = window.consoleColumn3Bridge;
            console.log('✅ col3debug_widget connected to bridge');
        } else {
            console.error('❌ ConsoleColumn3Bridge class not found');
        }
    } catch (error) {
        console.error('❌ Failed to initialize console bridge:', error);
    }

    // Initialize debug controls
    try {
        initDebugControls();
        console.log('✅ Debug Panel Initialized');
    } catch (error) {
        console.error('❌ Failed to initialize debug controls:', error);
    }
}

function initDebugControls() {
    const copyBtn = document.getElementById('debug-copy-btn');
    const clearBtn = document.getElementById('debug-clear-btn');
    const lintToggle = document.getElementById('debug-lint-toggle');
    
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (window.col3debugBridge && window.col3debugBridge.copyAllOutput) {
                window.col3debugBridge.copyAllOutput();
            }
        });
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (window.col3debugBridge && window.col3debugBridge.clearOutput) {
                window.col3debugBridge.clearOutput();
            }
        });
    }
    
    if (lintToggle) {
        lintToggle.addEventListener('click', () => {
            if (window.col3debugBridge && window.col3debugBridge.toggleLinting) {
                const enabled = window.col3debugBridge.toggleLinting();
                lintToggle.textContent = enabled ? 'Lint' : 'Plain';
                lintToggle.classList.toggle('enabled', enabled);
                lintToggle.title = enabled ? 'Disable syntax highlighting' : 'Enable syntax highlighting';
            }
        });
    }
}

// Export for consistency with other widgets
export { initDebugControls };