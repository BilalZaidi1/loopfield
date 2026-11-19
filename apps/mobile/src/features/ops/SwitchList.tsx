import { View } from 'react-native';
import { fmtRelative } from '@/lib/format';
import { Badge, Chip, ListGroup, Toggle, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';
import type { ConfigRow } from './tools';

/** Who changed a setting last, and why. */
function lastChange(r: ConfigRow): string | undefined {
  if (!r.last_changed_at) return r.help ?? undefined;
  return `${r.help ? `${r.help} ` : ''}Changed ${fmtRelative(r.last_changed_at)}${r.last_changed_by ? ` by @${r.last_changed_by}` : ''}${r.last_reason ? `: "${r.last_reason}"` : ''}`;
}

/**
 * Every kill switch from `ops_config()`, in the back office's order: on/off switches as toggles, list
 * switches (such as suspended health cards) as chips. `onSet` asks for a reason before anything changes;
 * switches the staff member's role cannot change are shown but disabled.
 */
export function SwitchList({ rows, busy, onSet }: { rows: readonly ConfigRow[]; busy: boolean; onSet: (row: ConfigRow, value: unknown, title: string) => void }) {
  return (
    <ListGroup>
      {rows.map((r) =>
        r.value_type === 'boolean' || typeof r.value === 'boolean' ? (
          <Toggle
            key={r.key}
            label={r.label}
            description={lastChange(r)}
            value={r.value === true}
            disabled={!r.can_edit || busy}
            onChange={(v) => onSet(r, v, `${v ? 'Turn on' : 'Turn off'} ${r.label.toLowerCase()}`)}
          />
        ) : (
          <ListSwitch key={r.key} row={r} disabled={!r.can_edit || busy} onChange={(v, title) => onSet(r, v, title)} />
        )
      )}
    </ListGroup>
  );
}

/** A switch whose value is a list of things paused (for example health cards): one chip per item. */
function ListSwitch({ row, disabled, onChange }: { row: ConfigRow; disabled: boolean; onChange: (value: string[], title: string) => void }) {
  const current = Array.isArray(row.value) ? row.value.filter((x): x is string => typeof x === 'string') : [];
  const options = row.allowed?.length ? row.allowed : current;
  const help = lastChange(row);
  return (
    <View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Txt variant="bodyStrong" style={{ flex: 1 }}>{row.label}</Txt>
        <Badge label={current.length ? `${current.length} paused` : 'All on'} tone={current.length ? 'warning' : 'success'} />
      </View>
      {help ? <Txt variant="caption">{help}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityLabel={`${row.label}: choose what to pause`}>
        {options.map((o) => {
          const paused = current.includes(o);
          return (
            <Chip
              key={o}
              label={`${o.replace(/_/g, ' ')}${paused ? ' (paused)' : ''}`}
              selected={paused}
              onPress={disabled ? undefined : () => onChange(paused ? current.filter((x) => x !== o) : [...current, o], `${paused ? 'Resume' : 'Pause'} ${o.replace(/_/g, ' ')}`)}
            />
          );
        })}
      </View>
    </View>
  );
}
