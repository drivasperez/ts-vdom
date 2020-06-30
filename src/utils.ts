export const isProperty = (key: string) =>
  key !== 'children' && key !== 'key' && !isEvent(key);
export const isNew = (prev: any, next: any) => (key: string) =>
  prev[key] !== next[key];
export const isGone = (_prev: any, next: any) => (key: string) =>
  !(key in next);
export const isEvent = (key: string) => key.startsWith('on');
