import { useEffect, useState } from 'react';

/** 画面幅が狭いか。決定表「表示設定と共通の振る舞い」列4・列5・列6・列8 で使う。 */
export function useNarrow(query = '(max-width: 767px)'): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [query]);

  return narrow;
}
