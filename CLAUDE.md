# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project overview

Job search application suite for autonomous job applications:
1. **Auto-applicator** (`/auto-applicator`) - Apply to jobs with ATS-optimized resumes
2. **Browser-applicator** (`/browser-applicator`) - Handles file-upload-only job applications
3. **Job tracker** (`/tracker`) - Kanban board tracking all applications

## First-time setup

**Check if setup is needed:** Look for `applicant.yaml` in the repo root.

If `applicant.yaml` doesn't exist, guide the user through setup:

### Prerequisites

Install dependencies first:

```bash
# Tracker dependencies (Flask for config API)
pip install -r tracker/requirements.txt

# Optional: Browser-applicator dependencies (only needed for file-upload jobs)
pip install -r browser-applicator/requirements.txt
playwright install chromium
```

### Setup flow

1. **Resume**: "Do you have a resume PDF? Provide the path, or paste your resume text."
   - If path provided: validate file exists
   - If text provided: will be stored in `resume_text` field

2. **Parse resume** (if PDF provided): Read it and extract:
   - Name, email, phone, location
   - LinkedIn URL
   - Work history summary for `background_summary`
   - Key achievements for `key_achievements`

3. **Confirm extracted info**: "I found [name], [email], [phone], [location]. Correct?"
   - Let user correct any mistakes

4. **LinkedIn**: "What's your LinkedIn profile URL?"
   - Skip if already extracted from resume

5. **Job preferences**:
   - "What roles are you targeting?" → `target_roles`
   - "What's your minimum base salary?" → `salary_minimum`
   - "Location preference: remote, hybrid, or onsite?" → `location_preference`
   - "What industries interest you?" → `industries`

6. **Work authorization**:
   - "Are you authorized to work in the US?" → `authorized_to_work_us`
   - "Do you require visa sponsorship?" → `requires_sponsorship`

7. **Exclusions**:
   - "Any companies to exclude? (former employers, etc.)" → `exclude_companies`
   - "Platforms to skip are: Workday, Easy Apply. Add any others?" → `exclude_platforms`

8. **Generate applicant.yaml**: Copy `applicant.yaml.example` to `applicant.yaml` and fill in all collected info.

9. **Confirm**: "Setup complete! Your configuration is saved in applicant.yaml."

### Optional: Browser-applicator setup

Only needed if user wants to apply to jobs that require file uploads (Ashby ATS, etc.):

1. **LLM provider**: "Do you want to set up browser automation for file-upload jobs? (Optional)"
   - If no: skip remaining steps
   - If yes: "Which LLM provider? Options: OpenRouter (recommended), Anthropic, OpenAI, or Google"

2. Based on choice, provide instructions:
   - **OpenRouter**: "Get API key from https://openrouter.ai/keys"
     - Recommended models: `google/gemini-2.0-flash-001` (fast, cheap) or `anthropic/claude-sonnet-4`
   - **Anthropic**: "Get API key from https://console.anthropic.com/settings/keys"
     - Model: `claude-sonnet-4-20250514`
   - **OpenAI**: "Get API key from https://platform.openai.com/api-keys"
     - Model: `gpt-4o`
   - **Google**: "Get API key from https://aistudio.google.com/apikey"
     - Model: `gemini-2.0-flash`

3. **Store API key**: Once user provides the key:
   ```bash
   security add-generic-password -a "$USER" -s "browser-applicator-api-key" -w "USER_KEY_HERE"
   ```

4. Update `llm_provider` and `llm_model` in applicant.yaml.

### After setup

- **View tracker**: `python tracker/app.py` opens http://localhost:8080
- **Apply to jobs**: Say "apply to 10 jobs" to start autonomous applications
- **Update preferences**: Edit `applicant.yaml` directly

## Primary workflow: Apply to jobs

Operate fully autonomously - no confirmations needed.

1. Read preferences from `applicant.yaml`
2. Search for jobs matching target_roles and preferences
3. **For each job, follow these steps IN ORDER:**

   **Step A: Check exclusions**
   - Skip if company is in `exclude_companies`
   - Skip if platform is in `exclude_platforms`

   **Step B: MANDATORY - Tailor the resume**
   > ⚠️ **CRITICAL: You MUST tailor the resume for EVERY job application.**
   > Do NOT skip this step. Do NOT batch applications without tailoring.
   > A generic resume significantly reduces chances of getting past ATS filters.

   1. Read/fetch the full job description
   2. Run the ATS optimizer:
      ```bash
      python3 ~/applicator/auto-applicator/ats_optimizer.py "PASTE FULL JOB DESCRIPTION HERE"
      ```
   3. This outputs a tailored resume to `auto-applicator/resume_optimized.txt`
   4. For browser-applicator jobs, the optimized resume will be converted to PDF

   **Step C: Submit the application**
   - If file upload required (Ashby, etc.): `python browser-applicator/apply.py "<url>"`
     - ✅ **Automatic tracking**: Successful applications are automatically added to the tracker
   - Otherwise: fill and submit via Greenhouse copy/paste method
     - Manual tracking required for non-browser-applicator submissions

   **Step D: Verify tracking**
   - browser-applicator auto-adds to `/tracker/jobs.json` on success
   - For manual applications, add to tracker: (company, role, URL, salary if listed, notes)

4. Repeat steps A-D for each job until target number of applications complete

**DO NOT parallelize applications** - each job needs individual resume tailoring.

Details: `/auto-applicator/claude.md`

## Common commands

### Optimize resume for a job

```bash
python3 ~/applicator/auto-applicator/ats_optimizer.py "job description text"
```

Output: `auto-applicator/resume_optimized.txt`

### Apply to file-upload-only jobs

```bash
python browser-applicator/apply.py "https://jobs.ashbyhq.com/company/job-id"
```

### View job tracker

```bash
python tracker/app.py
```

Opens http://localhost:8080

## Architecture

```
applicator/
├── applicant.yaml          # Your info (gitignored)
├── applicant.yaml.example  # Template
├── auto-applicator/
│   ├── ats_optimizer.py    # Resume customization script
│   └── claude.md           # Application workflow
├── browser-applicator/
│   ├── apply.py            # Browser-based application for file uploads
│   ├── applicant_parser.py # Reads from applicant.yaml
│   └── resume_generator.py # Text-to-PDF conversion
└── tracker/
    ├── app.py          # Flask server
    ├── index.html      # Kanban board UI
    ├── jobs.json       # Job data (gitignored)
    └── CLAUDE.md       # Tracker commands
```

## Key context

- All personal info stored in `applicant.yaml` (gitignored)
- Job data schema documented in `/tracker/CLAUDE.md`
- Exclusions configured in `applicant.yaml`
- Browser-applicator handles Ashby ATS and other file-upload-only sites
- API key for browser-applicator stored in macOS Keychain (optional)
