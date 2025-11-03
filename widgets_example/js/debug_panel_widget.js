// console.log('widgets/debug_panel_widget.js loaded - CONSOLIDATED DEBUG SYSTEM');

// 🔧 CONSOLIDATED DEBUG PANEL WIDGET
// Combines col1debug_widget.js and floatdebug_widget.js into single system
// Follows CSS Style Guide: positioning logic moved to CSS classes

export async function initDebugPanelWidget() {
    // Prevent re-initialization
    if (document.body.dataset.debugPanelInitialized) {
        console.warn('initDebugPanelWidget: already initialized, skipping.');
        return;
    }
    document.body.dataset.debugPanelInitialized = 'true';

    // console.log('🔧 Initializing consolidated debug panel widget...');

    // Initialize debug controller
    const controller = new DebugPanelController();
    
    // Set initial CSS classes immediately to prevent resize flash
    controller.setInitialClasses();
    
    // Position panel in correct container based on saved state
    controller.positionPanel();
    
    // Set up event listeners (now async)
    await setupEventListeners(controller);
    
    // Initialize UI state
    controller.updateElementVisibility();
    controller.updateCheckboxes();
    controller.setIndicatorColors();
    
    // Set initial boundaries state
    document.body.setAttribute('data-debug-boundaries', controller.boundariesActive ? 'visible' : 'hidden');
    if (controller.boundariesActive) {
        setTimeout(() => {
            controller.showBoundarySystem();
        }, 200);
    }

    // Make controller globally accessible for debugging
    if (typeof window !== 'undefined') {
        window.debugPanelController = controller;
    }

    //     // console.log('> 💚 Consolidated Debug panel ready');
}

// Main debug controller class - consolidates both col1debug and floatdebug logic
class DebugPanelController {
    constructor() {
        // Default element states - show essential, hide advanced
        this.elementStates = {
            transport: true,              // Transport controls
            whitePanelBackground: true,   // White panel background
            journeyHeader: true,          // Journey Map header
            frequencyMap: true,           // Frequency boxes
            jmPresetter: false,           // JM preset controls (hidden by default)
            binauralControls: false,      // Binaural control rows (hidden by default)
            binauralPresets: false,       // Binaural preset row (hidden by default)
            
            // CSS Tools - styleguide compliance features
            cssOverrideDetection: false,  // CSS override detective tool
            cssImportantAudit: false,     // !important usage audit
            cssStyleguideCheck: false     // Overall styleguide compliance check
        };

        // Panel positioning state
        this.isDockedToColumn1 = true;    // Start docked by default
        this.boundariesActive = false;
        this.allDivsMode = false;          // Show all divs mode for boundary visualization (col2 limited)
        this.trueAllMode = false;          // Show TRUE all boundaries mode (visual spaghetti)

        // Color scheme for element indicators
        this.colors = {
            transport: '#ff6b35',         // Orange
            whitePanelBackground: '#4ecdc4', // Teal
            journeyHeader: '#45b7d1',     // Blue
            frequencyMap: '#96ceb4',      // Green
            jmPresetter: '#fd79a8',       // Pink
            binauralControls: '#ff1744',  // Red
            binauralPresets: '#9c27b0',   // Purple
            
            // CSS Tools colors
            cssOverrideDetection: '#ffc107', // Amber - for detective work
            cssImportantAudit: '#f44336',    // Red - for violations
            cssStyleguideCheck: '#2196f3'   // Blue - for compliance
        };

        // Load saved state
        this.loadState();
    }

