/** Where a statue's Play button sends you. */
export type GameMode = 'hub' | 'jungle' | 'horror' | 'madness' | 'cooking' | 'huss' | 'vacuum' | 'algo';

/** Goes to another mode. (A new page: the headset leaves VR, and the mode's own menu is shown.) */
export function goToMode(mode: GameMode): void {
  const old = new URLSearchParams(location.search);
  const params = new URLSearchParams();
  params.set('mode', mode);
  for (const keep of ['emulate', 'signal', 'netdebug']) if (old.has(keep)) params.set(keep, old.get(keep) ?? '');
  location.href = `${location.pathname}?${params.toString().replace(/=(&|$)/g, '$1')}`;
}
