import { isTauriRuntime } from './isTauriRuntime';
import { openExternalUrl } from './openExternal';
import { navigateToCommunity } from './appRoute';

export async function openCommunityInBrowser(listingId?: string): Promise<void> {
  if (isTauriRuntime()) {
    const path = listingId ? `https://spoor.ink/community/${listingId}` : 'https://spoor.ink/community';
    await openExternalUrl(path);
    return;
  }
  navigateToCommunity(listingId);
}
