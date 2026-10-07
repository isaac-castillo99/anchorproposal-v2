/**
 * Original single-column resume styles.
 * Categories follow common public layouts used by career centers and resume builders
 * (chronological, skills-first, serif executive, ATS-plain, education-first).
 * These are not copies of any commercial template file.
 */

type Config = Record<string, unknown>;

const order = ['summary', 'skills', 'experience', 'education', 'certifications'];
const educationFirst = ['summary', 'education', 'experience', 'skills', 'certifications'];
const skillsFirst = ['summary', 'skills', 'experience', 'education', 'certifications'];

function config(partial: Config): Config {
  return {
    typography: {
      bodyFont: 'Inter',
      headingFont: 'Inter',
      baseFontSize: 10.5,
      headingScale: 1.15,
      lineHeight: 1.4,
      letterSpacing: 0,
      nameUppercase: false,
      headingUppercase: true,
      nameSize: 18,
      headingSize: 11,
      contactSize: 9,
      subtextSize: 8,
      ...(partial.typography as object),
    },
    layout: {
      pageSize: 'LETTER',
      marginTop: 40,
      marginBottom: 40,
      marginLeft: 48,
      marginRight: 48,
      sectionSpacing: 14,
      headerAlignment: 'left',
      contactSeparator: '·',
      nameContactGap: 4,
      ...(partial.layout as object),
    },
    colors: {
      primary: '#111827',
      heading: '#1e293b',
      body: '#334155',
      accent: '#1e3a5f',
      divider: '#cbd5e1',
      contact: '#475569',
      muted: '#64748b',
      sectionLabelBg: '#f1f5f9',
      sectionLabelText: '#1e293b',
      ...(partial.colors as object),
    },
    contact: {
      layout: 'single',
      showEmail: true,
      showPhone: true,
      showLocation: true,
      showLinkedin: true,
      ...(partial.contact as object),
    },
    pdf: {
      headerAccent: 'none',
      ...(partial.pdf as object),
    },
    styles: {
      sectionHeadingStyle: 'underline',
      listStyle: 'disc',
      skillsLayout: 'comma',
      showDividers: true,
      experienceTitleWeight: 'bold',
      locationItalic: true,
      showCertIssuer: true,
      showCertDate: true,
      ...(partial.styles as object),
    },
    sections: {
      order,
      visibility: {
        summary: true,
        skills: true,
        experience: true,
        education: true,
        certifications: true,
      },
      ...(partial.sections as object),
    },
    meta: partial.meta,
  };
}

