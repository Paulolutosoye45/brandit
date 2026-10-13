'use client';
import { createContext, useContext, useMemo } from 'react';
import { translator } from '@/content/pidgin-ui';
import type { Lang } from '@/content/messages';

const Ctx = createContext<Lang>('en');

/** Gives client components the site's language, so they can use useT() like server components use translator(). */
export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}
export const useLang = () => useContext(Ctx);
export function useT() {
  const lang = useLang();
  return useMemo(() => translator(lang), [lang]);
}
