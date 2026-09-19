import { useCallback, useEffect, useState } from 'react';
import {
  createMissingSupply,
  deleteMissingSupply,
  loadMissingSupplies,
  setMissingSupplyPurchased,
  type MissingSupply,
} from '../../lib/db';

/** DB上の共有リストを読み、書き込み後に最新状態へ揃える。 */
export function useSupplies() {
  const [items, setItems] = useState<MissingSupply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await loadMissingSupplies());
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '不足物資を読み込めませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function change(action: () => Promise<void>): Promise<boolean> {
    setError('');
    try {
      await action();
      await reload();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '変更できませんでした');
      return false;
    }
  }

  return {
    items,
    loading,
    error,
    reload,
    add: (name: string) => change(() => createMissingSupply(name)),
    toggle: (item: MissingSupply) =>
      change(() => setMissingSupplyPurchased(item.id, !item.is_purchased)),
    remove: (id: string) => change(() => deleteMissingSupply(id)),
  };
}
