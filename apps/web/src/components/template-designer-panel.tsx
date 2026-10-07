'use client';

import {
  Award,
  Briefcase,
  Contact,
  GraduationCap,
  LayoutTemplate,
  Palette,
  Rows3,
  Type,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type DesignerTab =
  | 'typography'
  | 'layout'
  | 'colors'
  | 'contact'
  | 'experience'
  | 'education'
  | 'certifications'
  | 'sections'
  | 'pdf';

type Nested = Record<string, unknown>;

const SECTION_KEYS = ['summary', 'skills', 'experience', 'education', 'certifications'] as const;

const SECTION_LABELS: Record<(typeof SECTION_KEYS)[number], string> = {
  summary: 'Professional Summary',
  skills: 'Technical Skills',
  experience: 'Professional Experience',
  education: 'Education',
  certifications: 'Certifications',
};

const FONTS = [
  'Georgia',
  'Garamond',
  'Times New Roman',
  'Palatino',
  'Inter',
  'Calibri',
  'Arial',
  'Cambria',
];

const inputClass =
  'w-full px-2.5 py-1.5 rounded-lg text-sm bg-white border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

const labelClass = 'block text-xs font-medium text-slate-600 mb-1';

function asObj(value: unknown): Nested {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Nested) : {};
}

export const DESIGNER_TABS: { key: DesignerTab; label: string; icon: typeof Type }[] = [
  { key: 'typography', label: 'Typography', icon: Type },
  { key: 'layout', label: 'Layout', icon: LayoutTemplate },
  { key: 'colors', label: 'Colors', icon: Palette },
  { key: 'contact', label: 'Contact', icon: Contact },
  { key: 'experience', label: 'Experience', icon: Briefcase },
  { key: 'education', label: 'Education', icon: GraduationCap },
  { key: 'certifications', label: 'Certifications', icon: Award },
  { key: 'sections', label: 'Sections', icon: Rows3 },
  { key: 'pdf', label: 'PDF Style', icon: LayoutTemplate },
];

const PDF_THEMES: { id: string; label: string; accent: 'none' | 'top-rule' | 'top-band' | 'side'; color?: string }[] = [
  { id: 'none', label: 'None', accent: 'none' },
  { id: 'classy', label: 'Classy', accent: 'top-rule', color: '#1e3a5f' },
  { id: 'scarlet', label: 'Scarlet', accent: 'top-band', color: '#b91c1c' },
  { id: 'gradient', label: 'Gradient', accent: 'top-rule', color: '#2563eb' },
  { id: 'linear', label: 'Linear', accent: 'side', color: '#0f766e' },
  { id: 'sunny', label: 'Sunny', accent: 'top-band', color: '#b45309' },
  { id: 'executive', label: 'Executive', accent: 'top-rule', color: '#111827' },
  { id: 'postcard', label: 'Postcard', accent: 'side', color: '#7c2d12' },
];

