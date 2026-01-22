# Browser applicator

Browser-use powered automation for applying to jobs that require file uploads (resume PDF).

Works with:
- Ashby ATS (jobs.ashbyhq.com)
- Greenhouse (when file upload is required)
- Any other ATS where JavaScript file input manipulation doesn't work

## Setup

1. Complete the main setup first (see root CLAUDE.md)
2. Install dependencies:

```bash
cd ~/applicator/browser-applicator
pip install -r requirements.txt
playwright install chromium
```

3. Set up your LLM provider API key in macOS Keychain (done during main setup):

```bash
security add-generic-password -a "$USER" -s "browser-applicator-api-key" -w "your-api-key"
```

## Usage

### Basic usage

```bash
python apply.py "https://jobs.ashbyhq.com/company/job-id"
```

### With specific resume

```bash
python apply.py "https://jobs.ashbyhq.com/..." --resume ~/Documents/resume.pdf
```

### JSON output (for programmatic use)

```bash
python apply.py "https://jobs.ashbyhq.com/..." --json
```

Output:
```json
{
  "success": true,
  "company": "ramp",
  "role": "Product Manager",
  "screenshot": "output/screenshots/ramp_2024-01-21_10-30-00.png",
  "log": "output/logs/ramp_2024-01-21_10-30-00.log"
}
```

## How it works

1. Reads applicant info from `../applicant.yaml`
2. Prepares resume (uses existing PDF or converts text to PDF)
3. Launches browser-use agent with Playwright
4. Agent fills form fields, uploads resume, answers custom questions
5. Submits application and captures confirmation screenshot
6. Returns structured result

## Files

```
browser-applicator/
├── apply.py              # Main entry point
├── applicant_parser.py   # Read from applicant.yaml
├── resume_generator.py   # Text-to-PDF conversion
├── requirements.txt      # Python dependencies
└── output/
    ├── screenshots/      # Confirmation screenshots
    └── logs/             # Detailed logs
```

## LLM providers

Configured in `applicant.yaml`:

| Provider | Base URL | Example model |
|----------|----------|---------------|
| openrouter | https://openrouter.ai/api/v1 | google/gemini-2.0-flash-001 |
| anthropic | (default) | claude-sonnet-4-20250514 |
| openai | (default) | gpt-4o |
| google | https://generativelanguage.googleapis.com/v1beta/openai | gemini-2.0-flash |

## Troubleshooting

### Missing dependencies
```bash
pip install -r requirements.txt
```

### Browser not found
```bash
playwright install chromium
```

### API key error
Ensure API key is in Keychain:
```bash
security find-generic-password -s "browser-applicator-api-key" -w
```

If missing, add it:
```bash
security add-generic-password -a "$USER" -s "browser-applicator-api-key" -w "your-key"
```

### Application failed
Check the log file in `output/logs/` for detailed step-by-step actions.