    // Load saved state from localStorage
    loadState() {
        try {
            // Load element states
            const savedElementStates = localStorage.getItem('auramatrix-debug-element-states');
            if (savedElementStates) {
                const parsed = JSON.parse(savedElementStates);
                this.elementStates = { ...this.elementStates, ...parsed };
            }

            // Load positioning state (consolidated key) - FORCE DOCKED FOR COL1DEBUG
            const dockedState = localStorage.getItem('auramatrix-floatdebug-docked');
            this.isDockedToColumn1 = true; // Always start docked for col1debug master

            // Load boundaries state
            const boundariesState = localStorage.getItem('auramatrix-debug-boundaries');
            this.boundariesActive = boundariesState === 'true';
            
            // Load all divs mode state
            const allDivsState = localStorage.getItem('auramatrix-debug-all-divs');
            this.allDivsMode = allDivsState === 'true';
            
            // Load true all mode state
            const trueAllState = localStorage.getItem('auramatrix-debug-true-all');
            this.trueAllMode = trueAllState === 'true';

            // console.log('🔧 DEBUG: State loaded -', {
            //     docked: this.isDockedToColumn1,
            //     boundaries: this.boundariesActive,
            //     allDivs: this.allDivsMode,
            //     elements: Object.keys(this.elementStates).filter(k => this.elementStates[k]).length + ' visible'
            // });
        } catch (error) {
            console.warn('DebugPanel: Failed to load state:', error);
        }
    }

    // Save state to localStorage  
    saveState() {
        try {
            localStorage.setItem('auramatrix-debug-element-states', JSON.stringify(this.elementStates));
            localStorage.setItem('auramatrix-floatdebug-docked', this.isDockedToColumn1.toString());
            localStorage.setItem('auramatrix-debug-boundaries', this.boundariesActive.toString());
            localStorage.setItem('auramatrix-debug-all-divs', this.allDivsMode.toString());
            localStorage.setItem('auramatrix-debug-true-all', this.trueAllMode.toString());
        } catch (error) {
            console.warn('DebugPanel: Failed to save state:', error);
        }
    }

    // Set initial CSS classes immediately to prevent resize flash
    setInitialClasses() {
        const panel = document.querySelector('.floatdebug-panel') || 
                     document.querySelector('.control-panel-col1debug');
        
        if (!panel) {
            // Panel not loaded yet, retry in a moment
            setTimeout(() => {
                this.setInitialClasses();
            }, 50);
            return;
        }

        // Set the correct CSS classes immediately based on saved state
        if (this.isDockedToColumn1) {
            panel.classList.remove('tv-menu');
            panel.classList.add('docked-column1');
            // console.log('🔧 DEBUG: Initial classes set for docked mode');
        } else {
            panel.classList.remove('docked-column1');
            panel.classList.add('tv-menu');
            // console.log('🔧 DEBUG: Initial classes set for floating mode');
        }
    }

    // Position panel - moves DOM elements (called only on user interaction)
    positionPanel() {
        // Look for both old and new panel selectors
        const panel = document.querySelector('.floatdebug-panel') || 
                     document.querySelector('.control-panel-col1debug');
        const toggleBtn = document.getElementById('floatdebug-dock-toggle') || 
                         document.getElementById('debug-popout-toggle');
        
        if (!panel) {
            console.warn('DebugPanel: Panel not found in DOM');
            return;
        }

        if (this.isDockedToColumn1) {
            // Docked mode - remove TV menu/floating classes
            panel.classList.remove('tv-menu');
            panel.classList.remove('floatdebug-floating');
            panel.classList.add('docked-column1');
            
            const column1PhoneEmu = document.querySelector('.column:first-child .phone-emu');
            if (column1PhoneEmu && !column1PhoneEmu.contains(panel)) {
                column1PhoneEmu.appendChild(panel);
            }
            
            if (toggleBtn) {
                toggleBtn.textContent = '📤';
                toggleBtn.title = 'Pop out to floating';
            }
            
            // console.log('🔧 DEBUG: Panel docked to Column 1');
        } else {
            // Floating mode - add TV menu class and float over interface
            panel.classList.remove('docked-column1');
            panel.classList.add('tv-menu');
            
            if (!document.body.contains(panel) || panel.parentElement !== document.body) {
                document.body.appendChild(panel);
            }
            
            if (toggleBtn) {
                toggleBtn.textContent = '📥';
                toggleBtn.title = 'Dock to Column 1';
            }
            
            // console.log('🔧 DEBUG: Panel in floating TV menu mode');
        }

        this.saveState();
    }

    // Toggle between docked and floating modes
    togglePosition() {
        this.isDockedToColumn1 = !this.isDockedToColumn1;
        this.positionPanel();
        // console.log('🔧 DEBUG: Toggled panel position to:', this.isDockedToColumn1 ? 'docked' : 'floating');
    }

