console.log('widgets/col3debugger_widget.js loaded');

// Import the bridge class directly
import '../../src/console_column3_bridge_clean.js';

export function initCol3DebuggerWidget() {
    // Prevent re-initialization
    if (document.body.dataset.col3debuggerWidgetInitialized) {
        console.warn('initCol3DebuggerWidget: already initialized, skipping.');
        return;
    }
    document.body.dataset.col3debuggerWidgetInitialized = 'true';

    console.log('🎯 Initializing col3debugger widget...');

    // Initialize console bridge - use singleton instance
    try {
        if (window.ConsoleColumn3Bridge) {
            // Get or create singleton instance
            if (!window.consoleColumn3Bridge) {
                window.consoleColumn3Bridge = new window.ConsoleColumn3Bridge();
            }
            // Use the singleton instance for this widget
            window.col3debuggerBridge = window.consoleColumn3Bridge;
            console.log('✅ col3debugger_widget connected to bridge');
        } else {
            console.error('❌ ConsoleColumn3Bridge not available');
        }
    } catch (error) {
        console.error('❌ Error initializing console bridge:', error);
    }

    // Initialize debug controls
    try {
        initDebugControls();
        console.log('✅ Debug Panel Initialized');
    } catch (error) {
        console.error('❌ Error initializing debug controls:', error);
    }

    // console.log('> 💚 Using panel/widget system for debug output');
}

function initDebugControls() {
    // Lint toggle button  
    const lintBtn = document.getElementById('debug-lint-toggle');
    if (lintBtn) {
        lintBtn.addEventListener('click', () => {
            if (window.col3debuggerBridge) {
                window.col3debuggerBridge.toggleLinting();
            }
        });
    }

    // Copy button
    const copyBtn = document.getElementById('debug-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (window.col3debuggerBridge) {
                window.col3debuggerBridge.copyAllOutput();
            }
        });
    }

    // Clear button  
    const clearBtn = document.getElementById('debug-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (window.col3debuggerBridge) {
                window.col3debuggerBridge.clearOutput();
            }
        });
    }
}

// Export for global access if needed
if (typeof window !== 'undefined') {
    window.initCol3DebuggerWidget = initCol3DebuggerWidget;
}