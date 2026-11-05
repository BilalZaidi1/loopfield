import { useState } from 'react';
import { Modal, View } from 'react-native';
import { Button, TextField, Txt } from '@/components/ui';
import { radius, spacing, usePalette } from '@/theme/tokens';

/** Operator decisions always carry a written reason; it is stored in the audit trail server-side. */
export function useReasonPrompt() {
  const [state, setState] = useState<{ title: string; onSubmit: (reason: string) => void } | null>(null);
  const [reason, setReason] = useState('');
  const p = usePalette();
  const ask = (title: string, onSubmit: (reason: string) => void) => {
    setReason('');
    setState({ title, onSubmit });
  };
  const element = (
    <Modal visible={Boolean(state)} transparent animationType="fade" onRequestClose={() => setState(null)}>
      <View style={{ flex: 1, backgroundColor: p.overlay, justifyContent: 'center', padding: spacing.xl }}>
        <View style={{ backgroundColor: p.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md }}>
          <Txt variant="heading">{state?.title}</Txt>
          <TextField label="Reason (recorded in the audit log)" value={reason} onChangeText={setReason} multiline maxLength={500} />
          <Button label="Confirm" disabled={reason.trim().length < 5} onPress={() => { const s = state; setState(null); s?.onSubmit(reason.trim()); }} />
          <Button variant="ghost" label="Cancel" onPress={() => setState(null)} />
        </View>
      </View>
    </Modal>
  );
  return { ask, element };
}
