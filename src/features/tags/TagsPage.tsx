import { useState } from 'react';
import { Button, Card, ErrorText, Field, TextInput } from '../../components/ui';
import { createTag, updateTag } from '../../lib/db';
import { useWorkspace } from '../app/context';

export function TagsPage() {
  const workspace = useWorkspace();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#64748b');
  const [error, setError] = useState('');

  async function add() {
    setError('');
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.includes(';')) {
      setError('タグ名を入力してください（; は使えません）');
      return;
    }
    try {
      await createTag({
        name: trimmed,
        color,
        sortOrder: Math.max(0, ...workspace.tags.map((tag) => tag.sort_order)) + 10,
      });
      setName('');
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '追加できませんでした');
    }
  }

  async function patch(id: string, next: Parameters<typeof updateTag>[1]) {
    setError('');
    try {
      await updateTag(id, next);
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存できませんでした');
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">タグ管理</h1>
      <ErrorText>{error}</ErrorText>
      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">タグを追加</h2>
        <Field label="名前" hint="CSVで区切りに使うため ; は使えません">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="色">
          <TextInput type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </Field>
        <Button onClick={() => void add()}>追加</Button>
      </Card>
      {workspace.tags.map((tag) => (
        <Card key={tag.id} className="flex items-center gap-2">
          <TextInput
            aria-label={`${tag.name}の名前`}
            defaultValue={tag.name}
            disabled={tag.is_archived}
            onBlur={(event) => {
              if (event.target.value !== tag.name) void patch(tag.id, { name: event.target.value });
            }}
          />
          <TextInput
            type="color"
            aria-label={`${tag.name}の色`}
            defaultValue={tag.color}
            disabled={tag.is_archived}
            onBlur={(event) => void patch(tag.id, { color: event.target.value })}
          />
          <Button
            variant="ghost"
            className="shrink-0 text-xs"
            onClick={() => void patch(tag.id, { is_archived: !tag.is_archived })}
          >
            {tag.is_archived ? '再開' : '使用停止'}
          </Button>
        </Card>
      ))}
    </main>
  );
}

