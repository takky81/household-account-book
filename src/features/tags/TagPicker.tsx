import type { Tag } from '../../lib/db';

export function TagBadge({ tag }: { tag: Pick<Tag, 'name' | 'color'> }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: tag.color, color: tag.color }}
    >
      {tag.name}
    </span>
  );
}

export function TagPicker({
  tags,
  value,
  onChange,
}: {
  tags: Tag[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const choices = tags.filter((tag) => !tag.is_archived || value.includes(tag.id));
  if (choices.length === 0) {
    return <p className="text-xs text-[var(--c-muted)]">タグは設定画面から追加できます</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((tag) => {
        const checked = value.includes(tag.id);
        return (
          <label
            key={tag.id}
            className="flex cursor-pointer items-center gap-1 rounded-full border px-2 py-1 text-xs"
            style={{ borderColor: checked ? tag.color : 'var(--c-edge)' }}
          >
            <input
              type="checkbox"
              className="size-3.5"
              checked={checked}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, tag.id]
                    : value.filter((id) => id !== tag.id),
                )
              }
            />
            <span style={{ color: checked ? tag.color : undefined }}>{tag.name}</span>
          </label>
        );
      })}
    </div>
  );
}

