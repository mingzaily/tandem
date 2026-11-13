import type { Attachment } from './api';

/** Unsent input stays available while its page is outside the navigation viewport. */
export const composerDrafts = new Map<string, { value: string; attachments: Attachment[] }>();
