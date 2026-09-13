import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ui';

/** 消す操作の手前に必ず出る1枚（決定表「表示設定と共通の振る舞い」列9・列10）。 */
describe('ConfirmDialog', () => {
  function setup() {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="この取引を削除しますか"
        detail={['9/12 食費 / 外食 1,280円', '負担もまとめて消え、元に戻せません']}
        confirmLabel="削除する"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    return { onConfirm, onCancel };
  }

  it('題と内訳を出し、焦点は「やめる」に置く', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('この取引を削除しますか');
    // 「何が消えるか」と「そのあとどうなるか」は別の行にする
    expect(dialog).toHaveTextContent('9/12 食費 / 外食 1,280円');
    expect(dialog).toHaveTextContent('負担もまとめて消え、元に戻せません');
    expect(screen.getByText('9/12 食費 / 外食 1,280円').tagName).toBe('P');
    expect(screen.getByRole('button', { name: 'やめる' })).toHaveFocus();
  });

  it('消すほうを押したときだけ消す側を呼ぶ', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('やめる・Escape・枠の外でやめられる', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    // 幕（ダイアログの親）を押しても、やめる扱いにする
    fireEvent.click(screen.getByRole('dialog').parentElement!);

    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
