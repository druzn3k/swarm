// A tiny AngularJS 1.x dependency-injection shim, just enough to run the
// original CoffeeScript engine services headlessly in Node.
//
// Only factory/service/value/constant are honoured. config/run/filter/
// directive/controller are recorded but never executed (filters are available
// through $filter if something asks for one).

export type Recipe =
  | { kind: "factory"; fn: Function }
  | { kind: "service"; fn: Function }
  | { kind: "value"; value: unknown };

export class AngularModule {
  constructor(public readonly name: string, private readonly registry: Registry) {}
  factory(name: string, fn: Function): this {
    this.registry.recipes[name] = { kind: "factory", fn };
    return this;
  }
  service(name: string, fn: Function): this {
    this.registry.recipes[name] = { kind: "service", fn };
    return this;
  }
  value(name: string, value: unknown): this {
    this.registry.recipes[name] = { kind: "value", value };
    return this;
  }
  constant(name: string, value: unknown): this {
    return this.value(name, value);
  }
  filter(name: string, fn: Function): this {
    this.registry.recipes[`${name}Filter`] = { kind: "factory", fn };
    return this;
  }
  config(_fn: Function): this {
    return this;
  }
  run(_fn: Function): this {
    return this;
  }
  directive(_name: string, _fn: Function): this {
    return this;
  }
  controller(_name: string, _fn: Function): this {
    return this;
  }
}

export interface Registry {
  recipes: { [name: string]: Recipe };
}

/** The global `angular` object the compiled coffee files see. */
export function createAngular(registry: Registry) {
  const modules: { [name: string]: AngularModule } = {};
  return {
    module(name: string, _deps?: string[]): AngularModule {
      return (modules[name] ??= new AngularModule(name, registry));
    },
  };
}

/** Parse the parameter names of a function: implicit-annotation injection. */
export function annotate(fn: Function): string[] {
  const src = Function.prototype.toString.call(fn);
  const m = /^[^(]*\(([^)]*)\)/.exec(src);
  if (!m) throw new Error(`cannot parse injectable function: ${src.slice(0, 100)}`);
  return m[1]
    .split(",")
    .map((s) => s.replace(/\/\*.*?\*\//g, "").trim())
    .filter((s) => s.length > 0);
}

export class Injector {
  private readonly instances: { [name: string]: unknown } = {};
  private readonly resolving: string[] = [];
  constructor(private readonly registry: Registry) {
    this.instances.$injector = this;
  }
  has(name: string): boolean {
    return name in this.instances || name in this.registry.recipes;
  }
  get(name: string): any {
    if (name in this.instances) return this.instances[name];
    const recipe = this.registry.recipes[name];
    if (!recipe) {
      throw new Error(`[oracle injector] unknown provider: ${name} <- ${this.resolving.join(" <- ")}`);
    }
    if (this.resolving.includes(name)) {
      throw new Error(`[oracle injector] circular dependency: ${[...this.resolving, name].join(" -> ")}`);
    }
    this.resolving.push(name);
    try {
      let value: unknown;
      switch (recipe.kind) {
        case "value":
          value = recipe.value;
          break;
        case "factory":
          value = this.invoke(recipe.fn);
          break;
        case "service":
          value = this.instantiate(recipe.fn);
          break;
      }
      this.instances[name] = value;
      return value;
    } finally {
      this.resolving.pop();
    }
  }
  invoke(fn: Function, self?: unknown): any {
    const args = annotate(fn).map((dep) => this.get(dep));
    return fn.apply(self, args);
  }
  instantiate(fn: Function): any {
    const args = annotate(fn).map((dep) => this.get(dep));
    return Reflect.construct(fn, args);
  }
}

/** $rootScope stand-in: a synchronous event bus with Angular's listener signature. */
export class EventBus {
  private listeners: { [name: string]: Function[] } = {};
  /** exceptions thrown by listeners; Angular logs these instead of propagating them */
  readonly listenerErrors: { event: string; error: unknown }[] = [];
  $on(name: string, fn: Function): () => void {
    (this.listeners[name] ??= []).push(fn);
    return () => {
      const list = this.listeners[name];
      const i = list ? list.indexOf(fn) : -1;
      if (i >= 0) list.splice(i, 1);
    };
  }
  $emit(name: string, ...args: unknown[]) {
    return this.dispatch(name, args);
  }
  $broadcast(name: string, ...args: unknown[]) {
    return this.dispatch(name, args);
  }
  $new() {
    return this;
  }
  $apply(fn?: Function) {
    return fn?.();
  }
  $digest() {}
  private dispatch(name: string, args: unknown[]) {
    const event = {
      name,
      targetScope: this,
      currentScope: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
    };
    for (const fn of [...(this.listeners[name] ?? [])]) {
      try {
        fn(event, ...args);
      } catch (error) {
        this.listenerErrors.push({ event: name, error });
      }
    }
    return event;
  }
}