export const TEMPLATE_CATALOG: { name: string; preset: string; configJson: Config }[] = [
  {
    name: 'Modern Minimal',
    preset: 'modern-minimal',
    configJson: config({
      typography: { bodyFont: 'Inter', headingFont: 'Inter', nameSize: 20, headingUppercase: true },
      colors: { primary: '#0f172a', accent: '#0f766e', divider: '#e2e8f0', contact: '#475569' },
      pdf: { headerAccent: 'top-rule' },
      meta: {
        description: 'Clean left-aligned layout with subtle spacing. Great for tech.',
        tags: ['Modern', 'Tech'],
      },
    }),
  },
  {
    name: 'Classic Professional',
    preset: 'classic-professional',
    configJson: config({
      typography: {
        bodyFont: 'Georgia',
        headingFont: 'Georgia',
        nameSize: 20,
        headingSize: 12,
        baseFontSize: 11,
        lineHeight: 1.45,
        nameUppercase: true,
      },
      layout: { headerAlignment: 'center', contactSeparator: '|', nameContactGap: 6, sectionSpacing: 16 },
      colors: { primary: '#1f2937', heading: '#1f2937', body: '#374151', accent: '#1f2937', divider: '#9ca3af' },
      pdf: { headerAccent: 'top-rule' },
      meta: {
        description: 'Traditional format with centered header and clean rules.',
        tags: ['Corporate', 'Traditional'],
      },
    }),
  },
  {
    name: 'Executive Bold',
    preset: 'executive-bold',
    configJson: config({
      typography: {
        bodyFont: 'Georgia',
        headingFont: 'Georgia',
        nameSize: 24,
        headingSize: 12,
        nameUppercase: true,
        letterSpacing: 0.4,
      },
      layout: { headerAlignment: 'center', contactSeparator: '|', sectionSpacing: 18, marginTop: 46 },
      colors: { primary: '#111827', accent: '#111827', divider: '#111827', heading: '#111827' },
      styles: { sectionHeadingStyle: 'underline', experienceTitleWeight: 'bold' },
      pdf: { headerAccent: 'top-band' },
      meta: {
        description: 'Commanding presence with a large name and bold dividers.',
        tags: ['Executive', 'Leadership'],
      },
    }),
  },
  {
    name: 'Compact Technical',
    preset: 'compact-technical',
    configJson: config({
      typography: {
        bodyFont: 'Calibri',
        headingFont: 'Calibri',
        baseFontSize: 9.5,
        nameSize: 16,
        headingSize: 10,
        contactSize: 8,
        lineHeight: 1.25,
      },
      layout: { sectionSpacing: 8, marginTop: 28, marginBottom: 28, marginLeft: 36, marginRight: 36 },
      sections: { order: skillsFirst },
      styles: { skillsLayout: 'lines', listStyle: 'square' },
      colors: { primary: '#0f172a', accent: '#1d4ed8' },
      meta: {
        description: 'Dense layout that fits more content. Skills-first for technical roles.',
        tags: ['Technical', 'Dense'],
      },
    }),
  },
  {
    name: 'Academic Serif',
    preset: 'academic-serif',
    configJson: config({
      typography: {
        bodyFont: 'Garamond',
        headingFont: 'Garamond',
        baseFontSize: 11,
        nameSize: 20,
        lineHeight: 1.5,
        headingUppercase: false,
      },
      layout: { marginTop: 56, marginBottom: 56, marginLeft: 64, marginRight: 64, sectionSpacing: 16 },
      sections: { order: educationFirst },
      colors: { primary: '#1c1917', heading: '#1c1917', accent: '#1c1917', divider: '#a8a29e' },
      meta: {
        description: 'Scholarly design with serif fonts and generous margins.',
        tags: ['Academic', 'Research'],
      },
    }),
  },
  {
    name: 'Creative Clean',
    preset: 'creative-clean',
    configJson: config({
      typography: { bodyFont: 'Inter', headingFont: 'Georgia', nameSize: 22, headingUppercase: false },
      colors: {
        primary: '#0f766e',
        heading: '#115e59',
        accent: '#0f766e',
        sectionLabelBg: '#ccfbf1',
        sectionLabelText: '#115e59',
      },
      styles: { sectionHeadingStyle: 'background' },
      pdf: { headerAccent: 'side' },
      meta: {
        description: 'Elegant with colored dividers and mixed-case headings.',
        tags: ['Creative', 'Design'],
      },
    }),
  },
  {
    name: 'Tech Startup',
    preset: 'tech-startup',
    configJson: config({
      typography: { bodyFont: 'Inter', headingFont: 'Inter', nameSize: 22, headingUppercase: true },
      colors: { primary: '#1d4ed8', heading: '#1e3a8a', accent: '#2563eb', contact: '#1d4ed8' },
      styles: { skillsLayout: 'lines', sectionHeadingStyle: 'bar' },
      pdf: { headerAccent: 'top-band' },
      meta: {
        description: 'Bold and modern with accent colors. Perfect for startups.',
        tags: ['Tech', 'Startup', 'Modern'],
      },
    }),
  },
  {
    name: 'Federal Government',
    preset: 'federal-government',
    configJson: config({
      typography: {
        bodyFont: 'Times New Roman',
        headingFont: 'Times New Roman',
        baseFontSize: 11,
        nameSize: 16,
        headingSize: 12,
        nameUppercase: false,
        headingUppercase: true,
      },
      layout: { headerAlignment: 'left', contactSeparator: '|', sectionSpacing: 12 },
      colors: {
        primary: '#000000',
        heading: '#000000',
        body: '#000000',
        accent: '#000000',
        contact: '#000000',
        muted: '#000000',
        divider: '#000000',
      },
      styles: { sectionHeadingStyle: 'underline', listStyle: 'disc', locationItalic: false },
      pdf: { headerAccent: 'none' },
      meta: {
        description: 'Conservative and ATS-friendly. Designed for federal applications.',
        tags: ['Government', 'Federal', 'ATS'],
      },
    }),
  },
  {
    name: 'Healthcare Professional',
    preset: 'healthcare-professional',
    configJson: config({
      typography: { bodyFont: 'Calibri', headingFont: 'Calibri', nameSize: 20, baseFontSize: 11 },
      colors: { primary: '#0f4c5c', heading: '#0f4c5c', accent: '#0f766e', divider: '#99f6e4' },
      styles: { sectionHeadingStyle: 'underline' },
      pdf: { headerAccent: 'top-rule' },
      meta: {
        description: 'Clean and readable format for medical, nursing, and clinical roles.',
        tags: ['Healthcare', 'Medical', 'Nursing'],
      },
    }),
  },
  {
    name: 'Entry Level / Graduate',
    preset: 'entry-level',
    configJson: config({
      typography: { bodyFont: 'Calibri', headingFont: 'Calibri', nameSize: 20, headingUppercase: true },
      sections: { order: educationFirst },
      colors: { primary: '#1e3a8a', accent: '#1d4ed8' },
      styles: { sectionHeadingStyle: 'bar' },
      meta: {
        description: 'Education-first layout for new graduates and early-career roles.',
        tags: ['Entry level', 'Graduate', 'Student'],
      },
    }),
  },
  {
    name: 'Sales & Marketing',
    preset: 'sales-marketing',
    configJson: config({
      typography: { bodyFont: 'Calibri', headingFont: 'Arial', nameSize: 22, nameUppercase: true },
      layout: { headerAlignment: 'left', sectionSpacing: 14 },
      colors: { primary: '#9f1239', heading: '#881337', accent: '#be123c' },
      styles: { sectionHeadingStyle: 'underline', experienceTitleWeight: 'bold' },
      pdf: { headerAccent: 'top-band' },
      meta: {
        description: 'Dynamic and results-driven. Ideal for sales and marketing.',
        tags: ['Sales', 'Marketing', 'Business'],
      },
    }),
  },
  {
    name: 'Legal Professional',
    preset: 'legal-professional',
    configJson: config({
      typography: {
        bodyFont: 'Garamond',
        headingFont: 'Garamond',
        nameSize: 20,
        nameUppercase: true,
        baseFontSize: 11,
        lineHeight: 1.45,
      },
      layout: { headerAlignment: 'center', contactSeparator: '|', marginLeft: 60, marginRight: 60 },
      colors: { primary: '#1c1917', heading: '#1c1917', accent: '#1c1917', divider: '#78716c' },
      styles: { sectionHeadingStyle: 'underline', locationItalic: true },
      pdf: { headerAccent: 'top-rule' },
      meta: {
        description: 'Formal and traditional format for attorneys, paralegals, and counsel.',
        tags: ['Legal', 'Law', 'Attorney'],
      },
    }),
  },
  {
    name: 'Chronological ATS',
    preset: 'chronological-ats',
    configJson: config({
      typography: {
        bodyFont: 'Arial',
        headingFont: 'Arial',
        baseFontSize: 11,
        nameSize: 16,
        headingUppercase: true,
      },
      colors: {
        primary: '#000000',
        heading: '#000000',
        body: '#222222',
        accent: '#000000',
        contact: '#222222',
        muted: '#333333',
        divider: '#000000',
      },
      styles: { sectionHeadingStyle: 'underline', skillsLayout: 'comma', listStyle: 'disc' },
      pdf: { headerAccent: 'none' },
      meta: {
        description: 'Plain single-column chronological resume built for applicant tracking systems.',
        tags: ['ATS', 'Simple', 'Chronological'],
      },
    }),
  },
  {
    name: 'Consulting',
    preset: 'consulting',
    configJson: config({
      typography: { bodyFont: 'Calibri', headingFont: 'Calibri', nameSize: 18, baseFontSize: 10.5 },
      layout: { headerAlignment: 'left', sectionSpacing: 12 },
      colors: { primary: '#1e3a5f', heading: '#1e3a5f', accent: '#1e3a5f' },
      styles: { skillsLayout: 'lines', sectionHeadingStyle: 'underline' },
      pdf: { headerAccent: 'side' },
      meta: {
        description: 'Tight, structured layout used for consulting and strategy roles.',
        tags: ['Consulting', 'Strategy'],
      },
    }),
  },
];
