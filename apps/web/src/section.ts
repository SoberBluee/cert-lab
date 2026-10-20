import { useLocation } from 'react-router-dom';

/**
 * Top-level product areas in the UI. Lesson tracks (`cka` | `linux`) stay a subset;
 * terraform / aws / docker are shells until they have content.
 */
export type Section = 'cka' | 'linux' | 'terraform' | 'aws' | 'docker' | 'system';

export const SECTIONS: Record<Section, { name: string; base: string; home: string; blurb: string }> = {
  cka: { name: 'CKA Labs', base: '', home: '/', blurb: 'Kubernetes scenarios and drills' },
  linux: { name: 'Linux Labs', base: '/linux', home: '/linux/learn', blurb: 'Linux commands for the CKA' },
  terraform: { name: 'Terraform Labs', base: '/terraform', home: '/terraform', blurb: 'Coming soon' },
  aws: { name: 'AWS Labs', base: '/aws', home: '/aws', blurb: 'Coming soon' },
  docker: { name: 'Docker Labs', base: '/docker', home: '/docker', blurb: 'Coming soon' },
  system: { name: 'System Labs', base: '/system', home: '/system/learn', blurb: 'Networking and system design, interactively' },
};

const PREFIXES: { section: Section; prefix: string }[] = [
  { section: 'linux', prefix: '/linux' },
  { section: 'terraform', prefix: '/terraform' },
  { section: 'aws', prefix: '/aws' },
  { section: 'docker', prefix: '/docker' },
  { section: 'system', prefix: '/system' },
];

export const sectionOf = (pathname: string): Section => {
  for (const { section, prefix } of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return section;
  }
  return 'cka';
};

export function useSection(): Section {
  return sectionOf(useLocation().pathname);
}

const lastPathKey = (s: Section) => `cka.section.${s}.path`;

/** Where switching to a section lands: the page last visited there, or its home. */
export const lastPath = (s: Section) => {
  const p = localStorage.getItem(lastPathKey(s));
  return p && sectionOf(p) === s ? p : SECTIONS[s].home;
};

export const rememberPath = (pathname: string) => localStorage.setItem(lastPathKey(sectionOf(pathname)), pathname);
