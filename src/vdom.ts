import { isProperty, isNew, isGone, isEvent } from './utils';
import {
  Fiber,
  VNode,
  FC,
  SetStateAction,
  StateHook,
  EffectHook,
  Effect,
  DependencyArray,
} from './types';

let nextUnitOfWork: Fiber | undefined;
let wipRoot: Fiber | undefined;
let wipFiber: Fiber;
let hookIndex: number = 0;
let currentRoot: Fiber | undefined;
let deletions: Fiber[] = [];

function updateDom<P extends Record<string, any>>(
  dom: HTMLElement | Text,
  prevProps: P,
  nextProps: P
) {
  // Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(key => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      if (name in dom) {
        (dom as any)[name] = '';
      } else {
        (dom as any).removeAttribute(name);
      }
    });

  // Add new event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });

  // Add new/changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      // property or attribute?
      if (name in dom) {
        (dom as any)[name] = nextProps[name];
      } else {
        (dom as any).setAttribute(name, nextProps[name]);
      }
    });
}

function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot!.child);
  currentRoot = wipRoot;
  wipRoot = undefined;
}

function commitWork(fiber?: Fiber) {
  if (!fiber) {
    return;
  }
  let domParentFiber = fiber.parent!;
  // Go up the tree until you find a fiber with a real dom node.
  // (i.e. not a function component)
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent!;
  }
  const domParent = domParentFiber.dom;

  if (fiber.effectTag === 'PLACEMENT' && fiber.dom != null) {
    domParent.appendChild(fiber.dom);
  }
  if (fiber.effectTag === 'DELETION') {
    commitDeletion(fiber, domParent);
  }
  if (fiber.effectTag === 'UPDATE') {
    updateDom(fiber.dom as HTMLElement, fiber?.alternate?.props, fiber.props);
    if (fiber.parent!.dom && fiber.dom) {
      // Has the dom node's position moved? (Basically, is it keyed)
      // TODO: This is slow! We shouldn't need to look into the DOM
      // to see if its order has changed... And if the order has changed because
      // something before it has been removed, we shouldn't do anything.
      if (fiber.parent!.dom?.childNodes[fiber.index as number] !== fiber.dom) {
        const referent = fiber.parent!.dom?.childNodes[fiber.index as number];
        domParent.insertBefore(fiber.dom, referent);
      }
    }
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitDeletion(
  fiber: Fiber | undefined,
  domParent: HTMLElement | Text
) {
  if (!fiber) return;
  // Go down the tree until you find the base dom node to remove.
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child, domParent);
  }
}

function workLoop(deadline: IdleDeadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

function reconcileChildren(wipFiber: Fiber, elements: VNode<any>[]) {
  let index = 0;
  let nodeToTraverse = wipFiber.alternate?.child;
  let prevSibling: Fiber | null = null;

  let keyedElements = new Map();
  let unkeyedElements = [];

  // Go through all the existing nodes, divide into
  // keyed and unkeyed.
  while (nodeToTraverse !== undefined) {
    if (nodeToTraverse.props.key) {
      keyedElements.set(nodeToTraverse.props.key, nodeToTraverse);
    } else {
      unkeyedElements.push(nodeToTraverse);
    }
    nodeToTraverse = nodeToTraverse.sibling;
  }

  // Go through children, append them to this fiber.
  while (
    index < elements.length ||
    unkeyedElements.length > 0 ||
    keyedElements.size > 0
  ) {
    const element = elements[index];
    let newFiber: Fiber;

    let oldFiber;
    if (element.props.key !== undefined) {
      oldFiber = keyedElements.get(element.props.key);
      keyedElements.delete(element.props.key);
      element.referent = prevSibling?.dom;
    } else {
      oldFiber = unkeyedElements.shift();
    }

    // Compare oldFiber to element.
    const sameType = oldFiber && oldFiber.type == element.type;

    if (sameType) {
      // Update the node
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: 'UPDATE',
        index,
      };
    }
    if (element && !sameType) {
      // Add a new node
      newFiber = {
        type: element.type,
        props: element.props,
        dom: undefined,
        parent: wipFiber,
        alternate: undefined,
        effectTag: 'PLACEMENT',
      };
    }
    if (oldFiber && !sameType) {
      // delete an old node
      oldFiber.effectTag = 'DELETION';
      deletions.push(oldFiber);
    }

    if (index === 0) {
      wipFiber.child = newFiber!;
    } else {
      prevSibling!.sibling = newFiber!;
    }

    prevSibling = newFiber!;
    index++;
  }
}