    // Update element visibility via CSS data attributes
    updateElementVisibility() {
        const states = this.elementStates;
        document.body.setAttribute('data-debug-transport', states.transport ? 'visible' : 'hidden');
        document.body.setAttribute('data-debug-panel-bg', states.whitePanelBackground ? 'visible' : 'hidden');
        document.body.setAttribute('data-debug-journey-header', states.journeyHeader ? 'visible' : 'hidden');
        document.body.setAttribute('data-debug-frequency-map', states.frequencyMap ? 'visible' : 'hidden');
        document.body.setAttribute('data-debug-jm-presets', states.jmPresetter ? 'visible' : 'hidden');
        document.body.setAttribute('data-debug-binaural-controls', states.binauralControls ? 'visible' : 'hidden');
        document.body.setAttribute('data-debug-binaural-presets', states.binauralPresets ? 'visible' : 'hidden');

        // Refresh boundary system if active
        if (this.boundariesActive) {
            this.showBoundarySystem();
        }
    }

    // Toggle boundary visualization
    toggleBoundaries() {
        this.boundariesActive = !this.boundariesActive;
        document.body.setAttribute('data-debug-boundaries', this.boundariesActive ? 'visible' : 'hidden');

        if (this.boundariesActive) {
            setTimeout(() => {
                this.showBoundarySystem();
            }, 100);
        } else {
            this.hideBoundarySystem();
        }

        this.saveState();
        // console.log('🔧 DEBUG: Boundaries toggled:', this.boundariesActive ? 'visible' : 'hidden');
    }

    // Handle run button click
    handleRun() {
        //         // console.log('🔧 Debug run button clicked');
        
        // Get selected scripts
        const scriptsSelect = document.getElementById('scripts-multi-select');
        const selectedScripts = scriptsSelect ? Array.from(scriptsSelect.selectedOptions).map(opt => opt.value) : [];
        
        // Get targets
        const targetsInput = document.getElementById('targets-input');
        const targets = targetsInput ? targetsInput.value.trim() : '';
        
        // console.log('🔧 Selected scripts:', selectedScripts);
        // console.log('🔧 Targets:', targets);
        
        if (selectedScripts.length === 0) {
            console.warn('🔧 No scripts selected');
            return;
        }
        
        if (!targets) {
            console.warn('🔧 No targets specified');
            return;
        }
        
        // Execute selected scripts with targets
        this.executeScripts(selectedScripts, targets);
    }

    async executeScripts(scripts, targets) {
        // console.log(`🔧 Executing ${scripts.length} scripts with targets: ${targets}`);
        
        for (const script of scripts) {
            try {
                // console.log(`🔧 Running ${script}...`);
                await this.runScript(script, targets);
            } catch (error) {
                console.error(`🔧 Error running ${script}:`, error);
            }
        }
    }

    async runScript(scriptName, targets) {
        console.log(`🔧 EXECUTE: Running ${scriptName} with targets: ${targets}`);
        
        // Handle Node.js-only scripts
        const nodeOnlyScripts = ['font_override_detective.js', 'log_server.js'];
        if (nodeOnlyScripts.includes(scriptName)) {
            const message = `ℹ️ ${scriptName} is Node.js-only. Run: node ui_debug_△/scripts/node/${scriptName} --help`;
            console.log(message);
            return message;
        }
        
        // Map Node.js scripts to browser-compatible versions
        const browserScriptMap = {
            // Node.js diagnostics → browser versions
            'mega_diagnostic.js': 'browser_mega_diagnostic.js',
            'element_diagnostics.js': 'browser_element_diagnostics.js',
            'live_mutation_engine.js': 'browser_live_mutation.js',
            
            // Already browser-compatible (direct mapping) - FIXED: reading from ui_debug_△/scripts/
            'boundary_hover_diagnostic.js': 'boundary_hover_diagnostic.js',
            'advanced_layout_detective.js': 'advanced_layout_detective.js',
            'journeymap_hammer.js': 'journeymap_hammer.js',
            
            // Browser-only scripts (use consistent naming)
            'browser_mega_diagnostic.js': 'browser_mega_diagnostic.js',
            'browser_element_diagnostic.js': 'browser_element_diagnostics.js',
            'browser_element_diagnostics.js': 'browser_element_diagnostics.js',
            'browser_live_mutation.js': 'browser_live_mutation.js'
        };
        
        const browserScript = browserScriptMap[scriptName] || scriptName;
        
        try {
            // Set targets for the script to use
            window.diagnosticTargets = targets ? targets.split(',').map(t => t.trim()) : [];
            
            // Load and execute the browser-compatible script
            const response = await fetch(`ui_debug_△/scripts/${browserScript}`);
            if (!response.ok) {
                throw new Error(`Failed to load script: ${response.status}`);
            }
            
            const scriptCode = await response.text();
            
            // Execute in a way that captures console output
            const originalLog = console.log;
            const capturedOutput = [];
            
            // Temporarily capture console output
            console.log = (...args) => {
                capturedOutput.push(args.join(' '));
                originalLog.apply(console, args);
            };
            
            // Execute the script
            eval(scriptCode);
            
            // Restore original console.log
            console.log = originalLog;
            
            // Log completion
            console.log(`✅ Script ${scriptName} completed successfully`);
            
            return `Script ${scriptName} completed with ${capturedOutput.length} output lines`;
            
        } catch (error) {
            console.error(`❌ Failed to execute ${scriptName}:`, error);
            return `Script ${scriptName} failed: ${error.message}`;
        } finally {
            // Clean up
            delete window.diagnosticTargets;
        }
    }

