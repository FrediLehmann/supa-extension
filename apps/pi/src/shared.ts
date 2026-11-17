import type { SupabaseStatus } from '@supabase-agent-extension/supabase';
import { indicatorLabel } from '@supabase-agent-extension/supabase/host';

/** The footer key the indicator is stored under. */
export const statusKey = 'supabase';

/**
 * The footer text for a status: a green dot while running, a muted hollow dot while stopped, and nothing when the
 * session has no Supabase project.
 */
export const indicator = (
	status: SupabaseStatus,
	fg: (color: 'success' | 'dim', text: string) => string
) => {
	if (!status.configured) return undefined;
	return fg(status.running ? 'success' : 'dim', indicatorLabel(status.running));
};
