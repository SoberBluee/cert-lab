import type { LessonTrack } from '@cka/schema';
import { useLocation } from 'react-router-dom';

/** The app's two sections; each one lists the lessons of the matching track. */
export type Section = LessonTrack;

export const SECTIONS: Record<Section, { name: string; base: string; home: string }> = {
  cka: { name: 'CKA Labs', base: '', home: '/' },
  linux: { name: 'Linux Labs', base: '/linux', home: '/linux/learn' },
};

export const sectionOf = (pathname: string): Section => (pathname === '/linux' || pathname.startsWith('/linux/') ? 'linux' : 'cka');

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