    // Toggle all divs mode for boundary visualization
    toggleAllDivs() {
        this.allDivsMode = !this.allDivsMode;
        // console.log('🔧 DEBUG: All divs mode toggled:', this.allDivsMode ? 'enabled' : 'disabled');
        
        // If boundaries are currently active, refresh the boundary system with new mode
        if (this.boundariesActive) {
            this.hideBoundarySystem();
            setTimeout(() => {
                this.showBoundarySystem();
            }, 100);
        }
        
        this.saveState();
    }

    // Show boundary system with labels
    showBoundarySystem() {
        if (window.boundaryVisualizer) {
            try {
                // Ensure CSS classes are set correctly before showing boundaries
                this.setInitialClasses();
                
                // Pass current element states to boundary visualizer for filtering
                const debugSettings = {
                    debugActive: true,
                    allDivs: this.allDivsMode,  // Include all divs mode setting
                    trueAll: this.trueAllMode,  // Include true all mode setting
                    ...this.elementStates  // Include current checkbox states for filtering
                };
                window.boundaryVisualizer.showBoundaries(debugSettings);
            } catch (error) {
                console.warn('DebugPanel: Boundary visualizer not available:', error);
            }
        }
    }

    // Hide boundary system
    hideBoundarySystem() {
        if (window.boundaryVisualizer) {
            try {
                window.boundaryVisualizer.hideBoundaries();
            } catch (error) {
                console.warn('DebugPanel: Boundary visualizer not available:', error);
            }
        }
    }

