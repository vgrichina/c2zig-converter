const { useState, useEffect, useRef } = React;

const SAMPLE_C_CODE = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char* data;
    size_t length;
} String;

String* create_string(const char* input) {
    String* str = malloc(sizeof(String));
    str->length = strlen(input);
    str->data = malloc(str->length + 1);
    strcpy(str->data, input);
    return str;
}

void free_string(String* str) {
    free(str->data);
    free(str);
}

int main() {
    String* greeting = create_string("Hello, World!");
    printf("%s\\n", greeting->data);
    free_string(greeting);
    return 0;
}`;

const DEFAULT_PROMPTS = {
    analysis: `Analyze this C/C++ code and create a detailed Zig conversion plan.

C/C++ Code:
\`\`\`c
{{CODE}}
\`\`\`

Provide a comprehensive analysis including:

1. **Safety Issues**: List unsafe patterns (buffer overflows, raw pointers, manual memory management, null pointer risks)
2. **Memory Management Analysis**: Complexity score (1-10) and key concerns
3. **Conversion Strategy**: Step-by-step approach for converting to Zig
4. **Type Mappings**: C types → Zig types (e.g., char* → []const u8, malloc → allocator.alloc)
5. **Memory Management**: How to handle allocators and ownership
6. **Error Handling**: Converting C error patterns to Zig error unions
{{TEST_STRATEGY}}

Keep it detailed but concise. This plan will be used directly for code generation.`,
    
    generation: `Convert this C/C++ code to Zig following the analysis and conversion plan.

Safety Level: {{SAFETY_LEVEL}}
{{SAFETY_HINTS}}

Conversion Plan:
{{ANALYSIS}}

C/C++ Code:
\`\`\`c
{{CODE}}
\`\`\`

Generate complete, working Zig code. Include:
- Proper memory management with allocators (use std.heap.GeneralPurposeAllocator or appropriate allocator)
- Error handling with error unions (error!)
- Type safety with Zig's type system
- Proper ownership and lifetime management
{{TEST_INCLUSION}}
{{COMMENT_PRESERVATION}}

Output only the Zig code with helpful comments explaining key conversions.`
};

