export type CleanupFunction = () => void;
export type Effect = () => undefined | CleanupFunction;
export type DependencyArray = any[];
export type SetStateAction<T> = T | ((prev: T) => T);
export type StateHook<T = any> = {
  state: T;
  queue: SetStateAction<T>[];
};

export type EffectHook = {
  dependencies: DependencyArray;
  cleanup?: CleanupFunction;
};

export type EffectTag = 'PLACEMENT' | 'DELETION' | 'UPDATE';

export type Fiber<P = any> = {
  parent?: Fiber;
  dom?: HTMLElement | Text;
  effectTag?: EffectTag;
  alternate?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
  props: P;
  index?: number;
  type?: string | FC<any>;
  hooks?: (StateHook | EffectHook)[];
};

export type FC<P> = (p: P) => VNode<P>;

export type VNode<P = any> = {
  type: string | FC<P>;
  props: P;
  referent?: Text | Element;
  sibling?: VNode;
};
