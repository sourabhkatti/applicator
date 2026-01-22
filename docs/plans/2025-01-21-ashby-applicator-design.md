# Ashby applicator design

Date: 2025-01-21

## Overview

Browser-use powered automation for applying to jobs on Ashby ATS (jobs.ashbyhq.com), solving the file upload limitation that prevented Claude Code from applying to Ashby jobs via JavaScript injection.

## Problem

Ashby ATS only supports file upload for resumes (no copy/paste option). Browser security restrictions prevent JavaScript from programmatically setting file inputs. This blocked ~30% of job applications in the existing workflow.

## Solution

Use browser-use (Playwright-based) which operates at the Chrome DevTools Protocol level, bypassing JavaScript security restrictions for file uploads.

## Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration | Callable from Claude Code as subprocess | Enables automatic use during job hunting workflow |
| Resume format | PDF (convert from text if needed) | Ashby accepts PDF but not plain text |
| PDF generation | fpdf2 library | Lightweight, pure Python, no external deps |
| Applicant info | Parse from existing claude.md | Single source of truth, no duplication |
| Custom questions | LLM-assisted filling | Fully autonomous operation |
| Output | JSON + screenshot + log | Enables programmatic use + debugging |

## Architecture

```
applicator/
├── ashby-applicator/           # New component
│   ├── apply.py                # Main CLI entry point
│   ├── applicant_parser.py     # Parse claude.md
│   ├── resume_generator.py     # Text-to-PDF conversion
│   ├── requirements.txt        # Dependencies
│   └── output/                 # Generated files
│       ├── screenshots/
│       └── logs/
├── auto-applicator/            # Existing (updated)
│   └── claude.md               # Removed Ashby from exclusions
└── ~/.claude/skills/
    └── ashby-apply/            # Claude Code skill
        └── ashby-apply.md
```

## Data flow

```
1. CLI: python apply.py <url>
2. Parse claude.md → applicant info
3. Prepare resume → PDF file
4. Launch browser-use agent
5. Agent fills form + uploads resume + submits
6. Capture screenshot
7. Return JSON result
```

## CLI interface

```bash
# Basic
python apply.py "https://jobs.ashbyhq.com/company/job-id"

# With options
python apply.py "https://jobs.ashbyhq.com/..." --resume /path/to/resume.pdf --json
```

## Output format

```json
{
  "success": true,
  "company": "ramp",
  "role": "Product Manager",
  "screenshot": "output/screenshots/ramp_2025-01-21.png",
  "log": "output/logs/ramp_2025-01-21.log"
}
```

## Dependencies

- browser-use: Playwright-based browser automation
- langchain-anthropic: LLM for form filling
- fpdf2: PDF generation
- python-dotenv: Environment management

## Testing

Manual testing with real Ashby job postings:
1. Run against known Ashby URL
2. Verify form fields filled correctly
3. Verify resume uploaded
4. Verify confirmation screenshot captured