const PRESET_ENDPOINTS = [
    { name: 'Pollinations AI', url: 'https://text.pollinations.ai/openai', requiresKey: false },
    { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', requiresKey: true },
    { name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', requiresKey: true },
    { name: 'Custom', url: '', requiresKey: false }
];

const App = () => {
    const [stage, setStage] = useState('input');
    const [cCode, setCCode] = useState(SAMPLE_C_CODE);
    const [analysis, setAnalysis] = useState('');
    const [zigCode, setZigCode] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [settings, setSettings] = useState({
        endpointPreset: 'Pollinations AI',
        endpoint: 'https://text.pollinations.ai/openai',
        apiKey: '',
        model: 'openai',
        safetyLevel: 'strict',
        generateTests: true,
        preserveComments: true,
        prompts: DEFAULT_PROMPTS
    });
    const [streamingText, setStreamingText] = useState('');
    const [editingPrompt, setEditingPrompt] = useState(null);
    const zigCodeRef = useRef(null);

    useEffect(() => {
        const saved = localStorage.getItem('c2zig_settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setSettings({
                    ...settings,
                    ...parsed,
                    prompts: { ...DEFAULT_PROMPTS, ...parsed.prompts }
                });
            } catch (e) {}
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('c2zig_settings', JSON.stringify(settings));
    }, [settings]);

    const callAPI = async (prompt, systemPrompt = 'You are a helpful assistant that converts C/C++ code to Zig.') => {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (settings.apiKey) {
            headers['Authorization'] = `Bearer ${settings.apiKey}`;
        }

        const body = {
            model: settings.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            stream: true
        };

        const response = await fetch(settings.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }

        return response;
    };

    const processStream = async (response, onChunk) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullText += content;
                            onChunk(fullText);
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            }
        }

        return fullText;
    };

    const fillPromptTemplate = (template, vars) => {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] || match);
    };

    const analyzeAndPlan = async () => {
        setLoading(true);
        setError('');
        setStage('analyzing');
        setStreamingText('');

        const safetyHints = {
            strict: 'Use strict safety: allocators, error unions, no unsafe blocks',
            balanced: 'Balance safety and C compatibility where needed',
            permissive: 'Allow some unsafe for direct C interop'
        };

        const prompt = fillPromptTemplate(settings.prompts.analysis, {
            CODE: cCode,
            TEST_STRATEGY: settings.generateTests ? '7. **Test Strategy**: Outline basic tests using std.testing' : ''
        });

        try {
            const response = await callAPI(prompt);
            const result = await processStream(response, setStreamingText);
            setAnalysis(result);
            setStage('analyzed');
            setLoading(false);
        } catch (err) {
            setError(`Analysis failed: ${err.message}`);
            setLoading(false);
            setStage('input');
        }
    };

    const generateZigCode = async () => {
        setLoading(true);
        setError('');
        setStage('generating');
        setStreamingText('');

        const safetyHints = {
            strict: 'Use strict safety: allocators, error unions, no unsafe blocks',
            balanced: 'Balance safety and C compatibility where needed',
            permissive: 'Allow some unsafe for direct C interop'
        };

        const prompt = fillPromptTemplate(settings.prompts.generation, {
            SAFETY_LEVEL: settings.safetyLevel,
            SAFETY_HINTS: safetyHints[settings.safetyLevel],
            ANALYSIS: analysis,
            CODE: cCode,
            TEST_INCLUSION: settings.generateTests ? '- Basic tests using std.testing' : '',
            COMMENT_PRESERVATION: settings.preserveComments ? '- Preserve original intent in comments' : ''
        });

        try {
            const response = await callAPI(prompt);
            const result = await processStream(response, setStreamingText);
            setZigCode(result);
            setStage('complete');
            setLoading(false);
            
            setTimeout(() => {
                if (zigCodeRef.current) {
                    createConfetti(zigCodeRef.current);
                }
            }, 300);
        } catch (err) {
            setError(`Code generation failed: ${err.message}`);
            setLoading(false);
            setStage('analyzed');
        }
    };

    const createConfetti = (element) => {
        const shields = ['🛡️', '✅', '🎉', '⚡'];
        for (let i = 0; i < 20; i++) {
            const shield = document.createElement('div');
            shield.textContent = shields[Math.floor(Math.random() * shields.length)];
            shield.className = 'confetti';
            shield.style.left = Math.random() * 100 + '%';
            shield.style.animationDelay = Math.random() * 0.5 + 's';
            element.appendChild(shield);
            setTimeout(() => shield.remove(), 3000);
        }
    };

    const reset = () => {
        setStage('input');
        setAnalysis('');
        setZigCode('');
        setError('');
        setStreamingText('');
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const handleEndpointPresetChange = (presetName) => {
        const preset = PRESET_ENDPOINTS.find(p => p.name === presetName);
        if (preset) {
            setSettings({
                ...settings,
                endpointPreset: presetName,
                endpoint: preset.url || settings.endpoint
            });
        }
    };

    const PromptEditor = ({ promptKey, label }) => (
        React.createElement('div', { className: 'mb-4' },
            React.createElement('div', { className: 'flex justify-between items-center mb-2' },
                React.createElement('label', { className: 'block text-sm font-medium text-gray-300' }, label),
                React.createElement('button', {
                    onClick: () => setEditingPrompt(editingPrompt === promptKey ? null : promptKey),
                    className: 'text-blue-400 hover:text-blue-300 text-sm'
                }, editingPrompt === promptKey ? 'Close' : 'Edit')
            ),
            editingPrompt === promptKey && React.createElement('div', null,
                React.createElement('textarea', {
                    value: settings.prompts[promptKey],
                    onChange: (e) => setSettings({
                        ...settings,
                        prompts: { ...settings.prompts, [promptKey]: e.target.value }
                    }),
                    className: 'w-full h-48 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white font-mono text-xs',
                    placeholder: 'Prompt template...'
                }),
                React.createElement('div', { className: 'mt-2 text-xs text-gray-400' },
                    'Available variables: ',
                    promptKey === 'analysis' && '{{CODE}}, {{TEST_STRATEGY}}',
                    promptKey === 'generation' && '{{SAFETY_LEVEL}}, {{SAFETY_HINTS}}, {{ANALYSIS}}, {{CODE}}, {{TEST_INCLUSION}}, {{COMMENT_PRESERVATION}}'
                ),
                React.createElement('button', {
                    onClick: () => setSettings({
                        ...settings,
                        prompts: { ...settings.prompts, [promptKey]: DEFAULT_PROMPTS[promptKey] }
                    }),
                    className: 'mt-2 text-xs text-gray-400 hover:text-gray-300'
                }, '↺ Reset to default')
            )
        )
    );

    const SettingsPanel = () => (
        React.createElement('div', {
            className: 'fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50',
            onClick: () => setShowSettings(false)
        },
            React.createElement('div', {
                className: 'bg-slate-800 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto',
                onClick: (e) => e.stopPropagation()
            },
                React.createElement('div', { className: 'flex justify-between items-center mb-6' },
                    React.createElement('h2', { className: 'text-2xl font-bold text-white' }, '⚙️ Settings'),
                    React.createElement('button', {
                        onClick: () => setShowSettings(false),
                        className: 'text-gray-400 hover:text-white text-2xl'
                    }, '×')
                ),
                
                React.createElement('div', { className: 'space-y-6' },
                    React.createElement('div', { className: 'border-b border-slate-700 pb-4' },
                        React.createElement('h3', { className: 'text-lg font-semibold text-white mb-4' }, '🔌 API Configuration'),
                        
                        React.createElement('div', { className: 'mb-4' },
                            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 'Endpoint Preset'),
                            React.createElement('select', {
                                value: settings.endpointPreset,
                                onChange: (e) => handleEndpointPresetChange(e.target.value),
                                className: 'w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white'
                            },
                                ...PRESET_ENDPOINTS.map(preset =>
                                    React.createElement('option', { key: preset.name, value: preset.name }, preset.name)
                                )
                            )
                        ),
                        
                        React.createElement('div', { className: 'mb-4' },
                            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 'API Endpoint URL'),
                            React.createElement('input', {
                                type: 'text',
                                value: settings.endpoint,
                                onChange: (e) => setSettings({...settings, endpoint: e.target.value, endpointPreset: 'Custom'}),
                                className: 'w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm font-mono',
                                placeholder: 'https://text.pollinations.ai/openai'
                            }),
                            React.createElement('p', { className: 'mt-1 text-xs text-gray-400' }, 
                                'OpenAI-compatible endpoint (supports streaming)'
                            )
                        ),
                        
                        React.createElement('div', { className: 'mb-4' },
                            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 'API Key (optional)'),
                            React.createElement('input', {
                                type: 'password',
                                value: settings.apiKey,
                                onChange: (e) => setSettings({...settings, apiKey: e.target.value}),
                                className: 'w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-sm',
                                placeholder: 'sk-...'
                            }),
                            React.createElement('p', { className: 'mt-1 text-xs text-gray-400' }, 
                                'Required for OpenRouter and OpenAI. Not needed for Pollinations AI.'
                            )
                        ),
                        
                        React.createElement('div', null,
                            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 'Model'),
                            React.createElement('input', {
                                type: 'text',
                                value: settings.model,
                                onChange: (e) => setSettings({...settings, model: e.target.value}),
                                className: 'w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-sm',
                                placeholder: 'openai'
                            }),
                            React.createElement('p', { className: 'mt-1 text-xs text-gray-400' }, 
                                'Examples: openai, gpt-4-turbo, anthropic/claude-3.5-sonnet'
                            )
                        )
                    ),
                    
                    React.createElement('div', { className: 'border-b border-slate-700 pb-4' },
                        React.createElement('h3', { className: 'text-lg font-semibold text-white mb-4' }, '🎯 Conversion Settings'),
                        
                        React.createElement('div', { className: 'mb-4' },
                            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 
                                'Safety Level: ', 
                                React.createElement('span', { className: 'text-blue-400' }, settings.safetyLevel)
                            ),
                            React.createElement('input', {
                                type: 'range',
                                min: '0',
                                max: '2',
                                value: settings.safetyLevel === 'permissive' ? 0 : settings.safetyLevel === 'balanced' ? 1 : 2,
                                onChange: (e) => {
                                    const levels = ['permissive', 'balanced', 'strict'];
                                    setSettings({...settings, safetyLevel: levels[e.target.value]});
                                },
                                className: 'w-full'
                            }),
                            React.createElement('div', { className: 'flex justify-between text-xs text-gray-400 mt-1' },
                                React.createElement('span', null, 'Permissive'),
                                React.createElement('span', null, 'Balanced'),
                                React.createElement('span', null, 'Strict')
                            )
                        ),
                        
                        React.createElement('label', { className: 'flex items-center space-x-2 mb-3' },
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: settings.generateTests,
                                onChange: (e) => setSettings({...settings, generateTests: e.target.checked}),
                                className: 'w-4 h-4'
                            }),
                            React.createElement('span', { className: 'text-gray-300' }, 'Generate comprehensive tests')
                        ),
                        
                        React.createElement('label', { className: 'flex items-center space-x-2' },
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: settings.preserveComments,
                                onChange: (e) => setSettings({...settings, preserveComments: e.target.checked}),
                                className: 'w-4 h-4'
                            }),
                            React.createElement('span', { className: 'text-gray-300' }, 'Preserve original comments')
                        )
                    ),
                    
                    React.createElement('div', null,
                        React.createElement('h3', { className: 'text-lg font-semibold text-white mb-4' }, '📝 Prompt Templates'),
                        React.createElement(PromptEditor, { promptKey: 'analysis', label: 'Step 1: Analysis & Conversion Plan' }),
                        React.createElement(PromptEditor, { promptKey: 'generation', label: 'Step 2: Zig Code Generation' })
                    )
                )
            )
        )
    );

    return React.createElement('div', { className: 'min-h-screen p-4 md:p-8' },
        showSettings && React.createElement(SettingsPanel),
        
        React.createElement('div', { className: 'max-w-7xl mx-auto' },
            React.createElement('header', { className: 'text-center mb-8' },
                React.createElement('div', { className: 'flex items-center justify-center gap-3 mb-3' },
                    React.createElement('h1', { className: 'text-4xl md:text-5xl font-bold text-white' }, 'C→Zig 🛡️'),
                    React.createElement('button', {
                        onClick: () => setShowSettings(true),
                        className: 'text-gray-400 hover:text-white transition-colors'
                    }, '⚙️')
                ),
                React.createElement('p', { className: 'text-gray-300 text-lg' }, 
                    'Transform unsafe code into Zig\'s fearless concurrency'
                ),
                
                React.createElement('div', { className: 'mt-4 flex items-center justify-center gap-4 text-sm' },
                    React.createElement('div', { className: `px-3 py-1 rounded-full ${stage === 'input' ? 'bg-blue-500' : (stage === 'analyzing' || stage === 'analyzed' || stage === 'generating' || stage === 'complete') ? 'bg-green-500' : 'bg-gray-600'}` },
                        '1. Input'
                    ),
                    React.createElement('div', { className: 'text-gray-500' }, '→'),
                    React.createElement('div', { className: `px-3 py-1 rounded-full ${stage === 'analyzing' || stage === 'analyzed' ? 'bg-blue-500' : (stage === 'generating' || stage === 'complete') ? 'bg-green-500' : 'bg-gray-600'}` },
                        '2. Analyze & Plan'
                    ),
                    React.createElement('div', { className: 'text-gray-500' }, '→'),
                    React.createElement('div', { className: `px-3 py-1 rounded-full ${stage === 'generating' ? 'bg-blue-500' : stage === 'complete' ? 'bg-green-500' : 'bg-gray-600'}` },
                        '3. Convert'
                    )
                )
            ),

            error && React.createElement('div', { className: 'bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-4' },
                error
            ),

            stage === 'input' && React.createElement('div', { className: 'bg-slate-800/50 backdrop-blur rounded-xl p-6 border border-slate-700' },
                React.createElement('h2', { className: 'text-xl font-bold text-white mb-4' }, '📝 Paste Your C/C++ Code'),
                React.createElement('textarea', {
                    value: cCode,
                    onChange: (e) => setCCode(e.target.value),
                    className: 'w-full h-96 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white font-mono text-sm',
                    placeholder: 'Paste your C/C++ code here...'
                }),
                React.createElement('div', { className: 'flex gap-3 mt-4' },
                    React.createElement('button', {
                        onClick: analyzeAndPlan,
                        disabled: !cCode.trim() || loading,
                        className: 'flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition-colors'
                    }, 'Analyze & Create Plan 🔍'),
                    React.createElement('button', {
                        onClick: () => setCCode(SAMPLE_C_CODE),
                        className: 'bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-lg transition-colors'
                    }, 'Load Sample')
                )
            ),

            (stage === 'analyzing' || stage === 'analyzed' || stage === 'generating' || stage === 'complete') && React.createElement('div', { className: 'bg-slate-800/50 backdrop-blur rounded-xl p-6 border border-slate-700 mb-6' },
                React.createElement('div', { className: 'flex justify-between items-center mb-4' },
                    React.createElement('h2', { className: 'text-xl font-bold text-white' }, '🔍 Analysis & Conversion Plan'),
                    analysis && React.createElement('button', {
                        onClick: () => copyToClipboard(analysis),
                        className: 'text-blue-400 hover:text-blue-300 text-sm'
                    }, '📋 Copy')
                ),
                React.createElement('textarea', {
                    value: loading && stage === 'analyzing' ? streamingText : analysis,
                    onChange: (e) => setAnalysis(e.target.value),
                    disabled: loading,
                    className: 'w-full h-96 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-gray-300 font-mono text-sm',
                    placeholder: 'Analysis and conversion plan will appear here...'
                }),
                stage === 'analyzed' && React.createElement('button', {
                    onClick: generateZigCode,
                    disabled: loading,
                    className: 'mt-4 w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition-colors'
                }, 'Convert to Zig ⚡')
            ),

            (stage === 'generating' || stage === 'complete') && React.createElement('div', { 
                ref: zigCodeRef,
                className: 'bg-slate-800/50 backdrop-blur rounded-xl p-6 border border-slate-700 mb-6 relative' 
            },
                React.createElement('div', { className: 'flex justify-between items-center mb-4' },
                    React.createElement('h2', { className: 'text-xl font-bold text-white' }, '⚡ Generated Zig Code'),
                    zigCode && React.createElement('button', {
                        onClick: () => copyToClipboard(zigCode),
                        className: 'text-green-400 hover:text-green-300 text-sm'
                    }, '📋 Copy')
                ),
                React.createElement('div', { className: 'bg-slate-900 border border-slate-600 rounded-lg p-4 text-gray-300 whitespace-pre-wrap font-mono text-sm max-h-[600px] overflow-y-auto' },
                    loading ? streamingText : zigCode
                ),
                stage === 'complete' && React.createElement('div', { className: 'mt-4 flex gap-3' },
                    React.createElement('button', {
                        onClick: reset,
                        className: 'flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-colors'
                    }, 'Convert Another File 🔄'),
                    React.createElement('button', {
                        onClick: () => {
                            const blob = new Blob([zigCode], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'converted.zig';
                            a.click();
                        },
                        className: 'bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-colors'
                    }, '💾 Download .zig')
                )
            ),

            React.createElement('footer', { className: 'text-center mt-12 text-gray-400 text-sm' },
                React.createElement('p', null,
                    'Powered by ',
                    React.createElement('a', { 
                        href: 'https://berrry.app',
                        className: 'text-blue-400 hover:text-blue-300'
                    }, 'Berrry Computer 🍓'),
                    ' • Built with Zig ❤️'
                ),
                React.createElement('p', { className: 'mt-2 text-xs' },
                    'Note: This tool provides AI-assisted conversions. Always review and test generated code!'
                )
            )
        )
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));