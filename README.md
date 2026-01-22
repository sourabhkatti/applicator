# Applicator

Autonomous job application suite powered by Claude Code. Apply to jobs with ATS-optimized resumes, automated browser form filling, and a kanban-style job tracker.

## Features

- **Auto-applicator**: Tailors your resume for each job using an ATS optimizer
- **Browser-applicator**: Handles file-upload-only job applications (Ashby ATS, etc.) using browser automation
- **Job tracker**: Kanban board to track all your applications through the hiring pipeline

## Architecture

```
applicator/
├── applicant.yaml          # Your personal info (gitignored)
├── applicant.yaml.example  # Template to copy
├── CLAUDE.md               # Claude Code instructions
├── auto-applicator/
│   ├── ats_optimizer.py    # Resume tailoring for ATS
│   └── claude.md           # Workflow documentation
├── browser-applicator/
│   ├── apply.py            # Browser automation for file uploads
│   ├── applicant_parser.py # Reads applicant.yaml
│   └── resume_generator.py # Text-to-PDF conversion
└── tracker/
    ├── app.py              # Flask server
    ├── index.html          # Kanban board UI
    └── jobs.json           # Job data (gitignored)
```

## Quick start

### 1. Clone and setup

```bash
git clone https://github.com/sourabhkatti/applicator.git
cd applicator

# Install tracker dependencies
pip install -r tracker/requirements.txt

# Optional: Install browser-applicator dependencies (for file-upload jobs)
pip install -r browser-applicator/requirements.txt
playwright install chromium
```

### 2. Configure your profile

```bash
cp applicant.yaml.example applicant.yaml
# Edit applicant.yaml with your information
```

Or let Claude Code guide you through setup - just say "help me set up applicator" and it will:
- Parse your resume PDF
- Extract your info
- Ask about job preferences
- Generate applicant.yaml

### 3. Optional: Setup browser automation API key

For jobs that require file uploads (Ashby ATS), you need an LLM API key:

```bash
# Store API key in macOS Keychain
security add-generic-password -a "$USER" -s "browser-applicator-api-key" -w "your-api-key"
```

Supported providers:
- **OpenRouter** (recommended): Get key at https://openrouter.ai/keys
- **Anthropic**: Get key at https://console.anthropic.com/settings/keys
- **OpenAI**: Get key at https://platform.openai.com/api-keys
- **Google**: Get key at https://aistudio.google.com/apikey

## Usage

### Apply to jobs

With Claude Code, just say:
```
Apply to 10 product manager jobs
```

Claude will:
1. Search for matching jobs based on your preferences
2. Tailor your resume for each job (ATS optimization)
3. Submit applications
4. Track everything in the job tracker

### Tailor resume manually

```bash
python3 auto-applicator/ats_optimizer.py "paste job description here"
# Output: auto-applicator/resume_optimized.txt
```

### Apply to file-upload jobs

```bash
python browser-applicator/apply.py "https://jobs.ashbyhq.com/company/job-id"
```

Successfully submitted applications are automatically added to the tracker.

### View job tracker

```bash
python tracker/app.py
# Opens http://localhost:8080
```

The tracker shows:
- Kanban board with application stages
- Interview scheduling
- Salary information
- Notes and prep checklists

## Workflow

```
1. Find job posting
       ↓
2. Run ATS optimizer (REQUIRED for each job)
       ↓
3. Submit application (browser-applicator for file uploads)
       ↓
4. Auto-tracked in jobs.json
       ↓
5. Monitor in kanban tracker
```

**Important**: Always tailor your resume for each job. A generic resume significantly reduces your chances of getting past ATS filters.

## Configuration

### applicant.yaml

| Field | Description |
|-------|-------------|
| `name`, `email`, `phone`, `location` | Contact info |
| `linkedin` | LinkedIn profile URL |
| `resume_path` | Path to your resume PDF |
| `resume_text` | Plain text version of resume |
| `target_roles` | Job titles you're targeting |
| `salary_minimum` | Minimum acceptable base salary |
| `location_preference` | remote, hybrid, or onsite |
| `industries` | Industries of interest |
| `authorized_to_work_us` | Work authorization status |
| `requires_sponsorship` | Visa sponsorship needed |
| `exclude_companies` | Companies to skip |
| `exclude_platforms` | ATS platforms to skip (e.g., Workday) |
| `background_summary` | Used for custom application questions |
| `key_achievements` | Notable accomplishments |
| `llm_provider` | openrouter, anthropic, openai, or google |
| `llm_model` | Model name for browser automation |

## Privacy

This tool is designed with privacy in mind:
- `applicant.yaml` and `jobs.json` are gitignored
- API keys stored in macOS Keychain (not in files)
- No personal data in tracked code files

## Requirements

- Python 3.10+
- Flask (for tracker)
- browser-use (for file-upload jobs)
- Playwright + Chromium (for browser automation)

## License

MIT