export function TemplateDesignerPanel({
  tab,
  onTabChange,
  config,
  onChange,
}: {
  tab: DesignerTab;
  onTabChange: (tab: DesignerTab) => void;
  config: Nested;
  onChange: (next: Nested) => void;
}) {
  const typography = asObj(config.typography);
  const colors = asObj(config.colors);
  const layout = asObj(config.layout);
  const style = asObj(config.styles);
  const contact = asObj(config.contact);
  const pdf = asObj(config.pdf);
  const sections = asObj(config.sections);
  const visibility = asObj(sections.visibility);
  const order =
    Array.isArray(sections.order) && sections.order.length
      ? (sections.order as string[])
      : [...SECTION_KEYS];

  const patch = (key: string, value: Nested) => onChange({ ...config, [key]: value });

  const setTypography = (key: string, value: unknown) =>
    patch('typography', { ...typography, [key]: value });
  const setColors = (key: string, value: unknown) => patch('colors', { ...colors, [key]: value });
  const setLayout = (key: string, value: unknown) => patch('layout', { ...layout, [key]: value });
  const setStyle = (key: string, value: unknown) => patch('styles', { ...style, [key]: value });
  const setContact = (key: string, value: unknown) => patch('contact', { ...contact, [key]: value });

  const setSections = (nextOrder: string[], nextVisibility = visibility) => {
    onChange({
      ...config,
      sections: { ...sections, order: nextOrder, visibility: nextVisibility },
    });
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    setSections(next);
  };

  const colorField = (key: string, label: string, fallback: string) => (
    <div key={key}>
      <label className={labelClass}>{label}</label>
      <div className="flex gap-2 items-center">
        <input
          type="color"
          value={String(colors[key] || fallback)}
          onChange={(e) => setColors(key, e.target.value)}
          className="h-9 w-12 rounded border border-slate-300 cursor-pointer bg-white p-0.5"
        />
        <input
          type="text"
          value={String(colors[key] || fallback)}
          onChange={(e) => setColors(key, e.target.value)}
          className={cn(inputClass, 'font-mono text-xs')}
        />
      </div>
    </div>
  );

  const numberField = (
    label: string,
    value: number,
    onValue: (n: number) => void,
    opts?: { min?: number; max?: number; step?: number },
  ) => (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type="number"
        min={opts?.min}
        max={opts?.max}
        step={opts?.step}
        value={value}
        onChange={(e) => onValue(parseFloat(e.target.value) || opts?.min || 0)}
        className={inputClass}
      />
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-0 shadow-sm">
      <div className="flex flex-wrap gap-1 p-2 border-b border-slate-200 bg-slate-50">
        {DESIGNER_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange(t.key)}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
                tab === t.key
                  ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="p-4 space-y-4">
        {tab === 'typography' && (
          <>
            <div>
              <label className={labelClass}>Font Family</label>
              <select
                value={String(typography.bodyFont || 'Georgia')}
                onChange={(e) => {
                  patch('typography', {
                    ...typography,
                    bodyFont: e.target.value,
                    headingFont: e.target.value,
                  });
                }}
                className={inputClass}
              >
                {FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {numberField('Name Size (pt)', Number(typography.nameSize ?? 20), (n) =>
                setTypography('nameSize', n),
              )}
              {numberField('Heading Size (pt)', Number(typography.headingSize ?? 12), (n) =>
                setTypography('headingSize', n),
              )}
              {numberField('Body Size (pt)', Number(typography.baseFontSize ?? 10), (n) =>
                setTypography('baseFontSize', n),
              )}
              {numberField('Contact Size (pt)', Number(typography.contactSize ?? 9), (n) =>
                setTypography('contactSize', n),
              )}
              {numberField('Sub-text Size (pt)', Number(typography.subtextSize ?? 8), (n) =>
                setTypography('subtextSize', n),
              )}
            </div>
            <label className="flex items-center justify-between text-sm text-slate-700">
              <span>Name uppercase</span>
              <input
                type="checkbox"
                checked={Boolean(typography.nameUppercase)}
                onChange={(e) => setTypography('nameUppercase', e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between text-sm text-slate-700">
              <span>Heading uppercase</span>
              <input
                type="checkbox"
                checked={typography.headingUppercase !== false}
                onChange={(e) => setTypography('headingUppercase', e.target.checked)}
              />
            </label>
          </>
        )}

        {tab === 'layout' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Header Alignment</label>
                <select
                  value={String(layout.headerAlignment || 'left')}
                  onChange={(e) => setLayout('headerAlignment', e.target.value)}
                  className={inputClass}
                >
                  <option value="center">Center</option>
                  <option value="left">Left</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Contact Separator</label>
                <input
                  value={String(layout.contactSeparator ?? '·')}
                  onChange={(e) => setLayout('contactSeparator', e.target.value)}
                  className={inputClass}
                />
              </div>
              {numberField(
                'Line spacing (%)',
                Math.round(Number(typography.lineHeight ?? 1.4) * 100),
                (n) => setTypography('lineHeight', n / 100),
                { min: 100, max: 200, step: 5 },
              )}
              {numberField('Section Spacing', Number(layout.sectionSpacing ?? 16), (n) =>
                setLayout('sectionSpacing', n),
              )}
              {numberField('Name-Contact Gap', Number(layout.nameContactGap ?? 6), (n) =>
                setLayout('nameContactGap', n),
              )}
            </div>
            <div>
              <label className={labelClass}>Page Size</label>
              <select
                value={String(layout.pageSize || 'LETTER')}
                onChange={(e) => setLayout('pageSize', e.target.value)}
                className={inputClass}
              >
                <option value="LETTER">Letter (8.5 x 11 in)</option>
                <option value="A4">A4</option>
              </select>
            </div>
            <div>
              <p className={labelClass}>Page Margins (px)</p>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ['marginTop', 'Top', 36],
                    ['marginBottom', 'Bottom', 36],
                    ['marginLeft', 'Left', 48],
                    ['marginRight', 'Right', 48],
                  ] as const
                ).map(([key, label, fallback]) => (
                  <div key={key}>
                    <label className={labelClass}>{label}</label>
                    <input
                      type="number"
                      value={Number(layout[key] ?? fallback)}
                      min={28}
                      max={120}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setLayout(key, Number.isFinite(n) ? n : fallback);
                      }}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>Section Heading Line Style</label>
              <select
                value={String(style.sectionHeadingStyle || 'underline')}
                onChange={(e) => setStyle('sectionHeadingStyle', e.target.value)}
                className={inputClass}
              >
                <option value="underline">Full Rule</option>
                <option value="background">Background bar</option>
                <option value="bar">Left accent bar</option>
                <option value="plain">None</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Skills layout</label>
                <select
                  value={String(style.skillsLayout || 'comma')}
                  onChange={(e) => setStyle('skillsLayout', e.target.value)}
                  className={inputClass}
                >
                  <option value="comma">Category: items</option>
                  <option value="lines">One category per line</option>
                  <option value="bullets">Bullet list</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Bullet style</label>
                <select
                  value={String(style.listStyle || 'disc')}
                  onChange={(e) => setStyle('listStyle', e.target.value)}
                  className={inputClass}
                >
                  <option value="disc">Disc</option>
                  <option value="circle">Circle</option>
                  <option value="square">Square</option>
                  <option value="dash">Dash</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
          </>
        )}

        {tab === 'colors' && (
          <div className="grid grid-cols-2 gap-3">
            {colorField('primary', 'Name', '#111827')}
            {colorField('contact', 'Contact', '#475569')}
            {colorField('heading', 'Headings', '#1e293b')}
            {colorField('body', 'Body Text', '#1e293b')}
            {colorField('muted', 'Sub-text', '#64748b')}
            {colorField('accent', 'Accent', '#1e3a5f')}
            {colorField('divider', 'Divider', '#cbd5e1')}
            {colorField('sectionLabelBg', 'Section background', '#e8eef5')}
            {colorField('sectionLabelText', 'Section label', '#1e293b')}
          </div>
        )}

        {tab === 'contact' && (
          <>
            <div>
              <label className={labelClass}>Layout</label>
              <select
                value={String(contact.layout || 'single')}
                onChange={(e) => setContact('layout', e.target.value)}
                className={inputClass}
              >
                <option value="single">Single Line</option>
                <option value="stacked">Stacked</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Choose which contact details appear, and how they are arranged.
              </p>
            </div>
            {(
              [
                ['showEmail', 'Email'],
                ['showPhone', 'Phone'],
                ['showLocation', 'Location'],
                ['showLinkedin', 'LinkedIn'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between text-sm text-slate-700">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={contact[key] !== false}
                  onChange={(e) => setContact(key, e.target.checked)}
                />
              </label>
            ))}
          </>
        )}

        {tab === 'experience' && (
          <>
            <p className="text-xs text-slate-500">
              Job title, company, location, and dates stay on one line. Style applies to the preview and PDF.
            </p>
            <label className="flex items-center justify-between text-sm text-slate-700">
              <span>Bold job title</span>
              <input
                type="checkbox"
                checked={style.experienceTitleWeight !== 'normal'}
                onChange={(e) => setStyle('experienceTitleWeight', e.target.checked ? 'bold' : 'normal')}
              />
            </label>
            <label className="flex items-center justify-between text-sm text-slate-700">
              <span>Italic location and dates</span>
              <input
                type="checkbox"
                checked={Boolean(style.locationItalic)}
                onChange={(e) => setStyle('locationItalic', e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between text-sm text-slate-700">
              <span>Show experience section</span>
              <input
                type="checkbox"
                checked={visibility.experience !== false}
                onChange={(e) => setSections(order, { ...visibility, experience: e.target.checked })}
              />
            </label>
          </>
        )}

        {tab === 'education' && (
          <label className="flex items-center justify-between text-sm text-slate-700">
            <span>Show education</span>
            <input
              type="checkbox"
              checked={visibility.education !== false}
              onChange={(e) => setSections(order, { ...visibility, education: e.target.checked })}
            />
          </label>
        )}

        {tab === 'certifications' && (
          <>
            <p className="text-xs text-slate-500">
              The certificate name is always shown. Issuer and date can be hidden.
            </p>
            <label className="flex items-center justify-between text-sm text-slate-700">
              <span>Show certifications</span>
              <input
                type="checkbox"
                checked={visibility.certifications !== false}
                onChange={(e) =>
                  setSections(order, { ...visibility, certifications: e.target.checked })
                }
              />
            </label>
            <label className="flex items-center justify-between text-sm text-slate-700">
              <span>Issuing organization</span>
              <input
                type="checkbox"
                checked={style.showCertIssuer !== false}
                onChange={(e) => setStyle('showCertIssuer', e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between text-sm text-slate-700">
              <span>Issue date</span>
              <input
                type="checkbox"
                checked={style.showCertDate !== false}
                onChange={(e) => setStyle('showCertDate', e.target.checked)}
              />
            </label>
          </>
        )}

        {tab === 'sections' && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Reorder sections and toggle visibility.</p>
            {order.map((section, index) => {
              const label = SECTION_LABELS[section as keyof typeof SECTION_LABELS] || section;
              const shown = visibility[section] !== false;
              return (
                <div
                  key={section}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <span className="flex-1 text-sm text-slate-700">{label}</span>
                  <button
                    type="button"
                    title="Move up"
                    onClick={() => moveSection(index, -1)}
                    className="p-1 text-slate-400 hover:text-slate-800"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    onClick={() => moveSection(index, 1)}
                    className="p-1 text-slate-400 hover:text-slate-800"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title={shown ? 'Hide section' : 'Show section'}
                    onClick={() => setSections(order, { ...visibility, [section]: !shown })}
                    className="p-1 text-slate-400 hover:text-slate-800"
                  >
                    {shown ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'pdf' && (
          <>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Decorative header accents</h3>
              <p className="text-xs text-slate-500 mt-1">
                Applied to the live preview and the PDF. Each theme sets the accent color and header treatment together.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PDF_THEMES.map((theme) => {
                const active =
                  String(pdf.headerAccent || 'none') === theme.accent &&
                  (theme.color ? colors.accent === theme.color : theme.accent === 'none');
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => {
                      onChange({
                        ...config,
                        pdf: { ...pdf, headerAccent: theme.accent },
                        colors: theme.color ? { ...colors, accent: theme.color } : colors,
                      });
                    }}
                    className={cn(
                      'rounded-lg border bg-white p-2 text-left',
                      active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200',
                    )}
                  >
                    <div
                      className="h-10 rounded-sm border border-slate-200 relative overflow-hidden"
                      style={{
                        borderTop:
                          theme.accent === 'top-band' ? `6px solid ${theme.color || '#111'}` : undefined,
                        boxShadow:
                          theme.accent === 'side'
                            ? `inset 4px 0 0 ${theme.color || '#111'}`
                            : undefined,
                      }}
                    >
                      <div className="absolute left-2 right-2 top-2 h-1.5 bg-slate-800 rounded" />
                      {theme.accent === 'top-rule' && (
                        <div
                          className="absolute left-2 right-2 top-5 h-px"
                          style={{ background: theme.color || '#111' }}
                        />
                      )}
                      <div className="absolute left-2 right-6 top-7 h-1 bg-slate-300 rounded" />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-700 text-center">{theme.label}</p>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function resolveTemplateMeta(
  name: string,
  preset: string | null | undefined,
  config: Nested,
): { description: string; tags: string[] } {
  const meta = asObj(config.meta);
  const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : [];
  if (meta.description || tags.length) {
    return {
      description: String(meta.description || ''),
      tags,
    };
  }

  const key = (preset || name || '').toLowerCase();
  if (key.includes('modern') || key.includes('minimal')) {
    return {
      description: 'Clean left-aligned layout with subtle spacing. Great for tech.',
      tags: ['Modern', 'Tech'],
    };
  }
  if (key.includes('classic')) {
    return {
      description: 'Traditional format with centered header and clean rules.',
      tags: ['Corporate', 'Traditional'],
    };
  }
  if (key.includes('executive')) {
    return {
      description: 'Commanding presence with a large name and bold dividers.',
      tags: ['Executive', 'Leadership'],
    };
  }
  if (key.includes('compact') || key.includes('technical')) {
    return {
      description: 'Dense layout that fits more content. Skills-first for technical roles.',
      tags: ['Technical', 'Dense'],
    };
  }
  if (key.includes('academic')) {
    return {
      description: 'Scholarly design with serif fonts and generous margins.',
      tags: ['Academic', 'Research'],
    };
  }
  if (key.includes('creative')) {
    return {
      description: 'Elegant with colored dividers and mixed-case headings.',
      tags: ['Creative', 'Design'],
    };
  }
  if (key.includes('startup')) {
    return {
      description: 'Bold and modern with accent colors. Perfect for startups.',
      tags: ['Tech', 'Startup'],
    };
  }
  if (key.includes('federal') || key.includes('gov')) {
    return {
      description: 'Conservative and ATS-friendly. Designed for federal applications.',
      tags: ['Government', 'Federal'],
    };
  }
  if (key.includes('health')) {
    return {
      description: 'Clean and readable format for medical, nursing, and clinical roles.',
      tags: ['Healthcare', 'Medical'],
    };
  }
  if (key.includes('entry') || key.includes('graduate')) {
    return {
      description: 'Education-first layout for new graduates and early-career roles.',
      tags: ['Entry level', 'Graduate'],
    };
  }
  if (key.includes('sales') || key.includes('marketing')) {
    return {
      description: 'Dynamic and results-driven. Ideal for sales and marketing.',
      tags: ['Sales', 'Marketing'],
    };
  }
  if (key.includes('legal')) {
    return {
      description: 'Formal and traditional format for attorneys and legal teams.',
      tags: ['Legal', 'Law'],
    };
  }
  return {
    description: 'Custom resume template for tailored generation.',
    tags: ['Custom'],
  };
}
