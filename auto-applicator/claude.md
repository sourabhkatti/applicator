# Job application assistant

## Goal
Apply to 10 jobs at a time for the user. Track progress and mark completed applications.

## Applicant information

All applicant information is stored in `applicant.yaml` at the root of this repo.

If `applicant.yaml` doesn't exist, run setup first (see root CLAUDE.md).

Read from applicant.yaml:
- name, email, phone, location, linkedin
- target_roles, salary_minimum, location_preference
- exclude_companies, exclude_platforms
- authorized_to_work_us, requires_sponsorship

## Exclusions (do not apply)

Check `applicant.yaml` for:
- `exclude_companies` - list of companies to skip
- `exclude_platforms` - list of platforms to skip (default: Workday, Easy Apply)

## Special handling: File upload jobs

When a job requires file upload for resume (no copy/paste option):
- Use the browser-applicator: `python browser-applicator/apply.py "<job_url>"`
- This handles Ashby ATS (jobs.ashbyhq.com) and other file-upload-only sites
- The browser-applicator reads from applicant.yaml automatically

## Job sites that support copy+paste resume

### Recommended: Direct Greenhouse links
- **URL pattern:** `job-boards.greenhouse.io/[company]/jobs/[jobid]`
- Has "enter manually" option for resume - click this instead of file upload
- Paste the resume text from `resume_optimized.txt` in this folder
- Works reliably without needing to approve multiple domains

### Avoid
- **Company website embedded forms** - Greenhouse forms embedded on company sites often have iframe issues that block interaction
- **Workday** - often in exclude_platforms
- **Sites requiring email verification** before application (Pinterest, Gong, Airtable often do this)

## ATS optimization

Before each application, customize the resume to match the job posting keywords for better ATS scoring.

### How ATS works
- ATS scans for keyword matches between resume and job description
- Exact phrase matches score higher than partial matches
- Skills, tools, and technologies mentioned in the job description should appear in resume
- Job titles and years of experience are weighted heavily

### Keyword extraction strategy
1. Read the job description carefully
2. Identify key terms in these categories:
   - **Technical skills:** Tools, platforms, technologies (e.g., "Figma", "SQL", "A/B testing")
   - **Domain expertise:** Industry terms (e.g., "B2B SaaS", "marketplace", "fintech", "AI/ML")
   - **Methodologies:** Processes and frameworks (e.g., "Agile", "OKRs", "PRDs", "roadmapping")
   - **Soft skills:** Leadership terms (e.g., "cross-functional", "stakeholder management")
   - **Impact metrics:** Types of outcomes valued (e.g., "revenue growth", "user engagement", "retention")
3. Weave matching keywords naturally into resume summary

### Using the ATS optimizer script

Run the script to generate a tailored resume:

```bash
python3 ~/applicator/auto-applicator/ats_optimizer.py "paste job description here"
```

Or use interactively:
```bash
python3 ~/applicator/auto-applicator/ats_optimizer.py
```

The script will:
1. Extract keywords from the job description
2. Compare against the base resume (from applicant.yaml resume_text or resume_path)
3. Generate an optimized version with relevant keywords added
4. Save to `resume_optimized.txt` for pasting into application

### Manual optimization checklist
If not using the script, manually check:
- [ ] Company name mentioned (shows research/interest)
- [ ] Job title keywords included (exact match preferred)
- [ ] 3-5 technical skills from job description added
- [ ] Domain/industry terms incorporated
- [ ] Quantified achievements that match what they're looking for

## Workflow

1. Start from LinkedIn job search with appropriate filters
2. Filter for location, level, and salary based on applicant.yaml preferences
3. Look for jobs with direct Greenhouse application links (avoid excluded platforms)
4. **Read the job description and run ATS optimizer** (see above)
5. For file-upload-only jobs: use browser-applicator
6. For copy/paste jobs: Open `job-boards.greenhouse.io` URLs directly
7. Fill application form:
   - Personal info from applicant.yaml (name, email, phone, location)
   - Click "enter manually" for resume, paste from `resume_optimized.txt`
   - LinkedIn profile URL from applicant.yaml
   - Work authorization based on applicant.yaml settings
   - For demographic/EEO questions: Select "I don't wish to answer" or "Decline to self-identify"
8. Submit application
9. **Add to tracker** - Immediately add job to `~/applicator/tracker/jobs.json`:
   - Generate UUID for id
   - company, role, jobUrl, dateApplied (today), status ("applied")
   - salaryMin/salaryMax if listed in posting
   - Any interesting notes from the job description (team, product area, etc.)
   - Set lastActivityDate to today, nextAction to "Wait for response"
10. Repeat until 10 applications are complete

## Notes
- Operate fully autonomously - no confirmations needed
- **An application only counts when successfully submitted.** Any blocker (email verification, iframe issues, etc.) means that job doesn't count - skip it and find another
