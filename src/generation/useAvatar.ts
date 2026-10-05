/**
 * React binding for the avatar store — re-renders whenever any avatar changes
 * (upload, removal, or a background OpenAI generation landing).
 */
import { useEffect, useState } from 'react';
import { getAvatar, subscribeToAvatars, type AvatarKind, type AvatarSource } from './avatar';

export function useAvatar(kind: AvatarKind): AvatarSource {
  const [avatar, setAvatar] = useState<AvatarSource>(() => getAvatar(kind));

  useEffect(() => {
    const update = () => setAvatar(getAvatar(kind));
    update(); // re-sync on mount (another surface may have changed it)
    return subscribeToAvatars(update);
  }, [kind]);

  return avatar;
}