// @ts-ignore TS-7030
function performUnitOfWork(fiber: Fiber) {
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    // It's a normal node
    updateHostComponent(fiber);
  }

  // Traverse fiber tree, first look for children, then siblings,
  // then go to parent and try again for siblings.
  if (fiber.child) {
    return fiber.child;
  }

  // TS warns that this loop might never terminate, but it will.
  let nextFiber: Fiber | undefined = fiber;
  while (nextFiber !== undefined) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

function updateFunctionComponent(fiber: Fiber) {
  // Run the function to get its children.
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [(fiber.type as FC<any>)(fiber.props)];
  reconcileChildren(fiber, children.flat());
}

function updateHostComponent(fiber: Fiber) {
  // Create actual dom node if it doesn't exist
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }

  reconcileChildren(fiber, fiber.props.children.flat());
}

function createDom(fiber: Fiber) {
  const dom =
    fiber.type == 'TEXT_ELEMENT'
      ? document.createTextNode('')
      : document.createElement(fiber.type as string);

  updateDom(dom, {}, fiber.props);

  return dom;
}

function render(element: VNode, container: HTMLElement) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

function createElement<P>(
  type: string,
  props: P,
  ...children: any[]
): VNode<P> {
  return {
    type,
    props: {
      ...props,
      children: children.map(child =>
        typeof child === 'object' ? child : createTextElement(child)
      ),
    },
  };
}

function createTextElement(text: string) {
  return {
    type: 'TEXT_ELEMENT',
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

function useEffect(effect: Effect, dependencies: DependencyArray) {
  let oldHook: EffectHook | undefined;
  if (
    wipFiber !== undefined &&
    wipFiber.alternate &&
    wipFiber.alternate.hooks
  ) {
    oldHook = wipFiber.alternate.hooks[hookIndex!] as EffectHook;
  }

  const skip =
    oldHook?.dependencies &&
    dependencies?.every((dep, i) => dep === oldHook!.dependencies[i]);

  let hook: EffectHook | undefined;
  if (skip) {
    hook = oldHook;
  } else {
    if (oldHook?.cleanup) oldHook.cleanup();
    const cleanup = effect();

    hook = {
      dependencies,
      cleanup,
    };
  }

  if (wipFiber.hooks === undefined) wipFiber.hooks = [];
  wipFiber.hooks.push(hook as EffectHook);
  hookIndex!++;
}

function useState<T>(initial: T): [T, (action: SetStateAction<T>) => void] {
  let oldHook: StateHook<T> | undefined;
  if (wipFiber?.alternate?.hooks && wipFiber.alternate.hooks[hookIndex]) {
    oldHook = wipFiber.alternate.hooks[hookIndex] as StateHook<T>;
  }

  const hook: StateHook<T> = {
    state:
      oldHook?.state ?? (initial instanceof Function ? initial() : initial),
    queue: [] as SetStateAction<T>[],
  };

  const actions: SetStateAction<T>[] = oldHook?.queue ?? [];
  actions.forEach(action => {
    hook.state = action instanceof Function ? action(hook.state) : action;
  });

  const setState = (action: SetStateAction<T>) => {
    hook.queue.push(action);
    wipRoot = {
      dom: currentRoot!.dom,
      props: currentRoot!.props,
      alternate: currentRoot,
    };
    // Throw away the current tree and rerender.
    nextUnitOfWork = wipRoot;
    deletions = [];
  };

  if (wipFiber.hooks === undefined) wipFiber.hooks = [];
  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

const VDom = {
  render,
  createElement,
  useState,
  useEffect,
};

export default VDom;
