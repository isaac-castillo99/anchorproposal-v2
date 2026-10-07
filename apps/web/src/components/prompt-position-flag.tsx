'use client';

import type { ExperienceTitleMode } from '@/lib/api';

const TAILORED_OUTPUT_EXAMPLE = `{
  "summary": "Professional summary",
  "skills": [{ "Languages": "Java, SQL" }],
  "experiences": [
    { "role": "Tailored position", "bullets": ["Supported achievement"] }
  ],
  "educations": [
    {{educationsJson}}
  ],
  "certificates": [
    {{certificatesJson}}
  ],
  "coverLetter": {
    "greeting": "Dear Hiring Manager,",
    "paragraphs": [
      "Opening tailored to this role and company.",
      "Relevant candidate evidence connected to the job requirements.",
      "Closing tailored to this opportunity."
    ],
    "closing": "Sincerely,",
    "signatureName": "Candidate name"
  }
}`;

export function TailoredPromptOutputNotice() {
  return <aside role="note" aria-label="JD role match output format" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
    <p className="font-semibold">Output format warning</p>
    <p>Return one valid JSON object with summary, skills, experiences, educations, and certificates. Include exactly one experience per saved profile experience, in the same order, with role and bullets.</p>
    <p>Education and certificates are copied from the saved profile. These placeholders expand to flat arrays, or [] when empty; both forms with and without surrounding brackets are supported. Edit the profile first if its records are missing.</p>
    <p>Include coverLetter in the same JSON for a tailored cover letter. Use greeting, paragraphs, closing, and signatureName. Manual responses without it save only the resume; no default letter is substituted.</p>
    <details>
      <summary className="cursor-pointer font-medium">View output template</summary>
      <pre className="mt-2 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 font-mono text-xs">{TAILORED_OUTPUT_EXAMPLE}</pre>
      <p className="mt-2">The placeholders belong in your prompt. The final response must contain actual arrays, with no unresolved placeholders, trailing commas, or text outside the JSON.</p>
    </details>
  </aside>;
}

export function PromptPositionFlag({ value, onChange, disabled, fixedDefault = false }: {
  value: ExperienceTitleMode;
  onChange: (value: ExperienceTitleMode) => void;
  disabled?: boolean;
  fixedDefault?: boolean;
}) {
  if (fixedDefault) return <p className="text-xs text-slate-500">Default prompt · Fixed profile positions</p>;
  return <div className="space-y-3"><label className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3 text-sm text-slate-700">
    <input type="checkbox" checked={value === 'tailored'} disabled={disabled}
      onChange={e => onChange(e.target.checked ? 'tailored' : 'saved')} className="mt-0.5" />
    <span>JD role match<span className="mt-1 block text-xs text-slate-500">{value === 'tailored'
      ? 'This prompt tailors experience positions to the job description. Companies, dates, and the saved profile stay unchanged.'
      : 'Use only the fixed experience positions saved in the profile.'}</span></span>
  </label>
    {value === 'tailored' && <TailoredPromptOutputNotice />}
  </div>;
}
