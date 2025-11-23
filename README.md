# C→Zig Converter 🛡️

A web-based tool for transforming unsafe C/C++ code into memory-safe Zig equivalents using AI-powered analysis.

## Live Demo

🌐 **[Try it now at c2zig.berrry.app](https://c2zig.berrry.app)**

## Fork This Project

Want to customize this tool? Fork it on Berrry by tweeting your modification:

🐦 **[Tweet to fork](https://twitter.com/intent/tweet?text=@BerrryComputer%20Fork%20c2zig.berrry.app%20with%20neobrutalist%20design)** 

Example: `@BerrryComputer Fork c2zig.berrry.app with neobrutalist design`

Add your own customization ideas:
- "with neobrutalist design"
- "add syntax highlighting for code"
- "make it mobile-friendly"
- "add dark/light mode toggle"

Learn more about Berrry at [berrry.app](https://berrry.app)

## Features

- **Two-Step Conversion Process**:
  1. Analysis & Conversion Plan - Identifies safety issues and creates a detailed conversion strategy
  2. Zig Code Generation - Generates complete, working Zig code with proper memory management

- **Configurable Safety Levels**:
  - **Strict**: Maximum safety with allocators, error unions, no unsafe blocks
  - **Balanced**: Balance safety with C compatibility where needed
  - **Permissive**: Allow some unsafe for direct C interop

- **Additional Features**:
  - Customizable prompt templates
  - Optional test generation
  - Comment preservation
  - Multiple API endpoint support (Pollinations AI, OpenRouter, OpenAI, Custom)

## Usage

Simply open `index.html` in a web browser or host it on any static web server.

### Local Usage

```bash
# Simple Python server
python3 -m http.server 8000

# Or any other static file server
npx serve .
```

Then visit `http://localhost:8000` in your browser.

## Configuration

Click the ⚙️ settings icon to configure:

- **API Endpoint**: Choose from Pollinations AI (free, no key required), OpenRouter, OpenAI, or custom endpoint
- **Model**: Select the AI model to use for conversion
- **Safety Level**: Adjust the strictness of memory safety conversions
- **Options**: Enable/disable test generation and comment preservation
- **Prompt Templates**: Customize the analysis and generation prompts

## How It Works

1. **Paste C/C++ Code**: Enter your unsafe C/C++ code
2. **Analyze & Plan**: AI analyzes the code for safety issues and creates a conversion plan
3. **Convert**: Generate memory-safe Zig code based on the analysis
4. **Download**: Copy or download the generated Zig code

## Technology Stack

- React 18 (via CDN)
- Tailwind CSS (via CDN)
- OpenAI-compatible streaming API support
- Pure client-side application (no backend required)

## Credits

Built with [Berrry Computer](https://berrry.app) 🍓

## License

MIT
