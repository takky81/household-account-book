import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { currentMonthKey } from '../../lib/date';

type TargetMonthState = {
  monthKey: string;
  setMonthKey: Dispatch<SetStateAction<string>>;
};

const TargetMonthContext = createContext<TargetMonthState | null>(null);

/** ホーム・一覧・集計・予算で共通して使う対象月。ログイン中の画面移動では維持する。 */
export function TargetMonthProvider({ children }: { children: ReactNode }) {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const value = useMemo(() => ({ monthKey, setMonthKey }), [monthKey]);

  return <TargetMonthContext.Provider value={value}>{children}</TargetMonthContext.Provider>;
}

export function useTargetMonth(): TargetMonthState {
  const value = useContext(TargetMonthContext);
  if (value === null) throw new Error('TargetMonthProvider の外です');
  return value;
}