    // Update checkbox states in UI
    updateCheckboxes() {
        // Update both old format (.element-toggle with data-element) and new format (debug-* IDs)
        
        // Old floatdebug format
        document.querySelectorAll('.element-toggle').forEach(checkbox => {
            const elementKey = checkbox.dataset.element;
            if (elementKey && this.elementStates.hasOwnProperty(elementKey)) {
                checkbox.checked = this.elementStates[elementKey];
            }
        });
        
        // New consolidated format
        Object.keys(this.elementStates).forEach(key => {
            const checkbox = document.getElementById(`debug-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
            if (checkbox && checkbox.type === 'checkbox') {
                checkbox.checked = this.elementStates[key];
            }
        });

        // Update boundaries radio buttons based on current state
        let selectedValue = 'off'; // default
        if (this.boundariesActive) {
            if (this.trueAllMode) {
                selectedValue = 'all';
            } else if (this.allDivsMode) {
                selectedValue = 'col2';
            } else {
                selectedValue = 'container';
            }
        }
        
        const selectedRadio = document.getElementById(`debug-boundaries-${selectedValue}`);
        if (selectedRadio) {
            selectedRadio.checked = true;
        }
    }

    // Set indicator colors
    setIndicatorColors() {
        Object.keys(this.colors).forEach(key => {
            const indicator = document.querySelector(`[data-element="${key}"] .debug-element-indicator`);
            if (indicator) {
                indicator.style.backgroundColor = this.colors[key];
            }
        });
    }

    // Toggle element visibility
    toggleElement(elementKey) {
        if (this.elementStates.hasOwnProperty(elementKey)) {
            this.elementStates[elementKey] = !this.elementStates[elementKey];
            this.updateElementVisibility();
            this.saveState();
            console.log(`🔧 DEBUG: Toggled ${elementKey}:`, this.elementStates[elementKey]);
        }
    }

    // Reset to default states
    resetToDefaults() {
        this.elementStates = {
            transport: true,              
            whitePanelBackground: true,   
            journeyHeader: true,          
            frequencyMap: true,           
            jmPresetter: false,           
            binauralControls: false,      
            binauralPresets: false        
        };
        
        this.updateElementVisibility();
        this.updateCheckboxes();
        this.saveState();
        console.log('🔧 DEBUG: Reset to defaults');
    }

    // Toggle dock mode (alias for togglePosition for backward compatibility)
    toggleDockMode() {
        this.togglePosition();
    }
}

// Event listener setup
async function setupEventListeners(controller) {
    // Position toggle button (works with both old and new IDs)
    const positionToggle = document.getElementById('floatdebug-dock-toggle') || 
                          document.getElementById('debug-popout-toggle');
    if (positionToggle) {
        positionToggle.addEventListener('click', () => controller.togglePosition());
        // console.log('🔧 DEBUG: Position toggle button connected');
    }

    // Boundaries radio buttons - replace old checkbox logic
    const boundaryRadios = document.querySelectorAll('input[name="boundaries"]');
    boundaryRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                const value = e.target.value;
                console.log('🔧 DEBUG: Boundary mode changed to:', value);
                
                if (value === 'off') {
                    // Turn off all boundaries
                    controller.boundariesActive = false;
                    controller.allDivsMode = false;
                    controller.hideBoundarySystem();
                } else if (value === 'container') {
                    // Container boundaries only
                    controller.boundariesActive = true;
                    controller.allDivsMode = false;
                    controller.trueAllMode = false;
                    controller.showBoundarySystem();
                } else if (value === 'col2') {
                    // Col2 boundaries (limited all divs mode)
                    controller.boundariesActive = true;
                    controller.allDivsMode = true;
                    controller.trueAllMode = false;
                    controller.showBoundarySystem();
                } else if (value === 'all') {
                    // TRUE All boundaries (messy visual spaghetti mode)
                    controller.boundariesActive = true;
                    controller.allDivsMode = true;
                    controller.trueAllMode = true;
                    controller.showBoundarySystem();
                }
                
                // Update body data attributes
                document.body.setAttribute('data-debug-boundaries', controller.boundariesActive ? 'visible' : 'hidden');
                controller.saveState();
            }
        });
    });

    // Close button (floatdebug specific)
    const closeBtn = document.getElementById('floatdebug-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const panel = document.querySelector('.floatdebug-panel');
            if (panel) {
                panel.style.display = 'none';
                console.log('🔧 DEBUG: Panel hidden via close button');
            }
        });
    }

    // Run button event listener - connect to existing handleRun functionality
    const runButton = document.getElementById('debug-run');
    if (runButton) {
        runButton.addEventListener('click', () => controller.handleRun());
        // console.log('🔧 DEBUG: Run button connected');
    }

    // Element toggle checkboxes (working with original floatdebug format)
    document.querySelectorAll('.element-toggle').forEach(toggle => {
        const elementKey = toggle.dataset.element;
        
        toggle.addEventListener('change', (e) => {
            if (controller.elementStates.hasOwnProperty(elementKey)) {
                controller.elementStates[elementKey] = e.target.checked;
                controller.updateElementVisibility();
                controller.saveState();
                console.log(`🔧 DEBUG: Toggled ${elementKey}:`, e.target.checked);
            }
        });
        
        // Set initial state
        if (controller.elementStates.hasOwnProperty(elementKey)) {
            toggle.checked = controller.elementStates[elementKey];
        }
    });

    // Populate scripts directory multi-select
    const scriptsSelect = document.getElementById('scripts-multi-select');
    if (scriptsSelect) {
        await populateScriptsDirectory(scriptsSelect);
        
        // Handle scripts selection changes (display only - no execution yet)
        scriptsSelect.addEventListener('change', () => {
            const selectedScripts = Array.from(scriptsSelect.selectedOptions).map(opt => opt.value);
            // console.log('🔧 DEBUG: Selected scripts:', selectedScripts);
            // TODO: Add script execution logic here when ready
        });
    }
    
    // Handle targets input changes
    const targetsInput = document.getElementById('targets-input');
    if (targetsInput) {
        targetsInput.addEventListener('input', (e) => {
            const targets = e.target.value.trim();
            // console.log('🔧 DEBUG: Targets updated:', targets);
            // TODO: Add targets processing logic here when ready
        });
    }

    // console.log('🔧 DEBUG: All event listeners attached to existing working panel');
}

// Export for main.js compatibility
export function initFloatDebugWidget() {
    // Alias for backward compatibility
    console.warn('initFloatDebugWidget is deprecated, use initDebugPanelWidget');
    return initDebugPanelWidget();
}

export function initCol1DebugWidget() {
    // Alias for backward compatibility  
    console.warn('initCol1DebugWidget is deprecated, use initDebugPanelWidget');
    return initDebugPanelWidget();
}

// Populate the scripts directory multi-select with available .js files
async function populateScriptsDirectory(selectElement) {
    try {
        // Dynamically fetch scripts directory contents - LIVE DIRECTORY READ ALWAYS
        console.log('🔍 DEBUG: Attempting to fetch directory: ui_debug_△/scripts/');
        const response = await fetch('ui_debug_△/scripts/');
        console.log(`🔍 DEBUG: Fetch response status: ${response.status} ${response.statusText}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch ui_debug_△/scripts directory: ${response.status} ${response.statusText}`);
        }
        
        const html = await response.text();
        console.log(`🔍 DEBUG: Received HTML length: ${html.length} characters`);
        console.log(`🔍 DEBUG: HTML content preview:`, html.substring(0, 200));
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Extract .js files from directory listing
        const links = doc.querySelectorAll('a[href$=".js"]');
        console.log(`🔍 DEBUG: Found ${links.length} .js links in directory listing`);
        const scriptsFiles = Array.from(links)
            .map(link => {
                const href = link.getAttribute('href');
                console.log(`🔍 DEBUG: Processing link href: "${href}"`);
                return href;
            })
            .filter(href => href && href.endsWith('.js')) // Must be .js file
            .filter(href => !href.startsWith('..')) // No parent directory links
            .map(href => {
                // Extract just the filename from various href formats
                const filename = href.split('/').pop(); // Get last part after any slashes
                console.log(`🔍 DEBUG: Extracted filename: "${filename}" from href: "${href}"`);
                return filename;
            })
            .filter(filename => filename && filename.length > 0) // Must have valid filename
            .sort();
        
        console.log(`🔍 DEBUG: Filtered to ${scriptsFiles.length} scripts:`, scriptsFiles);
        
        // Clear existing options
        selectElement.innerHTML = '';
        
        if (scriptsFiles.length === 0) {
            // ERROR OUT - NO FALLBACK ALLOWED
            const errorMsg = `❌ FATAL: No scripts found in directory 'ui_debug_△/scripts/' - LIVE DIRECTORY READ FAILED!`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
        
        // Add scripts as options
        scriptsFiles.forEach(scriptFile => {
            const option = document.createElement('option');
            option.value = scriptFile;
            option.textContent = scriptFile;
            selectElement.appendChild(option);
        });
        
        console.log(`🔧 DEBUG: Dynamically loaded ${scriptsFiles.length} scripts from directory`);
        
    } catch (error) {
        // ERROR OUT - NO FALLBACK ALLOWED
        const errorMsg = `❌ FATAL: Scripts directory 'ui_debug_△/scripts/' read failed - ALWAYS LIVE, NO FALLBACK! Error: ${error.message}`;
        console.error(`🔍 DEBUG: Attempted to fetch from: 'ui_debug_△/scripts/'`);
        console.error(`🔍 DEBUG: Full error:`, error);
        console.error(errorMsg);
        throw new Error(errorMsg);
    }
}