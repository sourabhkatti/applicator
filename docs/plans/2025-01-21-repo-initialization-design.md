# Repo initialization design

Date: 2025-01-21

## Overview

Prepare the applicator repo for public sharing by removing all PII and creating a self-service onboarding flow. Users clone the repo, and either Claude or a web UI guides them through setup.

## Problem

The repo contains hardcoded personal information (name, email, phone, salary, resume, recruiter contacts) across 9 files. This must be removed before sharing, and replaced with a system that lets new users provide their own information.

## Solution

Single `applicant.yaml` config file with two onboarding paths:
1. **Claude flow**: Claude reads CLAUDE.md, knows what questions to ask, creates applicant.yaml
2. **UI flow**: Tracker app shows onboarding wizard, posts to Python backend, saves applicant.yaml

## Config file structure

```yaml
# Personal information
name: ""
email: ""
phone: ""
location: ""
linkedin: ""

# Resume
resume_path: ""  # Path to PDF, or leave blank to use text below
resume_text: ""  # Paste resume text if no PDF

# Job preferences
target_roles:
  - "Senior Product Manager"
salary_minimum: 0
location_preference: "hybrid"  # remote, hybrid, onsite
industries: []

# Work authorization
authorized_to_work_us: true
requires_sponsorship: false

# Exclusions
exclude_companies: []
exclude_platforms:
  - "Workday"
  - "Easy Apply"

# Professional background (for custom questions)
background_summary: ""
key_achievements: []

# LLM provider for browser-applicator (file upload jobs)
llm_provider: "openrouter"  # openrouter, anthropic, openai, google
llm_model: "google/gemini-2.0-flash-001"
```

## Claude onboarding flow

CLAUDE.md includes setup instructions. When applicant.yaml is missing:

1. Check if user has resume PDF → parse it
2. Extract: name, email, phone, location, LinkedIn, work history
3. Confirm extracted info with user
4. Ask: target salary minimum
5. Ask: location preference (remote/hybrid/onsite)
6. Ask: companies or platforms to exclude
7. Ask: LLM provider preference (OpenRouter/Anthropic/OpenAI/Google)
8. Guide user to get API key from chosen provider
9. Store API key in macOS Keychain
10. Generate applicant.yaml (includes llm_provider and llm_model)
11. Confirm setup complete

## Browser applicator (file upload jobs)

### When to use

The browser-applicator handles job applications that require file uploads (resume PDF) instead of copy/paste. This includes:
- Ashby ATS (jobs.ashbyhq.com)
- Any other ATS with "Upload File" only option
- Sites where JavaScript file input manipulation doesn't work

**Detection**: During application flow, if Claude encounters a file upload requirement without copy/paste option, it should use the browser-applicator.

### How it works

Uses browser-use (Playwright-based) which operates at Chrome DevTools Protocol level, bypassing JavaScript security restrictions for file uploads.

### API key setup

The browser-applicator requires an LLM API key. Users can choose their preferred provider.

### Supported providers

| Provider | Model example | Base URL |
|----------|---------------|----------|
| OpenRouter | `google/gemini-2.0-flash-001` | `https://openrouter.ai/api/v1` |
| Anthropic | `claude-sonnet-4-20250514` | (default) |
| OpenAI | `gpt-4o` | (default) |
| Google | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta/openai` |

### Key storage

Keys are stored in macOS Keychain for security (not in config files):

```bash
# Add key to keychain
security add-generic-password -a "$USER" -s "browser-applicator-api-key" -w "your-api-key"

# Retrieve key (used by apply.py)
security find-generic-password -s "browser-applicator-api-key" -w
```

### Config in applicant.yaml

```yaml
# LLM provider for browser-applicator (file upload jobs)
llm_provider: "openrouter"  # openrouter, anthropic, openai, google
llm_model: "google/gemini-2.0-flash-001"
```

### Claude setup flow for API key

When setting up browser-applicator, Claude should:

1. Ask: "Which LLM provider do you want to use for browser automation? Options: OpenRouter (recommended - access to many models), Anthropic, OpenAI, or Google."

2. Based on choice, provide instructions:
   - **OpenRouter**: "Get your API key from https://openrouter.ai/keys. Recommended models: `google/gemini-2.0-flash-001` (fast, cheap) or `anthropic/claude-sonnet-4` (high quality)."
   - **Anthropic**: "Get your API key from https://console.anthropic.com/settings/keys. Model: `claude-sonnet-4-20250514`."
   - **OpenAI**: "Get your API key from https://platform.openai.com/api-keys. Model: `gpt-4o`."
   - **Google**: "Get your API key from https://aistudio.google.com/apikey. Model: `gemini-2.0-flash`."

3. Ask user to provide the key (or paste it)

4. Store in keychain:
   ```bash
   security add-generic-password -a "$USER" -s "browser-applicator-api-key" -w "USER_PROVIDED_KEY"
   ```

5. Update applicant.yaml with provider and model choice

6. Test the setup by running a quick validation (optional)

### Code changes to apply.py

Update `apply.py` to:
- Read `llm_provider` and `llm_model` from applicant.yaml
- Use appropriate LLM class based on provider:
  - `openrouter` → `ChatOpenAI` with OpenRouter base_url
  - `anthropic` → `ChatAnthropic`
  - `openai` → `ChatOpenAI`
  - `google` → `ChatOpenAI` with Google base_url
- Retrieve key from keychain using generic name `browser-applicator-api-key`

## UI onboarding flow

Tracker runs as Flask app with invisible Python backend:

- `GET /api/config` → returns applicant.yaml or 404
- `POST /api/config` → saves applicant.yaml

User experience:
1. Claude runs `python tracker/app.py`
2. Browser opens localhost:8080
3. If no config: onboarding wizard modal appears
4. User fills multi-step form, clicks Save
5. JS posts to /api/config, Python writes file
6. Redirect to kanban board

## Files to change

| Action | File | Description |
|--------|------|-------------|
| Create | `applicant.yaml.example` | Template with empty values |
| Create | `tracker/app.py` | Flask server with /api/config |
| Update | `tracker/index.html` | Add onboarding wizard modal |
| Update | `CLAUDE.md` | Setup instructions, question sequence |
| Rename | `ashby-applicator/` → `browser-applicator/` | Generic name for file-upload jobs |
| Update | `browser-applicator/applicant_parser.py` | Read from applicant.yaml |
| Update | `browser-applicator/apply.py` | Support multiple LLM providers, read config from applicant.yaml |
| Update | `auto-applicator/claude.md` | Remove PII, reference applicant.yaml |
| Delete | `auto-applicator/resume.txt` | User provides their own |
| Delete | `auto-applicator/resume_optimized.txt` | Generated per-job |
| Reset | `tracker/jobs.json` | Empty array template |
| Update | `.gitignore` | Add applicant.yaml, *.pdf, jobs.json |

## PII removal checklist

Files with PII to clean:
- [ ] `auto-applicator/claude.md` - name, email, phone, LinkedIn, salary
- [ ] `auto-applicator/resume.txt` - delete entirely
- [ ] `auto-applicator/resume_optimized.txt` - delete entirely
- [ ] `browser-applicator/applicant_parser.py` - remove hardcoded background
- [ ] `tracker/jobs.json` - reset to empty array
- [ ] `tracker/index.html` - remove name from title
- [ ] `tracker/CLAUDE.md` - remove name reference
- [ ] `CLAUDE.md` - remove name reference

## Dependencies

- Flask (single new dependency for tracker backend)
- PyYAML (for config parsing)
